
-- Helper now relocates via package_move() (which sets app.package_move='1')
CREATE OR REPLACE FUNCTION public._svc_pkg_quant_relocate(
  _package_id uuid, _to_location uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pkg public.stock_packages%ROWTYPE;
  v_from uuid;
BEGIN
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=_package_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_from := v_pkg.current_location_id;
  IF v_from = _to_location THEN RETURN; END IF;

  PERFORM public.package_move(_package_id, _to_location, NULL, NULL, 'f18c_disposition', NULL, v_pkg.qty);

  UPDATE public.stock_quants
     SET quantity = GREATEST(0, quantity - v_pkg.qty), updated_at = now()
   WHERE product_id = v_pkg.product_id AND location_id = v_from
     AND COALESCE(variant_id::text,'') = '';

  IF EXISTS (
    SELECT 1 FROM public.stock_quants
     WHERE product_id=v_pkg.product_id AND location_id=_to_location
       AND COALESCE(variant_id::text,'') = ''
  ) THEN
    UPDATE public.stock_quants
       SET quantity = quantity + v_pkg.qty, updated_at = now()
     WHERE product_id=v_pkg.product_id AND location_id=_to_location
       AND COALESCE(variant_id::text,'') = '';
  ELSE
    INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
    VALUES (v_pkg.product_id, _to_location, v_pkg.qty, 0);
  END IF;
END $$;

-- RPC 1 (no more direct current_location_id update)
CREATE OR REPLACE FUNCTION public.service_case_create_from_damaged_package(
  _stock_package_id uuid, _description text DEFAULT NULL, _action text DEFAULT 'repair'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pkg public.stock_packages%ROWTYPE;
  v_case_id uuid; v_item_id uuid; v_report_id uuid; v_quarantine uuid;
  v_action service_case_item_action; v_case_number text;
BEGIN
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=_stock_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_case_create_from_damaged_package: package_not_found %', _stock_package_id; END IF;

  SELECT sc.id INTO v_case_id FROM public.service_cases sc
   WHERE sc.stock_package_id=_stock_package_id AND sc.status NOT IN ('done','cancelled','rejected') LIMIT 1;
  IF v_case_id IS NOT NULL THEN RETURN v_case_id; END IF;

  v_quarantine := public._svc_repair_loc('QUARANTINE');
  IF v_quarantine IS NULL THEN RAISE EXCEPTION 'QUARANTINE location not found'; END IF;

  v_action := CASE COALESCE(_action,'repair')
                WHEN 'inspect' THEN 'inspect'::service_case_item_action
                WHEN 'replace' THEN 'replace'::service_case_item_action
                WHEN 'supplier_claim' THEN 'supplier_claim'::service_case_item_action
                ELSE 'repair'::service_case_item_action END;

  SELECT id INTO v_report_id FROM public.package_damage_reports
   WHERE stock_package_id=_stock_package_id AND status IN ('reported','in_quarantine','in_repair') LIMIT 1;
  IF v_report_id IS NULL THEN
    INSERT INTO public.package_damage_reports(stock_package_id, damage_type, description, status)
    VALUES (_stock_package_id, 'internal_inventory', COALESCE(_description,'Damaged found in stock'), 'in_quarantine')
    RETURNING id INTO v_report_id;
  ELSE
    UPDATE public.package_damage_reports SET status='in_quarantine', updated_at=now() WHERE id=v_report_id;
  END IF;

  PERFORM public._svc_pkg_quant_relocate(_stock_package_id, v_quarantine);
  UPDATE public.stock_packages
     SET condition='damaged'::package_condition, status='returned'::package_status,
         disposition_status='pending_decision', updated_at=now()
   WHERE id=_stock_package_id;

  v_case_number := 'SVC-INT-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substring(_stock_package_id::text,1,4);
  INSERT INTO public.service_cases(case_number, stock_package_id, product_id, case_type, source, status, responsibility, description, reported_at)
  VALUES (v_case_number, _stock_package_id, v_pkg.product_id, 'internal_rework','warehouse','triage','internal_manufacturing',
          COALESCE(_description,'Damaged package detected in inventory'), now())
  RETURNING id INTO v_case_id;

  INSERT INTO public.service_case_items(service_case_id, product_id, stock_package_id, issue_type, required_action, qty, status, repair_status)
  VALUES (v_case_id, v_pkg.product_id, _stock_package_id, 'damaged', v_action, v_pkg.qty, 'open',
          CASE WHEN v_action='repair'::service_case_item_action THEN 'waiting_repair' ELSE 'not_required' END)
  RETURNING id INTO v_item_id;

  UPDATE public.stock_packages SET service_case_id=v_case_id, service_case_item_id=v_item_id, updated_at=now()
   WHERE id=_stock_package_id;

  INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
  VALUES (v_case_id, v_item_id,
          CASE WHEN v_action='repair'::service_case_item_action THEN 'repair'::service_task_type ELSE 'triage'::service_task_type END,
          'open','Auto-created from damaged package');

  RETURN v_case_id;
END $$;

-- RPC 2
CREATE OR REPLACE FUNCTION public.service_case_repair_start(_case_item_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item public.service_case_items%ROWTYPE; v_repair_loc uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'repair_start: item_not_found'; END IF;
  IF v_item.stock_package_id IS NULL THEN RAISE EXCEPTION 'repair_start: item has no stock_package'; END IF;
  IF v_item.repair_status IS NOT NULL AND v_item.repair_status NOT IN ('waiting_repair','repair_failed') THEN
    RAISE EXCEPTION 'repair_start: invalid transition from %', v_item.repair_status; END IF;

  v_repair_loc := public._svc_repair_loc('REPAIR');
  IF v_repair_loc IS NULL THEN RAISE EXCEPTION 'REPAIR location missing'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_item.stock_package_id, v_repair_loc);
  UPDATE public.stock_packages
     SET disposition_status='repair', status='returned'::package_status, updated_at=now()
   WHERE id=v_item.stock_package_id;

  UPDATE public.service_case_items
     SET repair_status='in_repair', repair_started_at=COALESCE(repair_started_at, now()),
         repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
   WHERE id=_case_item_id;

  IF NOT EXISTS (SELECT 1 FROM public.service_tasks WHERE service_case_item_id=_case_item_id
                   AND task_type='repair'::service_task_type AND status IN ('open','in_progress')) THEN
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'repair','in_progress', _notes);
  ELSE
    UPDATE public.service_tasks SET status='in_progress', updated_at=now()
     WHERE service_case_item_id=_case_item_id AND task_type='repair' AND status IN ('open','in_progress');
  END IF;
  RETURN jsonb_build_object('ok',true,'item_id',_case_item_id,'repair_status','in_repair');
END $$;

-- RPC 3
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
      PERFORM public._service_reserve_quant(v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty,
        v_case.id, v_item.id, 'service_case_item', v_item.id);
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

-- RPC 4
CREATE OR REPLACE FUNCTION public.service_case_dispose_package(_case_item_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item public.service_case_items%ROWTYPE; v_pkg public.stock_packages%ROWTYPE; v_scrap uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispose: item_not_found'; END IF;
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispose: package_not_found'; END IF;
  v_scrap := COALESCE(public._svc_repair_loc('Sucata'), public._svc_repair_loc('SCRAP'));
  IF v_scrap IS NULL THEN RAISE EXCEPTION 'scrap location missing'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_scrap);
  UPDATE public.stock_packages SET condition='damaged', status='cancelled', disposition_status='scrap', updated_at=now() WHERE id=v_pkg.id;
  UPDATE public.service_case_items SET repair_status='scrapped', repair_result='scrap',
    repair_completed_at=now(), status='done', repair_notes=COALESCE(_reason, repair_notes), updated_at=now()
   WHERE id=_case_item_id;
  UPDATE public.service_tasks SET status='done', updated_at=now()
   WHERE service_case_item_id=_case_item_id AND status IN ('open','in_progress');
  RETURN jsonb_build_object('ok',true,'disposed',true,'item_id',_case_item_id);
END $$;

-- RPC 5
CREATE OR REPLACE FUNCTION public.service_case_release_repaired_to_stock(_case_item_id uuid, _target_location_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item public.service_case_items%ROWTYPE; v_case public.service_cases%ROWTYPE;
        v_pkg public.stock_packages%ROWTYPE; v_target uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release: item_not_found'; END IF;
  IF v_item.repair_status NOT IN ('repaired_pending_qc','repaired_approved') THEN
    RAISE EXCEPTION 'release: repair not approved (status=%)', v_item.repair_status; END IF;
  SELECT * INTO v_case FROM public.service_cases WHERE id=v_item.service_case_id;
  SELECT * INTO v_pkg  FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;
  IF v_case.customer_id IS NOT NULL OR v_case.sale_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'REPAIRED_ITEM_RESERVED_TO_CASE'; END IF;
  v_target := COALESCE(_target_location_id, public._svc_repair_loc('Stock'), public._svc_repair_loc('STOCK'));
  IF v_target IS NULL THEN RAISE EXCEPTION 'release: no target stock location'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_target);
  UPDATE public.stock_packages SET condition='repaired', status='available',
    disposition_status='returned_to_stock', updated_at=now() WHERE id=v_pkg.id;
  UPDATE public.service_case_items SET repair_status='repaired_approved', status='done', updated_at=now() WHERE id=_case_item_id;
  RETURN jsonb_build_object('ok',true,'released',true,'location_id',v_target);
END $$;
