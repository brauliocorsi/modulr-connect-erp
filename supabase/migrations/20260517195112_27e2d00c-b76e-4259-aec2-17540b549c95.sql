-- F16-C.6 BLOCKS C/D: shopfloor health checks + _test_phase16_shopfloor_workorders
-- Additive: keeps erp_health_check body untouched and wraps via erp_health_check_run.

CREATE OR REPLACE FUNCTION public.erp_health_check_shopfloor(_threshold_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_findings jsonb := '[]'::jsonb; v_row record;
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
BEGIN
  FOR v_row IN SELECT mo.id, mo.code FROM manufacturing_orders mo
    WHERE mo.state='done' AND EXISTS(SELECT 1 FROM mo_operations op WHERE op.mo_id=mo.id
      AND op.state IN ('pending','ready','in_progress','paused','blocked')) LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','mo_done_with_open_work_orders','severity','P0','entity','manufacturing_order','entity_id',v_row.id,'detail',format('MO %s done com WOs abertas', v_row.code));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT mo.id, mo.code, op.id AS op_id FROM manufacturing_orders mo
    JOIN mo_operations op ON op.mo_id=mo.id
    WHERE mo.state='done' AND op.is_qc=true AND op.state='done'
      AND NOT EXISTS(SELECT 1 FROM mo_quality_checks qc WHERE qc.mo_operation_id=op.id AND qc.result='pass') LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','mo_closed_without_required_quality','severity','P0','entity','manufacturing_order','entity_id',v_row.id,'detail',format('MO %s done QC op=%s sem pass', v_row.code, v_row.op_id));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT op.id FROM mo_operations op
    JOIN manufacturing_orders mo ON mo.id=op.mo_id
    LEFT JOIN bom_operations bo ON bo.bom_id=mo.bom_id AND bo.sequence=op.sequence
    WHERE op.state='in_progress' AND op.assigned_employee_id IS NULL AND COALESCE(bo.requires_employee,false)=true LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_order_in_progress_without_employee','severity','P0','entity','mo_operation','entity_id',v_row.id,'detail',format('WO %s sem employee', v_row.id));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT machine_id, count(*) AS n FROM mo_operations
    WHERE machine_id IS NOT NULL AND state='in_progress' GROUP BY machine_id HAVING count(*)>1 LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_order_machine_conflict','severity','P0','entity','manufacturing_machine','entity_id',v_row.machine_id,'detail',format('Máquina %s em %s WOs', v_row.machine_id, v_row.n));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT op.id, op.sequence FROM mo_operations op
    WHERE op.state IN ('in_progress','done')
      AND EXISTS(SELECT 1 FROM mo_operations prev WHERE prev.mo_id=op.mo_id AND prev.sequence<op.sequence AND prev.state IN ('pending','ready')) LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_order_sequence_violation','severity','P0','entity','mo_operation','entity_id',v_row.id,'detail',format('WO %s seq violada', v_row.id));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT m.id, m.code FROM manufacturing_machines m
    WHERE m.status='busy' AND NOT EXISTS(SELECT 1 FROM mo_operations op WHERE op.machine_id=m.id AND op.state='in_progress') LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','machine_busy_without_work_order','severity','P0','entity','manufacturing_machine','entity_id',v_row.id,'detail',format('Máquina %s busy órfã', COALESCE(v_row.code,v_row.id::text)));
    v_p0 := v_p0+1;
  END LOOP;
  FOR v_row IN SELECT op.id, op.actual_start_at FROM mo_operations op
    WHERE op.state='in_progress' AND COALESCE(op.actual_start_at, op.started_at) < now() - interval '8 hours' LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_order_stuck_in_progress','severity','P1','entity','mo_operation','entity_id',v_row.id,'detail',format('WO %s stuck', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;
  FOR v_row IN SELECT op.id FROM mo_operations op
    WHERE op.state='blocked'
      AND NOT EXISTS(SELECT 1 FROM mo_issues iss WHERE iss.mo_operation_id=op.id AND iss.resolved_at IS NULL)
      AND COALESCE(op.block_reason,'') NOT IN ('QC_FAIL','QC_REWORK','CRITICAL_COMPONENT_MISSING') LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_order_blocked_without_issue','severity','P1','entity','mo_operation','entity_id',v_row.id,'detail',format('WO %s blocked sem issue', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;
  FOR v_row IN SELECT bo.id, bo.bom_id, bo.sequence, bo.name FROM bom_operations bo
    WHERE bo.active=true AND bo.work_center_id IS NULL AND bo.workcenter IS NULL
      AND EXISTS(SELECT 1 FROM work_centers wc WHERE wc.active=true) LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','operation_without_work_center','severity','P1','entity','bom_operation','entity_id',v_row.id,'detail',format('Op %s sem WC', COALESCE(v_row.name,v_row.sequence::text)));
    v_p1 := v_p1+1;
  END LOOP;
  FOR v_row IN SELECT op.id, mc.product_id FROM mo_operations op
    JOIN mo_components mc ON mc.mo_id=op.mo_id
      AND COALESCE(mc.operation_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(op.operation_id,'00000000-0000-0000-0000-000000000000'::uuid)
    WHERE op.state IN ('ready','pending') AND mc.is_critical=true
      AND COALESCE(mc.qty_reserved,0) < mc.qty_required LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','critical_component_missing_for_operation','severity','P1','entity','mo_operation','entity_id',v_row.id,'detail',format('WO %s comp crit prod=%s', v_row.id, v_row.product_id));
    v_p1 := v_p1+1;
  END LOOP;
  FOR v_row IN SELECT id, name FROM work_centers WHERE active=true AND (capacity_per_day IS NULL OR capacity_per_day<=0) LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','work_center_without_capacity','severity','P2','entity','work_center','entity_id',v_row.id,'detail',format('WC %s sem capacidade', v_row.name));
    v_p2 := v_p2+1;
  END LOOP;
  FOR v_row IN SELECT id, name FROM manufacturing_machines WHERE active=true AND work_center_id IS NULL LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','machine_without_work_center','severity','P2','entity','manufacturing_machine','entity_id',v_row.id,'detail',format('Máquina %s sem WC', v_row.name));
    v_p2 := v_p2+1;
  END LOOP;
  -- employee_without_work_center: limitação — hr_employees não tem work_center_id (P2 inerte)
  FOR v_row IN SELECT id, name FROM bom_operations WHERE active=true AND (duration_minutes IS NULL OR duration_minutes<=0) LOOP
    v_findings := v_findings || jsonb_build_object('category','shopfloor','code','operation_without_duration','severity','P2','entity','bom_operation','entity_id',v_row.id,'detail',format('Op %s sem duração', COALESCE(v_row.name,v_row.id::text)));
    v_p2 := v_p2+1;
  END LOOP;
  RETURN jsonb_build_object('findings',v_findings,'p0',v_p0,'p1',v_p1,'p2',v_p2,'total',v_p0+v_p1+v_p2);
END $function$;

CREATE OR REPLACE FUNCTION public.erp_health_check_run(_threshold_days integer DEFAULT 7)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb; v_shopfloor jsonb;
  v_findings jsonb; v_summary jsonb;
  v_p0 int; v_p1 int; v_p2 int; v_p3 int;
  v_log_id uuid; v_admin record; v_critical int;
BEGIN
  v_result := erp_health_check(_threshold_days);
  v_shopfloor := erp_health_check_shopfloor(_threshold_days);
  v_findings := COALESCE(v_result->'findings','[]'::jsonb) || COALESCE(v_shopfloor->'findings','[]'::jsonb);
  v_p0 := COALESCE((v_result->'summary'->>'p0')::int,0) + COALESCE((v_shopfloor->>'p0')::int,0);
  v_p1 := COALESCE((v_result->'summary'->>'p1')::int,0) + COALESCE((v_shopfloor->>'p1')::int,0);
  v_p2 := COALESCE((v_result->'summary'->>'p2')::int,0) + COALESCE((v_shopfloor->>'p2')::int,0);
  v_p3 := COALESCE((v_result->'summary'->>'p3')::int,0);
  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', COALESCE((v_result->'summary'->>'duration_ms')::int,0),
    'shopfloor_p0', COALESCE((v_shopfloor->>'p0')::int,0),
    'shopfloor_p1', COALESCE((v_shopfloor->>'p1')::int,0),
    'shopfloor_p2', COALESCE((v_shopfloor->>'p2')::int,0));
  INSERT INTO erp_health_check_log (summary, findings, p0_count, p1_count, p2_count, p3_count, duration_ms)
  VALUES (v_summary, v_findings, v_p0, v_p1, v_p2, v_p3, (v_summary->>'duration_ms')::int)
  RETURNING id INTO v_log_id;
  v_critical := v_p0 + v_p1;
  IF v_critical > 0 THEN
    FOR v_admin IN SELECT ug.user_id FROM user_groups ug JOIN groups g ON g.id=ug.group_id WHERE g.code='system_admin' LOOP
      INSERT INTO notifications (user_id, module, type, title, body, link, payload, priority, entity_type, entity_id)
      VALUES (v_admin.user_id, 'core'::app_module, 'health_check_critical',
        format('Health check: %s P0 / %s P1', v_p0, v_p1),
        format('Encontradas %s inconsistências críticas. Log %s.', v_critical, v_log_id),
        '/settings/health', v_summary, 'high', 'erp_health_check_log', v_log_id);
    END LOOP;
    UPDATE erp_health_check_log SET notified=true WHERE id=v_log_id;
  END IF;
  RETURN v_log_id;
END $function$;

CREATE OR REPLACE FUNCTION public._sf_assert(_arr jsonb, _name text, _ok boolean, _obs text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT _arr || jsonb_build_object('name',_name,'passed',_ok,'observed',_obs)
$$;

CREATE OR REPLACE FUNCTION public._test_phase16_shopfloor_workorders()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_prefix text := 'p16sf_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_wh uuid; v_loc uuid;
  v_finished uuid; v_comp1 uuid; v_comp2 uuid;
  v_bom uuid; v_mo uuid; v_op_a uuid; v_op_b uuid; v_op_qc uuid;
  v_wc uuid; v_m1 uuid; v_m2 uuid; v_emp1 uuid; v_emp2 uuid;
  v_n int; v_state mo_op_state; v_dur numeric;
  v_sub_finished uuid; v_sub_bom uuid; v_sub_mo uuid;
  v_legacy_mo uuid;
  v_mo2 uuid; v_op2 uuid; v_mo3 uuid; v_op3 uuid;
  v_mo4 uuid; v_op4 uuid; v_mo5 uuid; v_op5 uuid;
  v_mo6 uuid; v_op6 uuid; v_mo7 uuid;
  v_neg int; v_over int; v_busy_no_wo int; v_dup_emp int;
  v_ok boolean;
BEGIN
  SELECT w.id INTO v_wh FROM warehouses w
   WHERE EXISTS(SELECT 1 FROM stock_locations sl WHERE sl.warehouse_id=w.id AND sl.type='internal' AND sl.active=true)
   AND w.active=true ORDER BY w.created_at LIMIT 1;
  v_loc := _wh_main_internal_loc(v_wh);
  INSERT INTO products(name, internal_ref, type, can_be_manufactured, can_be_sold)
    VALUES (v_prefix||'_finished', v_prefix||'_F','storable',true,true) RETURNING id INTO v_finished;
  INSERT INTO products(name, internal_ref, type) VALUES (v_prefix||'_comp1', v_prefix||'_C1','storable') RETURNING id INTO v_comp1;
  INSERT INTO products(name, internal_ref, type) VALUES (v_prefix||'_comp2', v_prefix||'_C2','storable') RETURNING id INTO v_comp2;
  INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_comp1, v_loc, 100);
  INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_comp2, v_loc, 100);
  INSERT INTO boms(product_id, code, quantity) VALUES (v_finished, 'BOM_'||v_prefix, 1) RETURNING id INTO v_bom;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES (v_bom, v_comp1, 2, 10);
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES (v_bom, v_comp2, 1, 20);
  INSERT INTO work_centers(name, code, type, capacity_per_day, warehouse_id)
    VALUES (v_prefix||'_wc', 'WC_'||v_prefix, 'assembly', 8, v_wh) RETURNING id INTO v_wc;
  INSERT INTO manufacturing_machines(name, code, work_center_id, status)
    VALUES (v_prefix||'_m1','M1_'||v_prefix,v_wc,'available') RETURNING id INTO v_m1;
  INSERT INTO manufacturing_machines(name, code, work_center_id, status)
    VALUES (v_prefix||'_m2','M2_'||v_prefix,v_wc,'available') RETURNING id INTO v_m2;
  INSERT INTO hr_employees(full_name) VALUES (v_prefix||'_e1') RETURNING id INTO v_emp1;
  INSERT INTO hr_employees(full_name) VALUES (v_prefix||'_e2') RETURNING id INTO v_emp2;
  INSERT INTO bom_operations(bom_id, sequence, name, work_center_id, duration_minutes, requires_machine, requires_employee)
    VALUES (v_bom, 10, 'Op A', v_wc, 30, true, true);
  INSERT INTO bom_operations(bom_id, sequence, name, work_center_id, duration_minutes, requires_machine, requires_employee)
    VALUES (v_bom, 20, 'Op B', v_wc, 20, true, true);
  INSERT INTO bom_operations(bom_id, sequence, name, work_center_id, duration_minutes, requires_quality_check)
    VALUES (v_bom, 30, 'QC final', v_wc, 10, true);
  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo;
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence) VALUES (v_mo, v_comp1, 2, 10);
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence) VALUES (v_mo, v_comp2, 1, 20);

  BEGIN v_n := mfg_materialize_work_orders(v_mo);
    v_results := _sf_assert(v_results,'01_materialize_creates_operations', v_n=3, format('created=%s', v_n));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'01_materialize_creates_operations', false, SQLERRM); END;
  BEGIN v_n := mfg_materialize_work_orders(v_mo);
    v_results := _sf_assert(v_results,'02_materialize_idempotent', v_n=0, format('second=%s', v_n));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'02_materialize_idempotent', false, SQLERRM); END;

  SELECT id, state INTO v_op_a, v_state FROM mo_operations WHERE mo_id=v_mo AND sequence=10;
  SELECT id INTO v_op_b FROM mo_operations WHERE mo_id=v_mo AND sequence=20;
  SELECT id INTO v_op_qc FROM mo_operations WHERE mo_id=v_mo AND sequence=30;
  v_results := _sf_assert(v_results,'03_first_ready_others_pending',
    v_state='ready' AND (SELECT state FROM mo_operations WHERE id=v_op_b)='pending'
      AND (SELECT state FROM mo_operations WHERE id=v_op_qc)='pending',
    format('a=%s b=%s qc=%s', v_state,
      (SELECT state::text FROM mo_operations WHERE id=v_op_b),
      (SELECT state::text FROM mo_operations WHERE id=v_op_qc)));

  BEGIN PERFORM work_order_start(v_op_a, v_emp1, v_m1);
    v_ok := (SELECT state FROM mo_operations WHERE id=v_op_a)='in_progress'
        AND (SELECT machine_id FROM mo_operations WHERE id=v_op_a)=v_m1
        AND (SELECT status FROM manufacturing_machines WHERE id=v_m1)='busy';
    v_results := _sf_assert(v_results,'04_work_order_start', v_ok, 'ok');
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'04_work_order_start', false, SQLERRM); END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo2;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state, work_center_id)
    VALUES (v_mo2, 10, 'X', 10, 'ready', v_wc) RETURNING id INTO v_op2;
  BEGIN PERFORM work_order_start(v_op2, v_emp2, v_m1);
    v_results := _sf_assert(v_results,'05_machine_conflict_blocked', false, 'sem exceção');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'05_machine_conflict_blocked', SQLERRM ILIKE '%MACHINE%', SQLERRM);
  END;
  BEGIN PERFORM work_order_start(v_op2, v_emp1, v_m2);
    v_results := _sf_assert(v_results,'06_employee_conflict_blocked', false, 'sem exceção');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'06_employee_conflict_blocked', SQLERRM ILIKE '%EMPLOYEE%', SQLERRM);
  END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo3;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state, work_center_id)
    VALUES (v_mo3, 10, 'X', 10, 'ready', v_wc) RETURNING id INTO v_op3;
  INSERT INTO mo_components(mo_id, product_id, qty_required, qty_reserved, is_critical, sequence)
    VALUES (v_mo3, v_comp1, 5, 0, true, 10);
  BEGIN PERFORM work_order_start(v_op3, NULL, NULL);
    v_results := _sf_assert(v_results,'07_critical_component_blocks', false,
      'sem exceção, state='||(SELECT state::text FROM mo_operations WHERE id=v_op3));
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'07_critical_component_blocks',
      SQLERRM ILIKE '%CRITICAL%' AND (SELECT state FROM mo_operations WHERE id=v_op3)='blocked', SQLERRM);
  END;

  BEGIN PERFORM work_order_pause(v_op_a, 'almoço');
    v_results := _sf_assert(v_results,'08_pause',
      (SELECT state FROM mo_operations WHERE id=v_op_a)='paused'
        AND (SELECT status FROM manufacturing_machines WHERE id=v_m1)='available','ok');
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'08_pause', false, SQLERRM); END;
  BEGIN PERFORM work_order_resume(v_op_a);
    v_results := _sf_assert(v_results,'09_resume',
      (SELECT state FROM mo_operations WHERE id=v_op_a)='in_progress','ok');
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'09_resume', false, SQLERRM); END;

  PERFORM pg_sleep(1);
  BEGIN PERFORM work_order_finish(v_op_a, 1, 0, 'done A');
    SELECT actual_duration_minutes INTO v_dur FROM mo_operations WHERE id=v_op_a;
    v_results := _sf_assert(v_results,'10_finish_calculates',
      v_dur > 0 AND (SELECT qty_done FROM mo_operations WHERE id=v_op_a)=1,
      format('dur=%s qty_done=%s', v_dur, (SELECT qty_done FROM mo_operations WHERE id=v_op_a)));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'10_finish_calculates', false, SQLERRM); END;

  v_results := _sf_assert(v_results,'11_next_op_ready',
    (SELECT state FROM mo_operations WHERE id=v_op_b)='ready',
    (SELECT state::text FROM mo_operations WHERE id=v_op_b));

  BEGIN PERFORM work_order_start(v_op_b, v_emp1, v_m1); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM work_order_finish(v_op_b, 1, 0, 'done B'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM work_order_start(v_op_qc, v_emp1, NULL);
    BEGIN PERFORM work_order_finish(v_op_qc, 1, 0, 'sem QC');
      v_results := _sf_assert(v_results,'12_qc_required_exigido', false, 'finish ok inesperado');
    EXCEPTION WHEN OTHERS THEN
      v_results := _sf_assert(v_results,'12_qc_required_exigido', SQLERRM ILIKE '%QUALITY_CHECK_REQUIRED%', SQLERRM);
    END;
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'12_qc_required_exigido', false, 'start failed: '||SQLERRM); END;

  BEGIN PERFORM work_order_quality_check(v_op_qc, 'fail', 'defeito');
    v_results := _sf_assert(v_results,'13_qc_fail_blocks_and_issue',
      (SELECT state FROM mo_operations WHERE id=v_op_qc)='blocked'
        AND EXISTS(SELECT 1 FROM mo_issues WHERE mo_operation_id=v_op_qc AND resolved_at IS NULL),
      (SELECT state::text FROM mo_operations WHERE id=v_op_qc));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'13_qc_fail_blocks_and_issue', false, SQLERRM); END;

  BEGIN
    UPDATE mo_issues SET resolved_at=now() WHERE mo_operation_id=v_op_qc AND resolved_at IS NULL;
    UPDATE mo_operations SET state='in_progress', block_reason=NULL WHERE id=v_op_qc;
    PERFORM work_order_quality_check(v_op_qc, 'pass', 'ok');
    PERFORM work_order_finish(v_op_qc, 1, 0, 'qc done');
    v_results := _sf_assert(v_results,'14_qc_pass_finishes',
      (SELECT state FROM mo_operations WHERE id=v_op_qc)='done','done');
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'14_qc_pass_finishes', false, SQLERRM); END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo4;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (v_mo4, 10, 'X', 10, 'in_progress') RETURNING id INTO v_op4;
  BEGIN PERFORM close_mo(v_mo4, 1);
    v_results := _sf_assert(v_results,'15_close_blocked_open_wo', false, 'close ok inesperado');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'15_close_blocked_open_wo', SQLERRM ILIKE '%WORK_ORDERS_NOT_DONE%', SQLERRM);
  END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo5;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state, is_qc)
    VALUES (v_mo5, 10, 'QC', 10, 'done', true) RETURNING id INTO v_op5;
  BEGIN PERFORM close_mo(v_mo5, 1);
    v_results := _sf_assert(v_results,'16_close_blocked_qc_missing', false, 'close ok inesperado');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'16_close_blocked_qc_missing', SQLERRM ILIKE '%QUALITY_CHECK_REQUIRED%', SQLERRM);
  END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_mo6;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (v_mo6, 10, 'X', 10, 'done') RETURNING id INTO v_op6;
  INSERT INTO mo_issues(mo_id, mo_operation_id, kind, description, reported_at)
    VALUES (v_mo6, v_op6, 'defect', 'aberta', now());
  BEGIN PERFORM close_mo(v_mo6, 1);
    v_results := _sf_assert(v_results,'17_close_blocked_open_issue', false, 'close ok inesperado');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'17_close_blocked_open_issue', SQLERRM ILIKE '%OPEN_BLOCKING_ISSUES%', SQLERRM);
  END;

  BEGIN PERFORM close_mo(v_mo, 1);
    v_results := _sf_assert(v_results,'18_close_ok_all_done',
      (SELECT state FROM manufacturing_orders WHERE id=v_mo)='done',
      (SELECT state::text FROM manufacturing_orders WHERE id=v_mo));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'18_close_ok_all_done', false, SQLERRM); END;

  BEGIN
    INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
      VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_legacy_mo;
    PERFORM close_mo(v_legacy_mo, 1);
    v_results := _sf_assert(v_results,'19_legacy_no_wo_closes',
      (SELECT state FROM manufacturing_orders WHERE id=v_legacy_mo)='done','legacy ok');
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'19_legacy_no_wo_closes', false, SQLERRM); END;

  BEGIN
    INSERT INTO products(name, internal_ref, type, can_be_manufactured)
      VALUES (v_prefix||'_sub', v_prefix||'_SUB','storable',true) RETURNING id INTO v_sub_finished;
    INSERT INTO boms(product_id, code, quantity) VALUES (v_sub_finished,'BOMSUB_'||v_prefix,1) RETURNING id INTO v_sub_bom;
    INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES (v_sub_bom, v_comp1, 1, 10);
    INSERT INTO bom_operations(bom_id, sequence, name, work_center_id, duration_minutes)
      VALUES (v_sub_bom, 10, 'SUB op', v_wc, 15);
    INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
      VALUES (mfg_next_code(), v_sub_finished, v_sub_bom, 1, v_wh, 'draft','manual') RETURNING id INTO v_sub_mo;
    v_n := mfg_materialize_work_orders(v_sub_mo);
    v_results := _sf_assert(v_results,'20_subassembly_materializes', v_n>=1, format('sub_ops=%s', v_n));
  EXCEPTION WHEN OTHERS THEN v_results := _sf_assert(v_results,'20_subassembly_materializes', false, SQLERRM); END;

  INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, warehouse_id, state, origin)
    VALUES (mfg_next_code(), v_finished, v_bom, 1, v_wh, 'cancelled','manual') RETURNING id INTO v_mo7;
  BEGIN PERFORM close_mo(v_mo7, 1);
    v_results := _sf_assert(v_results,'21_cancel_blocks_close', false, 'close ok inesperado');
  EXCEPTION WHEN OTHERS THEN
    v_results := _sf_assert(v_results,'21_cancel_blocks_close',
      SQLERRM ILIKE '%cancel%' OR SQLERRM ILIKE '%cancelada%', SQLERRM);
  END;

  SELECT count(*) INTO v_neg FROM stock_quants WHERE quantity < 0;
  SELECT count(*) INTO v_over FROM stock_quants WHERE reserved_quantity > quantity;
  SELECT count(*) INTO v_busy_no_wo FROM manufacturing_machines m
    WHERE m.status='busy' AND NOT EXISTS(SELECT 1 FROM mo_operations op WHERE op.machine_id=m.id AND op.state='in_progress');
  SELECT COALESCE(SUM(n-1),0) INTO v_dup_emp FROM (
    SELECT count(*) AS n FROM mo_operations
    WHERE assigned_employee_id IS NOT NULL AND state='in_progress'
    GROUP BY assigned_employee_id HAVING count(*) > 1
  ) x;
  v_results := _sf_assert(v_results,'22_invariants',
    v_neg=0 AND v_over=0 AND v_busy_no_wo=0 AND v_dup_emp=0,
    format('neg=%s over=%s busy_no_wo=%s dup_emp=%s', v_neg, v_over, v_busy_no_wo, v_dup_emp));

  UPDATE manufacturing_machines SET status='available' WHERE id IN (v_m1, v_m2);

  RETURN jsonb_build_object('prefix', v_prefix,
    'total', jsonb_array_length(v_results),
    'passed', (SELECT count(*) FROM jsonb_array_elements(v_results) e WHERE (e->>'passed')::boolean),
    'failed', (SELECT count(*) FROM jsonb_array_elements(v_results) e WHERE NOT (e->>'passed')::boolean),
    'tests', v_results);
END $function$;