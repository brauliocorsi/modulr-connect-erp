-- M4 FIX: _m4_make_move must NOT write stock_moves.package_id (that FK points to legacy product_packages).
-- Link between stock_move and stock_package is via stock_package_movements.stock_move_id (set by package_move).

CREATE OR REPLACE FUNCTION public._m4_make_move(_product uuid, _src uuid, _dst uuid, _qty numeric, _ref text, _pkg uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  -- _pkg is intentionally ignored: stock_moves.package_id references the legacy product_packages table.
  -- Physical link to stock_packages is maintained by package_move() via stock_package_movements.stock_move_id.
  INSERT INTO stock_moves(product_id, source_location_id, destination_location_id,
                          quantity, quantity_done, state, reference)
  VALUES (_product, _src, _dst, _qty, _qty, 'done', _ref)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Patch test cleanup to use stock_package_movements.stock_move_id instead of legacy package_id
CREATE OR REPLACE FUNCTION public._test_phase15_m4()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_warehouse uuid; v_zone uuid; v_vehicle uuid; v_dock uuid; v_lane uuid; v_lane_loc uuid;
  v_veh_loc uuid; v_src_loc uuid; v_cust_loc uuid; v_ret_good uuid; v_ret_damaged uuid;
  v_so uuid; v_so2 uuid; v_sol uuid; v_sol2 uuid; v_sched uuid; v_sched2 uuid;
  v_route uuid; v_route2 uuid; v_dro uuid; v_dro2 uuid;
  v_pkg uuid; v_pkg2 uuid; v_man uuid; v_prod uuid;
  v_user uuid; v_count int; v_jsonb jsonb;
  pass int := 0; fail int := 0; res jsonb := '[]'::jsonb;
BEGIN
  -- Need a logistics user context; assume current setting in test mode
  -- Pick a tracked product (Mesa Aurora)
  SELECT id INTO v_prod FROM products WHERE package_tracking_enabled = true ORDER BY created_at LIMIT 1;
  IF v_prod IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tracked_product');
  END IF;

  SELECT id INTO v_warehouse FROM stock_warehouses ORDER BY created_at LIMIT 1;
  SELECT id INTO v_src_loc FROM stock_locations WHERE warehouse_id=v_warehouse AND usage='internal' LIMIT 1;
  SELECT id INTO v_cust_loc FROM stock_locations WHERE usage='customer' LIMIT 1;
  IF v_cust_loc IS NULL THEN
    INSERT INTO stock_locations(name, usage, code) VALUES ('TEST_CUST','customer','TC') RETURNING id INTO v_cust_loc;
  END IF;
  v_ret_good := public._m4_return_loc('good');
  v_ret_damaged := public._m4_return_loc('damaged');

  -- Minimal entities for test
  INSERT INTO delivery_zones(name, code) VALUES ('TEST_M4_Z','TM4Z')
    ON CONFLICT DO NOTHING;
  SELECT id INTO v_zone FROM delivery_zones WHERE code='TM4Z';

  INSERT INTO vehicles(plate, model, status, stock_location_id, usable_volume_m3, max_weight_kg,
                       usable_length_cm, usable_width_cm, usable_height_cm, supports_flat_transport)
  VALUES ('TEST_M4_V','TM4', 'available', v_src_loc, 10, 2000, 300, 180, 200, true)
  RETURNING id, stock_location_id INTO v_vehicle, v_veh_loc;

  INSERT INTO loading_docks(warehouse_id, code, name) VALUES (v_warehouse, 'TM4D','TestDock')
  RETURNING id INTO v_dock;
  INSERT INTO loading_dock_lanes(dock_id, code, name, stock_location_id)
  VALUES (v_dock, 'L1','Lane1', v_src_loc) RETURNING id, stock_location_id INTO v_lane, v_lane_loc;

  -- Sale order & schedule
  INSERT INTO sale_orders(name, state, customer_id)
  VALUES ('TEST_M4_SO1','confirmed', (SELECT id FROM customers ORDER BY created_at LIMIT 1))
  RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, qty_ordered, price_unit)
  VALUES (v_so, v_prod, 1, 100) RETURNING id INTO v_sol;

  INSERT INTO delivery_schedules(sale_order_id, scheduled_date, status, zone_id)
  VALUES (v_so, current_date, 'scheduled', v_zone) RETURNING id INTO v_sched;

  INSERT INTO delivery_routes(zone_id, vehicle_id, route_date, status)
  VALUES (v_zone, v_vehicle, current_date, 'planned') RETURNING id INTO v_route;
  INSERT INTO delivery_route_orders(route_id, schedule_id, sequence, status)
  VALUES (v_route, v_sched, 1, 'pending') RETURNING id INTO v_dro;

  -- A stock_package owned by SO, sitting at v_src_loc
  INSERT INTO stock_packages(product_id, sale_order_id, status, condition, qty, current_location_id,
                             length_cm, width_cm, height_cm, weight_kg, volume_m3, stackable, fragile, requires_flat_transport)
  VALUES (v_prod, v_so, 'available','good', 1, v_src_loc, 180, 90, 8, 28, 0.13, true, false, false)
  RETURNING id INTO v_pkg;

  -- T1: pick_to_dock
  v_jsonb := public.delivery_pick_to_dock(v_route, v_dock, v_lane);
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',1,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',1,'ok',false,'r',v_jsonb); END IF;

  -- T2: package now in lane location
  SELECT COUNT(*) INTO v_count FROM stock_packages WHERE id=v_pkg AND current_location_id=v_lane_loc;
  IF v_count=1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',2,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',2,'ok',false); END IF;

  -- T3: stock_package_movements has stock_move_id
  SELECT COUNT(*) INTO v_count FROM stock_package_movements
   WHERE stock_package_id=v_pkg AND to_location_id=v_lane_loc AND stock_move_id IS NOT NULL;
  IF v_count>=1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',3,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',3,'ok',false); END IF;

  -- T4: load_vehicle
  v_jsonb := public.delivery_load_vehicle(v_route);
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',4,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',4,'ok',false,'r',v_jsonb); END IF;

  -- T5: manifest has stock_package_id
  SELECT id INTO v_man FROM vehicle_route_manifest WHERE route_id=v_route AND stock_package_id=v_pkg;
  IF v_man IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t',5,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',5,'ok',false); END IF;

  -- T6: package at vehicle location
  SELECT COUNT(*) INTO v_count FROM stock_packages WHERE id=v_pkg AND current_location_id=v_veh_loc;
  IF v_count=1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',6,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',6,'ok',false); END IF;

  -- T7: route start
  PERFORM public.delivery_verify_load(v_route);
  v_jsonb := public.delivery_route_start(v_route);
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',7,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',7,'ok',false,'r',v_jsonb); END IF;

  -- T8: order deliver
  v_jsonb := public.delivery_order_deliver(v_dro,
    jsonb_build_array(jsonb_build_object('sale_order_line_id',v_sol,'stock_package_id',v_pkg,'qty_delivered',1)));
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',8,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',8,'ok',false,'r',v_jsonb); END IF;

  -- T9: package at customer loc
  SELECT COUNT(*) INTO v_count FROM stock_packages WHERE id=v_pkg AND current_location_id=v_cust_loc;
  IF v_count=1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',9,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',9,'ok',false); END IF;

  -- T10: route_close blocks if stock still on vehicle: create extra pkg never delivered
  INSERT INTO stock_packages(product_id, sale_order_id, status, condition, qty, current_location_id,
                             length_cm, width_cm, height_cm, weight_kg, volume_m3, stackable, fragile, requires_flat_transport)
  VALUES (v_prod, v_so, 'available','good', 1, v_veh_loc, 60, 55, 85, 8, 0.28, true, false, false)
  RETURNING id INTO v_pkg2;
  v_jsonb := public.delivery_route_close(v_route);
  IF (v_jsonb->>'ok')::boolean = false THEN pass:=pass+1; res:=res||jsonb_build_object('t',10,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',10,'ok',false,'r',v_jsonb); END IF;

  -- T11: return damaged
  v_jsonb := public.delivery_return_to_warehouse(v_route,
    jsonb_build_array(jsonb_build_object('stock_package_id',v_pkg2,'qty',1,'return_condition','damaged','reason','dano transporte')),
    v_ret_damaged);
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',11,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',11,'ok',false,'r',v_jsonb); END IF;

  -- T12: damage report exists
  IF EXISTS (SELECT 1 FROM stock_packages WHERE id=v_pkg2 AND condition='damaged')
     AND EXISTS (SELECT 1 FROM package_damage_report WHERE stock_package_id=v_pkg2)
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',12,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',12,'ok',false); END IF;

  -- T13: damaged not in available (status reflects)
  IF NOT EXISTS (SELECT 1 FROM stock_packages WHERE id=v_pkg2 AND status='available' AND condition='good')
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',13,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',13,'ok',false); END IF;

  -- T14: invariants
  IF NOT COALESCE((SELECT (value::text)::boolean FROM app_settings WHERE key='package_tracking_enabled'),false)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
                     WHERE c.relname='stock_quants' AND tg.tgname ILIKE '%package%' AND NOT tg.tgisinternal)
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',14,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',14,'ok',false); END IF;

  -- T15: no stock_moves.package_id leak to stock_packages.id
  IF NOT EXISTS (SELECT 1 FROM stock_moves sm WHERE sm.package_id IN (v_pkg, v_pkg2))
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',15,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',15,'ok',false); END IF;

  -- T16: every package movement to vehicle has a manifest row
  IF NOT EXISTS (
    SELECT 1 FROM stock_packages sp
     WHERE sp.current_location_id = v_veh_loc
       AND NOT EXISTS (SELECT 1 FROM vehicle_route_manifest m WHERE m.stock_package_id=sp.id)
  ) THEN pass:=pass+1; res:=res||jsonb_build_object('t',16,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',16,'ok',false); END IF;

  -- T17: route_complete after no stock on vehicle
  PERFORM public.delivery_route_complete(v_route);
  v_jsonb := public.delivery_route_close(v_route);
  IF (v_jsonb->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',17,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',17,'ok',false,'r',v_jsonb); END IF;

  -- cleanup (use stock_package_movements.stock_move_id, not legacy package_id)
  DELETE FROM package_damage_report WHERE stock_package_id IN (v_pkg, v_pkg2);
  DELETE FROM stock_moves WHERE id IN (SELECT stock_move_id FROM stock_package_movements WHERE stock_package_id IN (v_pkg, v_pkg2) AND stock_move_id IS NOT NULL);
  DELETE FROM stock_package_movements WHERE stock_package_id IN (v_pkg, v_pkg2);
  DELETE FROM vehicle_route_manifest WHERE route_id=v_route;
  DELETE FROM dock_transfers WHERE route_id=v_route;
  DELETE FROM delivery_route_orders WHERE route_id=v_route;
  DELETE FROM delivery_schedules WHERE id=v_sched;
  DELETE FROM delivery_routes WHERE id=v_route;
  DELETE FROM stock_packages WHERE id IN (v_pkg, v_pkg2);
  DELETE FROM sale_order_timeline WHERE sale_order_id=v_so;
  DELETE FROM sale_order_lines WHERE order_id=v_so;
  DELETE FROM sale_orders WHERE id=v_so;
  DELETE FROM vehicles WHERE id=v_vehicle;
  DELETE FROM loading_dock_lanes WHERE id=v_lane;
  DELETE FROM loading_docks WHERE id=v_dock;
  DELETE FROM delivery_zones WHERE id=v_zone;

  RETURN jsonb_build_object('ok', fail=0, 'pass', pass, 'fail', fail, 'results', res);
END $$;