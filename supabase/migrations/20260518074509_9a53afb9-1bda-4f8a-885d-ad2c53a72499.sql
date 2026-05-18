
-- ============================================================
-- F18-B :: TEST RUNNER (Migration 4, rewritten without nested PROCEDURE)
-- ============================================================

CREATE OR REPLACE FUNCTION public._cleanup_phase18_service_flow()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_pfx text := 'TESTE_F18B_';
BEGIN
  -- damage reports for the test packages
  DELETE FROM package_damage_reports
   WHERE stock_package_id IN (SELECT id FROM stock_packages WHERE package_ref LIKE v_pfx||'%');
  -- delete service-side artifacts (cascades take care of items/attachments/tasks)
  DELETE FROM stock_reservation_log
   WHERE to_service_case_id IN (SELECT id FROM service_cases WHERE case_number LIKE 'SC/%'
                                AND (description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%'));
  -- stock_moves with purchase_need from F18B
  DELETE FROM stock_moves
   WHERE purchase_need_id IN (SELECT id FROM purchase_needs WHERE notes='service_case'
                              AND service_case_id IN (SELECT id FROM service_cases
                                                       WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%'));
  -- manufacturing orders for service cases
  DELETE FROM manufacturing_orders
   WHERE service_case_id IN (SELECT id FROM service_cases
                              WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%');
  -- purchase needs (and POs related must be left; purchase_orders not directly created here are kept)
  DELETE FROM purchase_needs
   WHERE service_case_id IN (SELECT id FROM service_cases
                              WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%');
  -- delivery_route_orders and routes used
  DELETE FROM delivery_route_orders
   WHERE schedule_id IN (SELECT id FROM delivery_schedules
                          WHERE service_case_id IN (SELECT id FROM service_cases
                                                     WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%')
                             OR notes LIKE v_pfx||'%');
  DELETE FROM delivery_routes WHERE notes LIKE v_pfx||'%';
  -- delivery schedules created by the test
  DELETE FROM delivery_schedules
   WHERE service_case_id IN (SELECT id FROM service_cases
                              WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%')
      OR notes LIKE v_pfx||'%';
  -- finally service_cases (cascades items/attachments/tasks)
  DELETE FROM service_cases
   WHERE description LIKE v_pfx||'%' OR internal_notes LIKE v_pfx||'%';
  -- ad-hoc test packages
  DELETE FROM stock_packages WHERE package_ref LIKE v_pfx||'%';
  -- test sale_orders
  DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%');
  DELETE FROM sale_orders WHERE name LIKE v_pfx||'%';
END $function$;

GRANT EXECUTE ON FUNCTION public._cleanup_phase18_service_flow() TO authenticated;

-- =============================================================
CREATE OR REPLACE FUNCTION public._test_phase18_service_assistance_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pfx        text := 'TESTE_F18B_';
  v_seed       jsonb;
  v_report     jsonb := '[]'::jsonb;
  v_ok         int := 0;
  v_fail       int := 0;
  v_user       uuid;
  v_customer   uuid;
  v_wh         uuid;
  v_cama       uuid;
  v_ripa       uuid;
  v_estr       uuid;
  v_zone       uuid;
  v_loc_stock  uuid;
  v_so         uuid;
  v_sol        uuid;
  v_pkg        uuid;
  v_pkg_orphan uuid;
  v_case       uuid;
  v_case2      uuid;
  v_case_cancel uuid;
  v_case_wp    uuid;
  v_case_wm    uuid;
  v_item_buy   uuid;
  v_item_mfg   uuid;
  v_item_pkg   uuid;
  v_att        uuid;
  v_need       uuid;
  v_need2      uuid;
  v_mo         uuid;
  v_mo2        uuid;
  v_sched      uuid;
  v_sched2     uuid;
  v_route      uuid;
  v_move       uuid;
  v_quant_qty  numeric;
  v_quant_res  numeric;
  v_log_rows   int;
  v_qty_reserved numeric;
  v_status     text;
  v_count      int;
  v_health     jsonb;
  v_findings   jsonb;
  v_pass       boolean;
  v_sqlstate   text;
  v_sqlerrm    text;
  v_pn         record;
  v_sc         record;
BEGIN
  PERFORM public._cleanup_phase18_service_flow();
  v_seed     := public._seed_golden_upm();
  v_customer := (v_seed->>'customer')::uuid;
  v_wh       := (v_seed->>'warehouse')::uuid;
  v_cama     := (v_seed->>'cama')::uuid;
  v_estr     := (v_seed->>'estrutura')::uuid;
  v_ripa     := (v_seed->'components'->>'ripa')::uuid;
  v_zone     := (v_seed->'logistics'->>'zone_id')::uuid;
  SELECT id INTO v_loc_stock FROM stock_locations WHERE name='Stock' LIMIT 1;

  SELECT ug.user_id INTO v_user
    FROM user_groups ug JOIN groups g ON g.id=ug.group_id
   WHERE g.code='inventory_user' ORDER BY ug.user_id LIMIT 1;
  IF v_user IS NULL THEN
    SELECT ug.user_id INTO v_user FROM user_groups ug JOIN groups g ON g.id=ug.group_id
     WHERE g.code='system_admin' ORDER BY ug.user_id LIMIT 1;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: no test user available';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  -- Base SO used by multiple asserts
  INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
    VALUES (v_pfx||'SO',v_customer,v_wh,'confirmed','delivery',1500,1500) RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
    VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
  INSERT INTO stock_packages(product_id, current_location_id, package_ref, qty, status)
    VALUES (v_cama, v_loc_stock, v_pfx||'PKG1', 1, 'available') RETURNING id INTO v_pkg;

  v_report := v_report || jsonb_build_object('id','SETUP','status','OK','observed',
    format('so=%s sol=%s pkg=%s user=%s', v_so, v_sol, v_pkg, v_user));
  v_ok := v_ok+1;

  -- ===== A01 Create service_case linked to SO =====
  BEGIN
    v_case := public.service_case_create(jsonb_build_object(
      'sale_order_id', v_so, 'sale_order_line_id', v_sol,
      'customer_id', v_customer, 'product_id', v_cama,
      'case_type','customer_claim','source','customer',
      'priority','high','description', v_pfx||'A01 main case'));
    v_pass := v_case IS NOT NULL AND EXISTS(SELECT 1 FROM service_cases WHERE id=v_case AND status='new');
    v_report := v_report || jsonb_build_object('id','A01','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('case=%s', v_case));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A01','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
    RAISE EXCEPTION 'A01 hard fail: %', v_sqlerrm;  -- can't continue without case
  END;

  -- ===== A02 Add item linked to sale_order_line =====
  BEGIN
    v_item_buy := public.service_case_add_item(v_case, jsonb_build_object(
      'product_id', v_ripa, 'sale_order_line_id', v_sol,
      'issue_type','missing','qty', 2));
    v_pass := EXISTS(SELECT 1 FROM service_case_items WHERE id=v_item_buy AND sale_order_line_id=v_sol);
    v_report := v_report || jsonb_build_object('id','A02','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('item_buy=%s', v_item_buy));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A02','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A03 Add item linked to stock_package =====
  BEGIN
    v_item_pkg := public.service_case_add_item(v_case, jsonb_build_object(
      'product_id', v_cama, 'stock_package_id', v_pkg,
      'issue_type','damaged','qty', 1));
    v_pass := EXISTS(SELECT 1 FROM service_case_items WHERE id=v_item_pkg AND stock_package_id=v_pkg);
    v_report := v_report || jsonb_build_object('id','A03','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('item_pkg=%s', v_item_pkg));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A03','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A04 Add attachment metadata =====
  BEGIN
    v_att := public.service_case_add_attachment_metadata(v_case, jsonb_build_object(
      'file_url','https://example.test/f.jpg','file_name','f.jpg',
      'file_type','image/jpeg','attachment_type','customer_photo'));
    v_pass := EXISTS(SELECT 1 FROM service_case_attachments WHERE id=v_att AND service_case_id=v_case);
    v_report := v_report || jsonb_build_object('id','A04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('att=%s', v_att));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A04','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A05 Triage sets responsibility + default action =====
  BEGIN
    PERFORM public.service_case_triage(v_case, jsonb_build_object(
      'responsibility','supplier','warranty_status','in_warranty',
      'default_required_action','send_part','next_status','triage'));
    SELECT responsibility::text, status::text INTO v_status, v_sqlerrm FROM service_cases WHERE id=v_case;
    v_pass := v_status='supplier' AND EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case AND required_action='send_part');
    v_report := v_report || jsonb_build_object('id','A05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('resp=%s status=%s', v_status, v_sqlerrm));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A05','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A06 Item w/ purchased part creates purchase_need =====
  BEGIN
    v_need := public.service_case_create_purchase_need(v_item_buy);
    SELECT * INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := v_pn.id IS NOT NULL
              AND v_pn.service_case_id = v_case
              AND v_pn.service_case_item_id = v_item_buy
              AND v_pn.origin_kind = 'service_case';
    v_report := v_report || jsonb_build_object('id','A06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('need=%s origin=%s', v_need, v_pn.origin_kind));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A06','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A07 purchase_need preserves product_variant_id =====
  BEGIN
    -- v_ripa has no variant; assert column is preserved (null in both)
    SELECT * INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := COALESCE(v_pn.product_variant_id::text,'') = COALESCE((SELECT product_variant_id::text FROM service_case_items WHERE id=v_item_buy),'');
    v_report := v_report || jsonb_build_object('id','A07','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pn.variant=%s', v_pn.product_variant_id));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A07','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A08 purchase_need -> PO via purchase_needs_create_po =====
  BEGIN
    PERFORM public.purchase_needs_create_po(ARRAY[v_need], NULL, NULL);
    SELECT purchase_order_id, state::text INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := v_pn.purchase_order_id IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('po=%s state=%s', v_pn.purchase_order_id, v_pn.state));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A08','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A09 Receipt of purchased part reserves to service_case_item =====
  BEGIN
    -- simulate PO receipt via stock_move state transition (trigger does the reservation)
    INSERT INTO stock_moves(product_id, source_location_id, destination_location_id,
                            quantity, quantity_done, state, purchase_need_id, reference)
    VALUES (v_ripa, v_loc_stock, v_loc_stock, 2, 0, 'draft', v_need, v_pfx||'A09_MOVE')
    RETURNING id INTO v_move;
    UPDATE stock_moves SET state='done', quantity_done=2 WHERE id=v_move;

    SELECT count(*) INTO v_log_rows FROM stock_reservation_log
     WHERE to_service_case_item_id=v_item_buy AND origin_type='stock_move' AND origin_id=v_move;
    SELECT qty_reserved INTO v_qty_reserved FROM service_case_items WHERE id=v_item_buy;
    v_pass := v_log_rows = 1 AND v_qty_reserved >= 2;
    v_report := v_report || jsonb_build_object('id','A09','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('log_rows=%s qty_reserved=%s', v_log_rows, v_qty_reserved));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A09','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A10 Purchased part not available as free stock =====
  BEGIN
    SELECT quantity, reserved_quantity INTO v_quant_qty, v_quant_res
      FROM stock_quants WHERE product_id=v_ripa AND location_id=v_loc_stock
      ORDER BY updated_at DESC LIMIT 1;
    v_pass := COALESCE(v_quant_qty,0) >= 2 AND COALESCE(v_quant_res,0) >= 2
              AND COALESCE(v_quant_qty,0) - COALESCE(v_quant_res,0) <= 0;
    v_report := v_report || jsonb_build_object('id','A10','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('qty=%s reserved=%s available=%s', v_quant_qty, v_quant_res, COALESCE(v_quant_qty,0)-COALESCE(v_quant_res,0)));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A10','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A11 Item w/ manufactured part creates MO =====
  BEGIN
    v_item_mfg := public.service_case_add_item(v_case, jsonb_build_object(
      'product_id', v_estr, 'issue_type','defective','qty',1));
    v_mo := public.service_case_create_manufacturing_order(v_item_mfg);
    v_pass := EXISTS(SELECT 1 FROM manufacturing_orders WHERE id=v_mo
                     AND service_case_id=v_case AND service_case_item_id=v_item_mfg
                     AND origin='service_case');
    v_report := v_report || jsonb_build_object('id','A11','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('mo=%s item_mfg=%s', v_mo, v_item_mfg));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A11','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A12 MO done -> reserved to service_case_item =====
  BEGIN
    -- simulate MO completion (trigger does the reservation)
    UPDATE manufacturing_orders SET state='done', qty=1 WHERE id=v_mo;
    SELECT count(*) INTO v_log_rows FROM stock_reservation_log
      WHERE to_service_case_item_id=v_item_mfg AND origin_type='manufacturing_order' AND origin_id=v_mo;
    SELECT qty_reserved INTO v_qty_reserved FROM service_case_items WHERE id=v_item_mfg;
    v_pass := v_log_rows = 1 AND COALESCE(v_qty_reserved,0) >= 1;
    v_report := v_report || jsonb_build_object('id','A12','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('log_rows=%s qty_reserved=%s', v_log_rows, v_qty_reserved));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A12','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A13 Schedule assistance with fulfillment_type='assistance' =====
  BEGIN
    v_sched := public.service_case_schedule_assistance(v_case, CURRENT_DATE + 5, v_zone);
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched
                     AND fulfillment_type='assistance' AND service_case_id=v_case);
    v_report := v_report || jsonb_build_object('id','A13','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('sched=%s', v_sched));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A13','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A14 Assign assistance to a route =====
  BEGIN
    INSERT INTO delivery_routes(zone_id, route_date, state, notes)
      VALUES (v_zone, CURRENT_DATE + 5, 'planned', v_pfx||'ROUTE_A14') RETURNING id INTO v_route;
    INSERT INTO delivery_route_orders(route_id, schedule_id, sequence, status)
      VALUES (v_route, v_sched, 1, 'planned');
    UPDATE delivery_schedules SET route_id=v_route, status='assigned' WHERE id=v_sched;
    v_pass := EXISTS(SELECT 1 FROM delivery_route_orders WHERE route_id=v_route AND schedule_id=v_sched);
    v_report := v_report || jsonb_build_object('id','A14','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('route=%s', v_route));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A14','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A15 Execute assistance on route (mark delivered) =====
  BEGIN
    UPDATE delivery_route_orders SET status='delivered', delivered_at=now()
     WHERE route_id=v_route AND schedule_id=v_sched;
    UPDATE delivery_schedules SET status='delivered', physical_state='delivered'
     WHERE id=v_sched;
    -- close out tasks created by RPCs so close() succeeds
    UPDATE service_tasks SET status='done' WHERE service_case_id=v_case AND status IN ('open','in_progress');
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched AND status='delivered');
    v_report := v_report || jsonb_build_object('id','A15','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('sched_status=delivered'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A15','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A16 Close service_case =====
  BEGIN
    PERFORM public.service_case_close(v_case, 'Resolved in test');
    v_pass := EXISTS(SELECT 1 FROM service_cases WHERE id=v_case
                     AND status='done' AND closed_resolution='Resolved in test');
    v_report := v_report || jsonb_build_object('id','A16','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('case=done'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A16','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A17 Damaged package w/o service_case triggers health check =====
  BEGIN
    INSERT INTO stock_packages(product_id, current_location_id, package_ref, qty, status)
      VALUES (v_cama, v_loc_stock, v_pfx||'PKG_ORPHAN', 1, 'available') RETURNING id INTO v_pkg_orphan;
    INSERT INTO package_damage_reports(stock_package_id, damage_type, description, status)
      VALUES (v_pkg_orphan, 'broken', v_pfx||'orphan damage', 'reported');
    v_health := public.erp_service_health_check(30);
    v_findings := v_health->'findings';
    v_pass := EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_findings) f
       WHERE f->>'code'='damaged_package_without_service_case'
         AND (f->>'entity_id')::uuid IN
             (SELECT id FROM package_damage_reports WHERE stock_package_id=v_pkg_orphan));
    v_report := v_report || jsonb_build_object('id','A17','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('hc.p0=%s', (v_health->'summary'->>'p0')));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A17','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A18 waiting_parts without purchase_need triggers health check =====
  BEGIN
    INSERT INTO service_cases(case_number, customer_id, case_type, source, status, description)
      VALUES (public.next_service_case_number(), v_customer, 'other', 'internal',
              'waiting_parts', v_pfx||'A18 wp')
      RETURNING id INTO v_case_wp;
    v_health := public.erp_service_health_check(30);
    v_pass := EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_health->'findings') f
       WHERE f->>'code'='service_case_waiting_parts_without_purchase_need'
         AND (f->>'entity_id')::uuid = v_case_wp);
    v_report := v_report || jsonb_build_object('id','A18','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('case_wp=%s', v_case_wp));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A18','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A19 waiting_manufacturing without MO triggers health check =====
  BEGIN
    INSERT INTO service_cases(case_number, customer_id, case_type, source, status, description)
      VALUES (public.next_service_case_number(), v_customer, 'other', 'internal',
              'waiting_manufacturing', v_pfx||'A19 wm')
      RETURNING id INTO v_case_wm;
    v_health := public.erp_service_health_check(30);
    v_pass := EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_health->'findings') f
       WHERE f->>'code'='service_case_waiting_manufacturing_without_mo'
         AND (f->>'entity_id')::uuid = v_case_wm);
    v_report := v_report || jsonb_build_object('id','A19','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('case_wm=%s', v_case_wm));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A19','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A20 No duplicate purchase_need for same service_case_item =====
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'SO2',v_customer,v_wh,'confirmed','delivery',100,100) RETURNING id INTO v_so;
    v_case2 := public.service_case_create(jsonb_build_object(
      'sale_order_id', v_so, 'customer_id', v_customer,
      'case_type','customer_claim','source','customer',
      'description', v_pfx||'A20 dup-need'));
    v_item_buy := public.service_case_add_item(v_case2, jsonb_build_object(
      'product_id', v_ripa, 'issue_type','missing','qty', 1));
    v_need  := public.service_case_create_purchase_need(v_item_buy);
    v_need2 := public.service_case_create_purchase_need(v_item_buy);
    SELECT count(*) INTO v_count FROM purchase_needs WHERE service_case_item_id=v_item_buy;
    v_pass := v_need = v_need2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A20','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('need=%s need2=%s count=%s', v_need, v_need2, v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A20','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A21 No duplicate MO for same service_case_item =====
  BEGIN
    v_item_mfg := public.service_case_add_item(v_case2, jsonb_build_object(
      'product_id', v_estr, 'issue_type','defective','qty', 1));
    v_mo  := public.service_case_create_manufacturing_order(v_item_mfg);
    v_mo2 := public.service_case_create_manufacturing_order(v_item_mfg);
    SELECT count(*) INTO v_count FROM manufacturing_orders WHERE service_case_item_id=v_item_mfg;
    v_pass := v_mo = v_mo2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A21','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('mo=%s mo2=%s count=%s', v_mo, v_mo2, v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A21','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A22 No duplicate active delivery_schedule =====
  BEGIN
    v_sched  := public.service_case_schedule_assistance(v_case2, CURRENT_DATE + 7, v_zone);
    v_sched2 := public.service_case_schedule_assistance(v_case2, CURRENT_DATE + 7, v_zone);
    SELECT count(*) INTO v_count FROM delivery_schedules
     WHERE service_case_id=v_case2 AND status NOT IN ('cancelled','delivered','rescheduled');
    v_pass := v_sched = v_sched2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A22','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('sched=%s sched2=%s count=%s', v_sched, v_sched2, v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A22','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  -- ===== A23 Cancel preserves history =====
  BEGIN
    v_case_cancel := public.service_case_create(jsonb_build_object(
      'customer_id', v_customer, 'case_type','other','source','internal',
      'description', v_pfx||'A23 to cancel'));
    PERFORM public.service_case_add_item(v_case_cancel, jsonb_build_object(
      'product_id', v_ripa, 'issue_type','other','qty',1));
    PERFORM public.service_case_cancel(v_case_cancel, 'test-cancel');
    SELECT status::text, internal_notes INTO v_status, v_sqlerrm FROM service_cases WHERE id=v_case_cancel;
    v_pass := v_status='cancelled'
              AND v_sqlerrm ILIKE '%[CANCEL]%'
              AND EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case_cancel);
    v_report := v_report || jsonb_build_object('id','A23','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('status=%s history_items_preserved=true', v_status));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A23','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail+1;
  END;

  IF _cleanup THEN
    PERFORM public._cleanup_phase18_service_flow();
  END IF;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('ok', v_ok, 'fail', v_fail, 'total', v_ok+v_fail),
    'details', v_report);
END $function$;

GRANT EXECUTE ON FUNCTION public._test_phase18_service_assistance_flow(boolean) TO authenticated;
