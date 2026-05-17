ALTER TABLE public.mo_operations
  ADD COLUMN IF NOT EXISTS planned_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS planned_end_at   timestamptz,
  ADD COLUMN IF NOT EXISTS actual_start_at  timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_at    timestamptz,
  ADD COLUMN IF NOT EXISTS actual_duration_minutes numeric,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.bom_operations
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS work_center_id uuid REFERENCES public.work_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_machine boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_employee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_quality_check boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setup_time_minutes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_time_minutes numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_mo_ops_machine_inprogress
  ON public.mo_operations(machine_id) WHERE state = 'in_progress' AND machine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_ops_employee_inprogress
  ON public.mo_operations(assigned_employee_id) WHERE state = 'in_progress' AND assigned_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_ops_mo_sequence ON public.mo_operations(mo_id, sequence);

DROP TRIGGER IF EXISTS trg_mo_operations_updated_at ON public.mo_operations;
CREATE TRIGGER trg_mo_operations_updated_at
  BEFORE UPDATE ON public.mo_operations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.mfg_materialize_work_orders(_mo_id uuid)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mo record; v_op record; v_ratio numeric; v_created int := 0;
  v_existing int; v_state mo_op_state; v_first_seq int; v_resolved_wc uuid;
BEGIN
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = _mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO not found: %', _mo_id USING ERRCODE='P0002'; END IF;
  IF v_mo.bom_id IS NULL THEN RETURN 0; END IF;
  v_ratio := COALESCE(v_mo.qty / NULLIF((SELECT quantity FROM public.boms WHERE id = v_mo.bom_id),0), 1);
  SELECT MIN(sequence) INTO v_first_seq FROM public.bom_operations
    WHERE bom_id = v_mo.bom_id AND active = true;
  FOR v_op IN
    SELECT * FROM public.bom_operations
     WHERE bom_id = v_mo.bom_id AND active = true ORDER BY sequence
  LOOP
    SELECT count(*) INTO v_existing FROM public.mo_operations
      WHERE mo_id = _mo_id AND sequence = v_op.sequence;
    IF v_existing > 0 THEN CONTINUE; END IF;
    v_state := CASE WHEN v_op.sequence = v_first_seq THEN 'ready'::mo_op_state ELSE 'pending'::mo_op_state END;
    v_resolved_wc := v_op.work_center_id;
    IF v_resolved_wc IS NULL AND v_op.workcenter IS NOT NULL THEN
      SELECT id INTO v_resolved_wc FROM public.work_centers
        WHERE code = v_op.workcenter OR name = v_op.workcenter LIMIT 1;
    END IF;
    INSERT INTO public.mo_operations(
      mo_id, sequence, name, workcenter, work_center_id, planned_minutes, state, is_qc
    ) VALUES (
      _mo_id, v_op.sequence, v_op.name, v_op.workcenter, v_resolved_wc,
      ROUND( (COALESCE(v_op.duration_minutes,0) + COALESCE(v_op.setup_time_minutes,0)
              + COALESCE(v_op.cleanup_time_minutes,0)) * v_ratio , 2),
      v_state, COALESCE(v_op.requires_quality_check, false)
    );
    v_created := v_created + 1;
  END LOOP;
  RETURN v_created;
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_start(
  _work_order_id uuid, _employee_id uuid DEFAULT NULL, _machine_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record; mch record; v_prev int; v_busy int;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id = _work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state NOT IN ('ready','paused') THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_READY: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  SELECT count(*) INTO v_prev FROM public.mo_operations
    WHERE mo_id = wo.mo_id AND sequence < wo.sequence
      AND state IN ('pending','ready','in_progress','paused','blocked');
  IF v_prev > 0 THEN RAISE EXCEPTION 'SEQUENCE_VIOLATION' USING ERRCODE='P0001'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.mo_components c
    WHERE c.mo_id = wo.mo_id AND c.operation_id = wo.operation_id
      AND c.is_critical = true AND COALESCE(c.qty_reserved,0) < c.qty_required
  ) THEN
    UPDATE public.mo_operations SET state='blocked', block_reason='CRITICAL_COMPONENT_MISSING' WHERE id=_work_order_id;
    RAISE EXCEPTION 'CRITICAL_COMPONENT_MISSING' USING ERRCODE='P0001';
  END IF;
  IF _machine_id IS NOT NULL THEN
    SELECT * INTO mch FROM public.manufacturing_machines WHERE id=_machine_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MACHINE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF mch.status NOT IN ('available') THEN
      RAISE EXCEPTION 'MACHINE_UNAVAILABLE: status=%', mch.status USING ERRCODE='P0001';
    END IF;
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE machine_id=_machine_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'MACHINE_BUSY' USING ERRCODE='P0001'; END IF;
    UPDATE public.manufacturing_machines SET status='busy', updated_at=now() WHERE id=_machine_id;
  END IF;
  IF _employee_id IS NOT NULL THEN
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE assigned_employee_id=_employee_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'EMPLOYEE_BUSY' USING ERRCODE='P0001'; END IF;
  END IF;
  UPDATE public.mo_operations SET
    state = 'in_progress',
    actual_start_at = COALESCE(actual_start_at, now()),
    started_at = COALESCE(started_at, now()),
    assigned_employee_id = COALESCE(_employee_id, assigned_employee_id),
    machine_id = COALESCE(_machine_id, machine_id),
    block_reason = NULL
  WHERE id = _work_order_id;
  INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, qty_done, qty_scrap, notes)
  VALUES (_work_order_id, wo.mo_id, _employee_id, now(), 0, 0, 'start');
  IF (SELECT state FROM public.manufacturing_orders WHERE id = wo.mo_id) IN ('draft','ready','waiting_material') THEN
    UPDATE public.manufacturing_orders SET state='in_progress', actual_start=COALESCE(actual_start, now()), updated_at=now()
      WHERE id = wo.mo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'work_order_id', _work_order_id, 'state','in_progress');
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_pause(_work_order_id uuid, _reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id=_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state <> 'in_progress' THEN
    RAISE EXCEPTION 'WORK_ORDER_INVALID_STATE: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  UPDATE public.mo_operations SET state='paused', notes=COALESCE(notes||E'\n','')||'pause: '||COALESCE(_reason,'') WHERE id=_work_order_id;
  UPDATE public.mo_workorder_logs SET finished_at=now() WHERE mo_operation_id=_work_order_id AND finished_at IS NULL;
  IF wo.machine_id IS NOT NULL THEN
    UPDATE public.manufacturing_machines SET status='available', updated_at=now() WHERE id=wo.machine_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'state','paused');
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_resume(_work_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record; v_busy int;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id=_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state <> 'paused' THEN
    RAISE EXCEPTION 'WORK_ORDER_INVALID_STATE: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  IF wo.machine_id IS NOT NULL THEN
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE machine_id=wo.machine_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'MACHINE_BUSY' USING ERRCODE='P0001'; END IF;
    UPDATE public.manufacturing_machines SET status='busy', updated_at=now() WHERE id=wo.machine_id;
  END IF;
  UPDATE public.mo_operations SET state='in_progress' WHERE id=_work_order_id;
  INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, qty_done, qty_scrap, notes)
    VALUES (_work_order_id, wo.mo_id, wo.assigned_employee_id, now(), 0, 0, 'resume');
  RETURN jsonb_build_object('ok',true,'state','in_progress');
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_finish(
  _work_order_id uuid, _qty_done numeric, _qty_scrap numeric DEFAULT 0, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record; v_dur numeric; v_next uuid; v_open_qc int;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id=_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state NOT IN ('in_progress','paused') THEN
    RAISE EXCEPTION 'WORK_ORDER_INVALID_STATE: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  IF COALESCE(_qty_done,0) < 0 OR COALESCE(_qty_scrap,0) < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY' USING ERRCODE='22023';
  END IF;
  IF wo.is_qc = true THEN
    SELECT count(*) INTO v_open_qc FROM public.mo_quality_checks
      WHERE mo_operation_id=_work_order_id AND result='pass';
    IF v_open_qc = 0 THEN
      RAISE EXCEPTION 'QUALITY_CHECK_REQUIRED' USING ERRCODE='P0001';
    END IF;
  END IF;
  v_dur := EXTRACT(EPOCH FROM (now() - COALESCE(wo.actual_start_at, wo.started_at, now()))) / 60.0;
  UPDATE public.mo_operations SET
    state='done', actual_end_at=now(), finished_at=now(),
    actual_duration_minutes = COALESCE(actual_duration_minutes,0) + v_dur,
    qty_done = COALESCE(qty_done,0) + _qty_done,
    qty_scrap = COALESCE(qty_scrap,0) + COALESCE(_qty_scrap,0),
    notes = COALESCE(notes||E'\n','')||COALESCE(_notes,'')
  WHERE id=_work_order_id;
  UPDATE public.mo_workorder_logs
    SET finished_at = now(), qty_done = _qty_done, qty_scrap = COALESCE(_qty_scrap,0), notes='finish'
   WHERE mo_operation_id = _work_order_id AND finished_at IS NULL;
  IF wo.machine_id IS NOT NULL THEN
    UPDATE public.manufacturing_machines SET status='available', updated_at=now() WHERE id=wo.machine_id;
  END IF;
  SELECT id INTO v_next FROM public.mo_operations
    WHERE mo_id = wo.mo_id AND sequence > wo.sequence AND state = 'pending'
    ORDER BY sequence LIMIT 1;
  IF v_next IS NOT NULL THEN
    UPDATE public.mo_operations SET state='ready' WHERE id=v_next;
  END IF;
  RETURN jsonb_build_object('ok',true,'state','done','duration_minutes',v_dur);
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_report_issue(
  _work_order_id uuid, _issue_kind text, _description text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record; v_issue uuid;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id=_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.mo_issues(mo_id, mo_operation_id, kind, description, reported_by, reported_at)
    VALUES (wo.mo_id, _work_order_id, _issue_kind::mo_issue_kind, _description, auth.uid(), now())
    RETURNING id INTO v_issue;
  UPDATE public.mo_operations SET state='blocked', block_reason=_issue_kind WHERE id=_work_order_id;
  IF wo.machine_id IS NOT NULL THEN
    UPDATE public.manufacturing_machines SET status='available', updated_at=now() WHERE id=wo.machine_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'issue_id',v_issue,'state','blocked');
END $function$;

CREATE OR REPLACE FUNCTION public.work_order_quality_check(
  _work_order_id uuid, _result text, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE wo record; v_qc uuid; v_issue uuid;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id=_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _result NOT IN ('pass','fail','rework') THEN
    RAISE EXCEPTION 'INVALID_QC_RESULT: %', _result USING ERRCODE='22023';
  END IF;
  INSERT INTO public.mo_quality_checks(mo_id, mo_operation_id, result, needs_rework, notes, checked_by, checked_at, attachments)
    VALUES (wo.mo_id, _work_order_id, _result::mo_qc_result,
            CASE WHEN _result='rework' THEN true ELSE false END,
            _notes, auth.uid(), now(), '[]'::jsonb)
    RETURNING id INTO v_qc;
  IF _result = 'fail' THEN
    INSERT INTO public.mo_issues(mo_id, mo_operation_id, kind, description, reported_by, reported_at)
      VALUES (wo.mo_id, _work_order_id, 'defect'::mo_issue_kind,
              'QC fail: '||COALESCE(_notes,''), auth.uid(), now())
      RETURNING id INTO v_issue;
    UPDATE public.mo_operations SET state='blocked', block_reason='QC_FAIL' WHERE id=_work_order_id;
  ELSIF _result = 'rework' THEN
    UPDATE public.mo_operations SET is_rework=true, state='blocked', block_reason='QC_REWORK' WHERE id=_work_order_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'quality_check_id',v_qc,'result',_result,'issue_id',v_issue);
END $function$;

CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid, _qty_produced numeric DEFAULT NULL::numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  mo record; comp record; loc uuid; produced numeric;
  ratio numeric; consume_qty numeric; remaining numeric; take numeric;
  q record; dst_q record; before_q numeric; before_res numeric;
  total_consumed numeric;
  so_state text; v_case text;
  v_pkg_tracking boolean := false;
  v_tmpl record; v_unit int; v_unit_count int; v_per_unit numeric;
  v_pkg_ref text; v_pkg_status package_status;
  v_so_id uuid; v_sol_id uuid;
  v_tmpl_count int;
  v_payload jsonb;
  v_out record;
  v_out_qty numeric;
  v_out_loc uuid;
  v_out_type product_type;
  v_out_pkg_tracking boolean;
  v_total_pct numeric;
  v_unit_count_o int; v_per_unit_o numeric;
  v_outputs_created int := 0;
  v_parent_comp_id uuid;
  v_parent_mo_id uuid;
  v_new_pkg_id uuid;
  v_first_pkg_id uuid;
  v_has_wo boolean;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('already','done','mo_id',_mo); END IF;
  IF mo.state = 'cancelled' THEN RAISE EXCEPTION 'MO cancelada não pode ser fechada'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.mo_operations WHERE mo_id=_mo) INTO v_has_wo;
  IF v_has_wo THEN
    IF EXISTS(SELECT 1 FROM public.mo_operations WHERE mo_id=_mo AND state IN ('in_progress','paused','blocked')) THEN
      RAISE EXCEPTION 'WORK_ORDERS_NOT_DONE' USING ERRCODE='P0001';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.mo_operations op WHERE op.mo_id=_mo AND op.is_qc=true AND op.state='done'
        AND NOT EXISTS(SELECT 1 FROM public.mo_quality_checks qc WHERE qc.mo_operation_id=op.id AND qc.result='pass')
    ) THEN
      RAISE EXCEPTION 'QUALITY_CHECK_REQUIRED' USING ERRCODE='P0001';
    END IF;
    IF EXISTS(SELECT 1 FROM public.mo_issues WHERE mo_id=_mo AND resolved_at IS NULL) THEN
      RAISE EXCEPTION 'OPEN_BLOCKING_ISSUES' USING ERRCODE='P0001';
    END IF;
  END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;
  produced := COALESCE(_qty_produced, mo.qty);
  IF produced <= 0 THEN RAISE EXCEPTION 'qty_produced inválido'; END IF;
  ratio := produced / NULLIF(mo.qty, 0);
  v_parent_comp_id := mo.parent_mo_component_id;
  v_parent_mo_id := mo.parent_mo_id;
  IF v_parent_comp_id IS NOT NULL THEN v_case := 'sub_assembly';
  ELSIF mo.sale_order_id IS NULL OR mo.sale_order_line_id IS NULL THEN v_case := 'manual';
  ELSE
    SELECT state::text INTO so_state FROM public.sale_orders WHERE id = mo.sale_order_id;
    IF so_state IS NULL OR so_state IN ('cancelled','done','completed') THEN v_case := 'sale_cancelled';
    ELSE v_case := 'sale_active'; END IF;
  END IF;
  SELECT COALESCE(package_tracking_enabled,false) INTO v_pkg_tracking
    FROM public.products WHERE id = mo.product_id;
  IF v_pkg_tracking THEN
    SELECT count(*) INTO v_tmpl_count FROM public.product_package_templates
     WHERE product_id = mo.product_id AND active = true;
    IF v_tmpl_count = 0 THEN
      RAISE EXCEPTION 'Produto % tem rastreio por embalagens activo sem templates', mo.product_id;
    END IF;
  END IF;
  SELECT COALESCE(SUM(cost_allocation_percent),0) INTO v_total_pct
    FROM public.manufacturing_order_outputs
   WHERE manufacturing_order_id = _mo
     AND output_type IN ('co_product','byproduct','reusable_scrap');
  IF v_total_pct > 100 THEN
    RAISE EXCEPTION 'close_mo: soma de cost_allocation_percent dos outputs secundários (%) excede 100', v_total_pct
      USING ERRCODE = '22023';
  END IF;
  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    consume_qty := GREATEST(0, ROUND((comp.qty_required * ratio)::numeric, 4) - COALESCE(comp.qty_consumed,0));
    IF consume_qty <= 0 THEN CONTINUE; END IF;
    remaining := consume_qty; total_consumed := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND quantity > 0 ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.quantity);
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = quantity - take,
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_res, GREATEST(0, before_res - take),
        'MO', _mo, 'consume',
        'close_mo comp='||comp.id::text||' qty_before='||before_q::text);
      remaining := remaining - take;
      total_consumed := total_consumed + take;
    END LOOP;
    IF remaining > 0 THEN
      RAISE EXCEPTION 'Stock físico insuficiente para consumir componente % (faltam %)', comp.product_id, remaining;
    END IF;
    UPDATE public.mo_components
       SET qty_consumed = COALESCE(qty_consumed,0) + total_consumed,
           qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
     WHERE id = comp.id;
  END LOOP;
  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(mo.variant_id::text,'')
     AND location_id = loc LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now() WHERE id = dst_q.id;
    before_res := dst_q.reserved_quantity;
  ELSE
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced)
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
    before_res := 0;
  END IF;
  IF v_case = 'sub_assembly' THEN
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + produced, updated_at = now()
     WHERE id = dst_q.id AND reserved_quantity + produced <= quantity;
    UPDATE public.mo_components
       SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + produced),
           supply_method = 'manufacture' WHERE id = v_parent_comp_id;
    v_payload := jsonb_build_object('source','close_mo_subassembly_reserve_for_parent_mo',
      'mo_id', _mo, 'parent_mo_id', v_parent_mo_id,
      'parent_mo_component_id', v_parent_comp_id, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_mo_component_id, to_manufacturing_order_id, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo sub_assembly reserve for parent mo_component',
       v_parent_comp_id, v_parent_mo_id, v_payload);
    PERFORM public.mfg_refresh_component(v_parent_comp_id);
    PERFORM public.mfg_refresh_mo_state(v_parent_mo_id);
  ELSIF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id; v_sol_id := mo.sale_order_line_id;
    v_payload := jsonb_build_object('source','close_mo_reserve_finished_for_sale',
      'mo_id', _mo, 'sale_order_id', v_so_id, 'sale_order_line_id', v_sol_id, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, to_sale_order_line_id, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo finished_good intent reserve for SO line', v_sol_id, v_payload);
  ELSE
    v_payload := jsonb_build_object('source',
      CASE WHEN v_case = 'manual' THEN 'close_mo_for_stock' ELSE 'close_mo_cancelled_sale_to_stock' END,
      'mo_id', _mo, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, 0, produced,
       'MO', _mo, 'consume', auth.uid(),
       'close_mo finished_good to free stock', v_payload);
  END IF;
  IF v_pkg_tracking THEN
    v_unit_count := CASE WHEN produced = floor(produced) AND produced >= 1 THEN produced::int ELSE 1 END;
    v_per_unit := produced / v_unit_count;
    v_pkg_status := CASE
      WHEN v_case = 'sale_active'  THEN 'reserved'::package_status
      WHEN v_case = 'sub_assembly' THEN 'reserved'::package_status
      ELSE 'available'::package_status END;
    FOR v_unit IN 1..v_unit_count LOOP
      FOR v_tmpl IN
        SELECT * FROM public.product_package_templates
         WHERE product_id = mo.product_id AND active = true ORDER BY package_sequence LOOP
        v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
        INSERT INTO public.stock_packages
          (product_id, package_template_id, sale_order_id, sale_order_line_id, manufacturing_order_id,
           package_ref, package_sequence, package_total, package_group,
           qty, current_location_id, condition, status,
           length_cm, width_cm, height_cm, weight_kg, volume_m3,
           stackable, fragile, requires_flat_transport)
        VALUES (mo.product_id, v_tmpl.id,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_id ELSE NULL END,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_line_id ELSE NULL END,
           COALESCE(v_parent_mo_id, _mo),
           v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
           v_per_unit, loc, 'good'::package_condition, v_pkg_status,
           v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
           v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
           v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
        ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;
  FOR v_out IN
    SELECT * FROM public.manufacturing_order_outputs
     WHERE manufacturing_order_id = _mo
       AND output_type IN ('co_product','byproduct','reusable_scrap','waste')
     ORDER BY created_at FOR UPDATE
  LOOP
    v_out_qty := ROUND((COALESCE(v_out.qty_expected,0) * ratio)::numeric, 4);
    IF v_out_qty <= 0 THEN CONTINUE; END IF;
    IF v_out.output_type = 'waste' THEN
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES (v_out.product_id, NULL, NULL, NULL, v_out_qty, 0, 0,
         'MO', _mo, 'consume', auth.uid(), 'close_mo waste (no stock impact)',
         jsonb_build_object('source','close_mo_waste','mo_id',_mo,'output_id',v_out.id,
                            'output_type','waste','qty',v_out_qty));
      UPDATE public.manufacturing_order_outputs SET qty_done = v_out_qty, updated_at = now() WHERE id = v_out.id;
      v_outputs_created := v_outputs_created + 1;
      CONTINUE;
    END IF;
    v_out_loc := COALESCE(v_out.stock_location_id, loc);
    SELECT type, COALESCE(package_tracking_enabled,false) INTO v_out_type, v_out_pkg_tracking
      FROM public.products WHERE id = v_out.product_id;
    IF v_out_type = 'storable' THEN
      SELECT * INTO dst_q FROM public.stock_quants
       WHERE product_id = v_out.product_id AND location_id = v_out_loc AND variant_id IS NULL
       LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity = quantity + v_out_qty, updated_at = now() WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (v_out.product_id, v_out_loc, v_out_qty);
      END IF;
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES (v_out.product_id, NULL, v_out_loc, NULL, v_out_qty, 0, v_out_qty,
         'MO', _mo, 'consume', auth.uid(), 'close_mo secondary output to stock',
         jsonb_build_object('source','close_mo_output_to_stock','mo_id',_mo,
                            'output_id',v_out.id,'output_type',v_out.output_type,'qty',v_out_qty));
    END IF;
    v_first_pkg_id := NULL;
    IF v_out_pkg_tracking THEN
      SELECT count(*) INTO v_tmpl_count FROM public.product_package_templates
       WHERE product_id = v_out.product_id AND active = true;
      IF v_tmpl_count > 0 THEN
        v_unit_count_o := CASE WHEN v_out_qty = floor(v_out_qty) AND v_out_qty >= 1 THEN v_out_qty::int ELSE 1 END;
        v_per_unit_o := v_out_qty / v_unit_count_o;
        FOR v_unit IN 1..v_unit_count_o LOOP
          FOR v_tmpl IN
            SELECT * FROM public.product_package_templates
             WHERE product_id = v_out.product_id AND active = true ORDER BY package_sequence
          LOOP
            v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-OUT-' || replace(v_out.id::text,'-','')
                         || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
            v_new_pkg_id := NULL;
            INSERT INTO public.stock_packages
              (product_id, package_template_id, manufacturing_order_id,
               package_ref, package_sequence, package_total, package_group,
               qty, current_location_id, condition, status,
               length_cm, width_cm, height_cm, weight_kg, volume_m3,
               stackable, fragile, requires_flat_transport)
            VALUES (v_out.product_id, v_tmpl.id, _mo,
               v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
               v_per_unit_o, v_out_loc, 'good'::package_condition, 'available'::package_status,
               v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
               v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
               v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
            ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING
            RETURNING id INTO v_new_pkg_id;
            IF v_first_pkg_id IS NULL THEN
              IF v_new_pkg_id IS NULL THEN
                SELECT id INTO v_new_pkg_id FROM public.stock_packages WHERE package_ref = v_pkg_ref LIMIT 1;
              END IF;
              v_first_pkg_id := v_new_pkg_id;
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    END IF;
    UPDATE public.manufacturing_order_outputs
       SET qty_done = v_out_qty, stock_location_id = v_out_loc,
           created_stock_package_id = COALESCE(created_stock_package_id, v_first_pkg_id),
           updated_at = now()
     WHERE id = v_out.id;
    v_outputs_created := v_outputs_created + 1;
  END LOOP;
  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;
  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;
  IF v_case IN ('manual','sale_cancelled') THEN
    BEGIN
      PERFORM public.run_inventory_allocation(
        mo.product_id, mo.variant_id, loc, produced,
        CASE WHEN v_case='manual' THEN 'close_mo_for_stock' ELSE 'close_mo_cancelled_sale' END);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN jsonb_build_object(
    'mo_id', _mo, 'produced', produced, 'case', v_case,
    'package_tracking', v_pkg_tracking, 'outputs_processed', v_outputs_created,
    'parent_mo_id', v_parent_mo_id, 'parent_mo_component_id', v_parent_comp_id,
    'work_orders_checked', v_has_wo);
END $function$;