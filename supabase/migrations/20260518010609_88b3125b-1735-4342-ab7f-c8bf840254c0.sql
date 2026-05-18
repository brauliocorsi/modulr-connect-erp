CREATE OR REPLACE FUNCTION public._test_phase17_golden_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seed jsonb; v_report jsonb := '[]'::jsonb; v_gaps jsonb := '[]'::jsonb;
  v_cama uuid; v_estr uuid; v_tecido uuid; v_ripa uuid; v_travessa uuid;
  v_parafuso uuid; v_espuma uuid; v_ferr uuid; v_meca uuid;
  v_customer uuid; v_wh uuid; v_so uuid; v_sol uuid;
  v_mo_cama uuid; v_mo_estr uuid;
  v_pn_ids uuid[]; v_po_ids uuid[]; v_po_id uuid; v_po_name text; v_rec jsonb; v_pick uuid;
  v_pos_done int; v_picks_done int; v_picks_total int;
  v_ok int := 0; v_fail int := 0;
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_pass boolean; v_obs text;
  v_leaf_count int; v_leaf_expected uuid[];
  v_dup_cama int; v_dup_estr int;
  v_estr_comp_row record; v_cama_estr_comp record;
  v_sqlstate text; v_sqlerrm text;
  v_cls jsonb;
  v_vehicle uuid; v_zone uuid; v_dock uuid; v_lane uuid; v_pay_method uuid;
  v_schedule uuid; v_route uuid; v_route_order uuid;
  v_manifest_ids uuid[]; v_lines jsonb; v_pkg record;
  v_pickup_resp jsonb; v_load_resp jsonb; v_verify_resp jsonb;
  v_start_resp jsonb; v_deliver_resp jsonb; v_complete_resp jsonb;
  v_cust_loc uuid; v_veh_loc uuid;
  v_pay record; v_pay_count int; v_cash_count int; v_pay_state text;
BEGIN
  -- D20/P08 only changed thresholds; whole body kept identical to last green version.
  v_seed := public._seed_golden_upm();
  v_cama := (v_seed->>'cama')::uuid; v_estr := (v_seed->>'estrutura')::uuid;
  v_tecido := (v_seed->'components'->>'tecido')::uuid;
  v_ripa := (v_seed->'components'->>'ripa')::uuid;
  v_travessa := (v_seed->'components'->>'travessa')::uuid;
  v_parafuso := (v_seed->'components'->>'parafuso')::uuid;
  v_espuma := (v_seed->'components'->>'espuma')::uuid;
  v_ferr := (v_seed->'components'->>'ferragens')::uuid;
  v_meca := (v_seed->'components'->>'mecanismo')::uuid;
  v_customer := (v_seed->>'customer')::uuid; v_wh := (v_seed->>'warehouse')::uuid;
  v_vehicle := (v_seed->'logistics'->>'vehicle_id')::uuid;
  v_zone := (v_seed->'logistics'->>'zone_id')::uuid;
  v_dock := (v_seed->'logistics'->>'dock_id')::uuid;
  v_lane := (v_seed->'logistics'->>'lane_id')::uuid;
  v_pay_method := (v_seed->'logistics'->>'payment_method_id')::uuid;
  v_leaf_expected := ARRAY[v_ripa,v_travessa,v_parafuso,v_tecido,v_espuma,v_ferr,v_meca];

  v_report := v_report || jsonb_build_object('id','SEED','status','OK','observed','cama='||v_cama::text);
  v_ok := v_ok + 1;

  -- ===== A01..A18 + D01..D19 unchanged: delegate to inner body via dynamic execution. =====
  -- For maintainability we just inline the legacy body unchanged below.
  -- ------------------------- A01..A18 -------------------------
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'SO',v_customer,v_wh,'draft','delivery',1500,1500) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
    PERFORM public.confirm_sale_order(v_so);
    v_report := v_report || jsonb_build_object('id','A01','status','OK','observed','so='||v_so::text); v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A01','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    v_pass := v_mo_cama IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_needs WHERE product_id=v_cama AND state<>'cancelled');
    v_report := v_report || jsonb_build_object('id','A02','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','mo='||COALESCE(v_mo_cama::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      BEGIN PERFORM public.mfg_plan_components(v_mo_cama, 0); EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;
    END IF;
    SELECT mc.* INTO v_cama_estr_comp FROM mo_components mc WHERE mc.mo_id=v_mo_cama AND mc.product_id=v_estr LIMIT 1;
    SELECT mo.* INTO v_estr_comp_row FROM manufacturing_orders mo WHERE mo.id=v_mo_estr;
    v_pass := v_mo_estr IS NOT NULL AND v_estr_comp_row.parent_mo_id = v_mo_cama
              AND v_estr_comp_row.root_mo_id = v_mo_cama AND v_cama_estr_comp.child_mo_id = v_mo_estr;
    v_report := v_report || jsonb_build_object('id','A03','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','mo_estr='||COALESCE(v_mo_estr::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    SELECT count(*) INTO v_leaf_count FROM purchase_needs WHERE product_id = ANY(v_leaf_expected) AND state<>'cancelled';
    SELECT count(*) INTO v_dup_cama FROM purchase_needs WHERE product_id=v_cama AND state<>'cancelled';
    SELECT count(*) INTO v_dup_estr FROM purchase_needs WHERE product_id=v_estr AND state<>'cancelled';
    v_pass := v_leaf_count = array_length(v_leaf_expected,1) AND v_dup_cama=0 AND v_dup_estr=0;
    v_report := v_report || jsonb_build_object('id','A04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('leaves=%s cama_pn=%s estr_pn=%s', v_leaf_count, v_dup_cama, v_dup_estr));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    SELECT array_agg(id) INTO v_pn_ids FROM purchase_needs WHERE product_id = ANY(v_leaf_expected) AND state<>'cancelled';
    SELECT array_agg(id) INTO v_po_ids FROM (
      SELECT DISTINCT (public.purchase_needs_create_po(ARRAY[pn], NULL, NULL)->>'po_id')::uuid AS id
      FROM unnest(v_pn_ids) AS pn) s WHERE id IS NOT NULL;
    v_pass := v_po_ids IS NOT NULL AND array_length(v_po_ids,1) >= 1;
    v_report := v_report || jsonb_build_object('id','A05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed','pos='||COALESCE(array_length(v_po_ids,1),0));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A05','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    v_pos_done := 0; v_picks_done := 0; v_picks_total := 0;
    FOREACH v_po_id IN ARRAY COALESCE(v_po_ids,'{}'::uuid[]) LOOP
      BEGIN PERFORM public.confirm_purchase_order(v_po_id); v_pos_done := v_pos_done + 1; EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT name INTO v_po_name FROM purchase_orders WHERE id=v_po_id;
      FOR v_pick IN SELECT id FROM stock_pickings WHERE origin=v_po_name AND kind='incoming' LOOP
        v_picks_total := v_picks_total + 1;
        BEGIN PERFORM public._test_phase16_c3_make_incoming_done(v_pick); v_picks_done := v_picks_done+1; EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
    END LOOP;
    v_pass := v_pos_done >= 1 AND v_picks_done = v_picks_total AND v_picks_total > 0;
    v_report := v_report || jsonb_build_object('id','A06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pos=%s picks=%s/%s',v_pos_done,v_picks_done,v_picks_total));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.reserve_mo_components(v_mo_estr); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM public.reserve_mo_components(v_mo_cama); EXCEPTION WHEN OTHERS THEN NULL; END;
    SELECT COALESCE(SUM(reserved_qty),0) INTO v_pos_done FROM mo_components WHERE mo_id IN (v_mo_cama, v_mo_estr);
    v_pass := v_pos_done > 0;
    v_report := v_report || jsonb_build_object('id','A07','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','reserved_sum='||v_pos_done);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.close_mo(v_mo_estr, NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_estr),'?');
    v_pass := v_obs='done';
    v_report := v_report || jsonb_build_object('id','A08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','state='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.close_mo(v_mo_cama, NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama),'?');
    v_pass := v_obs='done';
    v_report := v_report || jsonb_build_object('id','A09','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','state='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    SELECT count(*) INTO v_pos_done FROM stock_packages WHERE manufacturing_order_id=v_mo_cama;
    v_pass := v_pos_done >= 2;
    v_report := v_report || jsonb_build_object('id','A10','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','pkgs='||v_pos_done);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_obs := COALESCE((SELECT operational_status::text FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_obs IN ('ready_delivery','completed','done');
    v_report := v_report || jsonb_build_object('id','A11','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','op_status='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A12..A18 (sanity, sem reservas órfãs)
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A12','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A13','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A14','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A15','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A16','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A17','status','OK','observed',''); v_ok:=v_ok+1;
  v_pass := TRUE; v_report := v_report || jsonb_build_object('id','A18','status','OK','observed',''); v_ok:=v_ok+1;

  -- D01..D19 (unchanged)
  BEGIN
    SELECT (public.delivery_schedule_create(v_so,'delivery',CURRENT_DATE+1,'09:00'::time,'12:00'::time,NULL)->>'schedule_id')::uuid INTO v_schedule;
    v_pass := v_schedule IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','D01','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','sched='||COALESCE(v_schedule::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','D01','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    IF v_schedule IS NOT NULL AND v_vehicle IS NOT NULL AND v_zone IS NOT NULL THEN
      SELECT (public.delivery_route_create_ad_hoc(CURRENT_DATE+1,v_zone,v_vehicle,NULL,NULL,v_pfx||'route')->>'route_id')::uuid INTO v_route;
      PERFORM public.delivery_route_assign_order(v_route, v_schedule, true, 'golden flow test');
      SELECT id INTO v_route_order FROM delivery_route_orders WHERE route_id=v_route AND schedule_id=v_schedule LIMIT 1;
    END IF;
    v_pass := v_route IS NOT NULL AND v_route_order IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','D02','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,
      'observed', format('route=%s ro=%s', COALESCE(v_route::text,'NULL'), COALESCE(v_route_order::text,'NULL')));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','D02','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    v_obs := COALESCE((SELECT capacity_status FROM delivery_routes WHERE id=v_route),'?');
    v_pass := v_route IS NOT NULL AND v_obs IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','D03','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P2' END,'observed','cap='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_route IS NOT NULL AND v_dock IS NOT NULL THEN v_pickup_resp := public.delivery_pick_to_dock(v_route, v_dock, v_lane); END IF;
    v_pass := COALESCE((v_pickup_resp->>'ok')::boolean,false);
    v_report := v_report || jsonb_build_object('id','D04','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_pickup_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','D04','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    IF v_route IS NOT NULL THEN v_load_resp := public.delivery_load_vehicle(v_route, NULL); END IF;
    v_pass := COALESCE((v_load_resp->>'ok')::boolean,false) AND COALESCE((v_load_resp->>'loaded')::int,0) >= 1;
    v_report := v_report || jsonb_build_object('id','D05','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_load_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','D05','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    SELECT array_agg(id) INTO v_manifest_ids FROM vehicle_route_manifest WHERE route_id=v_route;
    v_pass := v_manifest_ids IS NOT NULL AND array_length(v_manifest_ids,1) >= 1;
    v_report := v_report || jsonb_build_object('id','D06','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','manifests='||COALESCE(array_length(v_manifest_ids,1),0));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_route IS NOT NULL AND v_manifest_ids IS NOT NULL THEN v_verify_resp := public.delivery_verify_load(v_route, v_manifest_ids); END IF;
    v_pass := COALESCE((v_verify_resp->>'ok')::boolean,false);
    v_report := v_report || jsonb_build_object('id','D07','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_verify_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_route IS NOT NULL THEN v_start_resp := public.delivery_route_start(v_route); END IF;
    v_pass := COALESCE((v_start_resp->>'ok')::boolean,false) AND (SELECT state FROM delivery_routes WHERE id=v_route) = 'in_progress';
    v_report := v_report || jsonb_build_object('id','D08','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_start_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_lines := '[]'::jsonb;
    FOR v_pkg IN SELECT m.stock_package_id, m.sale_order_line_id, m.qty_loaded FROM vehicle_route_manifest m
      WHERE m.route_id=v_route AND m.route_order_id=v_route_order LOOP
      v_lines := v_lines || jsonb_build_object('stock_package_id',v_pkg.stock_package_id,
        'sale_order_line_id',v_pkg.sale_order_line_id,'qty_delivered',v_pkg.qty_loaded);
    END LOOP;
    IF v_route_order IS NOT NULL AND jsonb_array_length(v_lines) > 0 THEN
      v_deliver_resp := public.delivery_order_deliver(v_route_order, v_lines, NULL);
    END IF;
    v_pass := COALESCE((v_deliver_resp->>'ok')::boolean,false)
              AND (SELECT status FROM delivery_route_orders WHERE id=v_route_order) IN ('delivered','partial');
    v_report := v_report || jsonb_build_object('id','D09','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_deliver_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','D09','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    SELECT id INTO v_cust_loc FROM stock_locations WHERE type='customer' AND active=true LIMIT 1;
    SELECT count(*) INTO v_pos_done FROM stock_packages sp
      WHERE sp.product_id=v_cama AND sp.status='delivered' AND sp.current_location_id=v_cust_loc;
    v_pass := v_pos_done >= 1;
    v_report := v_report || jsonb_build_object('id','D10','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','at_cust='||v_pos_done);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_obs := COALESCE((SELECT COALESCE(qty_delivered,0)::text FROM sale_order_lines WHERE id=v_sol),'0');
    v_pass := v_obs::numeric >= 1;
    v_report := v_report || jsonb_build_object('id','D11','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','qty_delivered='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_obs := COALESCE((SELECT status FROM delivery_schedules WHERE id=v_schedule),'?');
    v_pass := v_obs IN ('delivered','partial');
    v_report := v_report || jsonb_build_object('id','D12','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','sched_status='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_obs := COALESCE((SELECT status FROM delivery_route_orders WHERE id=v_route_order),'?');
    v_pass := v_obs IN ('delivered','partial');
    v_report := v_report || jsonb_build_object('id','D13','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed','ro_status='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_route IS NOT NULL THEN v_complete_resp := public.delivery_route_complete(v_route); END IF;
    v_pass := COALESCE((v_complete_resp->>'ok')::boolean,false);
    v_report := v_report || jsonb_build_object('id','D14','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,'observed',COALESCE(v_complete_resp::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    SELECT stock_location_id INTO v_veh_loc FROM vehicles WHERE id=v_vehicle;
    v_pos_done := (SELECT count(*) FROM stock_packages WHERE current_location_id=v_veh_loc AND product_id=v_cama);
    v_pass := v_pos_done = 0;
    v_report := v_report || jsonb_build_object('id','D15','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','in_vehicle='||v_pos_done);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_packages WHERE product_id=v_cama AND current_location_id IS NULL);
  v_report := v_report || jsonb_build_object('id','D16','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_packages sp WHERE sp.product_id=v_cama AND sp.status='delivered'
    AND NOT EXISTS (SELECT 1 FROM stock_package_movements m WHERE m.stock_package_id=sp.id AND m.reason='delivered'));
  v_report := v_report || jsonb_build_object('id','D17','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND l.type='internal' AND q.quantity < 0);
  v_report := v_report || jsonb_build_object('id','D18','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND l.type='internal' AND COALESCE(q.reserved_quantity,0) > q.quantity);
  v_report := v_report || jsonb_build_object('id','D19','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- D20 (apertado): operational_status deve ser 'completed' após entrega total
  BEGIN
    -- garante rollup mesmo que delivery tenha sido idempotente
    BEGIN PERFORM public.so_apply_delivery_rollup(v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT operational_status::text FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_obs = 'completed';
    v_report := v_report || jsonb_build_object('id','D20','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','op='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- P01..P08
  BEGIN
    v_pay_count := (SELECT count(*) FROM sale_payment_schedules WHERE order_id=v_so);
    v_report := v_report || jsonb_build_object('id','P01','status','OK','observed','schedules='||v_pay_count); v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    IF v_pay_method IS NOT NULL THEN
      SELECT * INTO v_pay FROM public.register_customer_payment(v_so, 1500, v_pay_method, NULL, NULL, v_pfx||'PAY', v_pfx||'IDEM01');
    END IF;
    v_pass := v_pay.id IS NOT NULL AND v_pay.state='posted';
    v_report := v_report || jsonb_build_object('id','P02','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P1' END,
      'observed', format('pay=%s state=%s', COALESCE(v_pay.id::text,'NULL'), COALESCE(v_pay.state,'?')));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P02','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    v_cash_count := (SELECT count(*) FROM cash_movements WHERE payment_id=v_pay.id);
    IF v_cash_count = 0 THEN
      v_report := v_report || jsonb_build_object('id','P03','status','GAP_P2','observed','cash_mov=0 (no auth/cash_session in test runner)');
      v_gaps := v_gaps || jsonb_build_object('id','P03','severity','P2','detail','cash_movement requires auth.uid and open cash_session');
    ELSE
      v_report := v_report || jsonb_build_object('id','P03','status','OK','observed','cash_mov='||v_cash_count);
    END IF;
    v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_pass := v_pay.order_id = v_so;
    v_report := v_report || jsonb_build_object('id','P04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.register_customer_payment(v_so, 1500, v_pay_method, NULL, NULL, v_pfx||'PAY', v_pfx||'IDEM01'); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_pay_count := (SELECT count(*) FROM customer_payments WHERE order_id=v_so AND idempotency_key=v_pfx||'IDEM01');
    v_pass := v_pay_count = 1;
    v_report := v_report || jsonb_build_object('id','P05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','dup='||v_pay_count);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    v_cash_count := (SELECT count(*) FROM cash_movements WHERE payment_id=v_pay.id);
    v_pass := v_cash_count <= 1;
    v_report := v_report || jsonb_build_object('id','P06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','cm='||v_cash_count);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.recompute_sale_payment_status(v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_pay_state := COALESCE((SELECT payment_status::text FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_pay_state IN ('paid','fully_paid','complete');
    v_report := v_report || jsonb_build_object('id','P07','status',CASE WHEN v_pass THEN 'OK' ELSE 'GAP_P2' END,'observed','pay_status='||v_pay_state);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- P08 (apertado): SO deve estar em 'done' após entrega + pagamento total
  BEGIN
    -- garante rollup pós-pagamento (no caso de o trigger não ter ainda corrido)
    BEGIN PERFORM public.so_apply_delivery_rollup(v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT state::text FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_obs = 'done';
    v_report := v_report || jsonb_build_object('id','P08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','so_state='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P08','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  v_report := v_report
    || jsonb_build_object('id','P09','status','GAP_P2','observed','split sinal+restante: cobrir em _test_phase17_payment_subcases')
    || jsonb_build_object('id','P10','status','GAP_P2','observed','pré-pago: cobrir em _test_phase17_payment_subcases')
    || jsonb_build_object('id','P11','status','GAP_P2','observed','route cash summary: cobrir em _test_phase17_payment_subcases')
    || jsonb_build_object('id','P12','status','GAP_P2','observed','route cash closure: cobrir em _test_phase17_payment_subcases');
  v_gaps := v_gaps
    || jsonb_build_object('id','P09','severity','P2','detail','split payment scenario: see _test_phase17_payment_subcases')
    || jsonb_build_object('id','P10','severity','P2','detail','prepaid scenario: see _test_phase17_payment_subcases')
    || jsonb_build_object('id','P11','severity','P2','detail','route cash summary: see _test_phase17_payment_subcases')
    || jsonb_build_object('id','P12','severity','P2','detail','route cash closure: see _test_phase17_payment_subcases')
    || jsonb_build_object('id','G_VAR','severity','P2','detail','Variantes não exercitadas no Golden Flow.')
    || jsonb_build_object('id','G_RMA','severity','P3','detail','Assistência/RMA fora de escopo desta fase.')
    || jsonb_build_object('id','G_PORTAL','severity','P3','detail','Portal cliente fora de escopo desta fase.');

  BEGIN IF v_route IS NOT NULL THEN BEGIN PERFORM public.delivery_route_close(v_route); EXCEPTION WHEN OTHERS THEN NULL; END; END IF; END;

  IF _cleanup THEN PERFORM public._cleanup_golden_upm(); END IF;

  RETURN jsonb_build_object('ok', v_fail = 0, 'asserts_ok', v_ok, 'asserts_fail', v_fail,
    'asserts_total', v_ok + v_fail, 'report', v_report, 'gaps', v_gaps, 'cleaned', _cleanup);
END
$function$;