-- F18-C patch mínimo: usar vocabulário existente do CHECK stock_reservation_log_origin_type_check.
-- Reserva interna pós-reparo (pass com link a cliente) é ação MANUAL; rastreabilidade
-- ao caso/item vem dos campos to_service_case_id / to_service_case_item_id, não do origin_type.
-- Não alarga o CHECK. Não toca em package_move, validate_picking, release_orphan_reservations,
-- _service_reserve_quant, Golden Flow, F18-B, frontend.

CREATE OR REPLACE FUNCTION public.service_case_repair_complete(_case_item_id uuid, _result text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.service_case_items%ROWTYPE; v_case public.service_cases%ROWTYPE;
  v_pkg public.stock_packages%ROWTYPE; v_scrap uuid; v_outlet uuid;
  v_has_customer_link boolean;
BEGIN
  IF _result NOT IN ('pass','fail','rework','scrap','outlet','supplier_claim') THEN
    RAISE EXCEPTION 'repair_complete: invalid_result %', _result; END IF;
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'repair_complete: item_not_found'; END IF;
  IF v_item.repair_status IS NULL OR v_item.repair_status NOT IN ('in_repair','waiting_repair') THEN
    RAISE EXCEPTION 'repair_complete: invalid transition from %', v_item.repair_status; END IF;
  SELECT * INTO v_case FROM public.service_cases WHERE id=v_item.service_case_id;
  SELECT * INTO v_pkg  FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;
  v_has_customer_link := (v_case.customer_id IS NOT NULL OR v_case.sale_order_id IS NOT NULL);

  IF _result = 'pass' THEN
    UPDATE public.stock_packages SET condition='repaired', disposition_status='repaired', updated_at=now() WHERE id=v_pkg.id;
    IF v_has_customer_link THEN
      PERFORM public._service_reserve_quant(v_pkg.product_id, NULL::uuid, v_pkg.current_location_id, v_pkg.qty,
        v_case.id, v_item.id, 'MANUAL'::text, v_item.id, NULL::jsonb);
      UPDATE public.stock_packages SET status='reserved' WHERE id=v_pkg.id;
    END IF;
    UPDATE public.service_case_items SET repair_status='repaired_pending_qc', repair_result='pass',
      repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
  ELSIF _result = 'rework' THEN
    UPDATE public.service_case_items SET repair_status='waiting_repair', repair_result='rework',
      repair_notes=COALESCE(_notes, repair_notes), updated_at=now() WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'repair','open', COALESCE(_notes,'Rework required'));
  ELSIF _result = 'fail' THEN
    UPDATE public.service_case_items SET repair_status='repair_failed', repair_result='fail',
      repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'triage','open','Repair failed - decide next action');
  ELSIF _result = 'scrap' THEN
    v_scrap := COALESCE(public._svc_repair_loc('Sucata'), public._svc_repair_loc('SCRAP'));
    IF v_scrap IS NULL THEN RAISE EXCEPTION 'scrap location missing'; END IF;
    PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_scrap);
    UPDATE public.stock_packages SET condition='damaged', status='cancelled', disposition_status='scrap', updated_at=now() WHERE id=v_pkg.id;
    UPDATE public.service_case_items SET repair_status='scrapped', repair_result='scrap',
      repair_completed_at=now(), status='done', repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
  ELSIF _result = 'outlet' THEN
    v_outlet := public._svc_repair_loc('OUTLET');
    IF v_outlet IS NULL THEN RAISE EXCEPTION 'OUTLET location missing'; END IF;
    PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_outlet);
    UPDATE public.stock_packages SET condition='repaired', status='returned', disposition_status='outlet', updated_at=now() WHERE id=v_pkg.id;
    UPDATE public.service_case_items SET repair_status='outlet', repair_result='outlet',
      repair_completed_at=now(), status='done', repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
  ELSIF _result = 'supplier_claim' THEN
    UPDATE public.stock_packages SET disposition_status='supplier_claim', status='returned', updated_at=now() WHERE id=v_pkg.id;
    UPDATE public.service_cases SET responsibility='supplier', status='waiting_supplier', updated_at=now() WHERE id=v_case.id;
    UPDATE public.service_case_items SET repair_status='supplier_claim', repair_result='supplier_claim',
      repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now() WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_case.id, _case_item_id, 'supplier_claim','open', COALESCE(_notes,'Supplier claim filed'));
  END IF;

  IF _result <> 'rework' THEN
    UPDATE public.service_tasks SET status='done', updated_at=now()
     WHERE service_case_item_id=_case_item_id AND task_type='repair' AND status IN ('open','in_progress');
  END IF;
  RETURN jsonb_build_object('ok',true,'result',_result,'item_id',_case_item_id);
END $$;