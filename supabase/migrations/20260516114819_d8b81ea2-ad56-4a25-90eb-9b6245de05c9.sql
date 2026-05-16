CREATE OR REPLACE FUNCTION public._test_phase15_m4()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  res jsonb := '[]'::jsonb; pass int := 0; fail int := 0;
  tag text := 'TESTE_M4_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_uom uuid; v_loc uuid; v_dock_loc uuid; v_lane_loc uuid;
  v_zone uuid; v_vehicle uuid; v_veh_loc uuid; v_warehouse uuid;
  v_dock uuid; v_lane uuid;
  v_product uuid := '9be30b8e-a281-4cb3-ba7a-7732a1ef75f2'; -- Cadeira Baltic
  v_so uuid; v_sched uuid; v_route uuid; v_dro uuid; v_sol uuid;
  v_pkg uuid; r jsonb; v_man uuid;
  v_dmg_loc uuid; v_count int;
  v_pkg2 uuid; v_so2 uuid; v_sched2 uuid; v_route2 uuid; v_dro2 uuid; v_sol2 uuid;
BEGIN
  SELECT id INTO v_partner FROM partners WHERE active=true LIMIT 1;
  SELECT id INTO v_uom FROM product_uom LIMIT 1;
  SELECT id INTO v_loc FROM stock_locations WHERE type='internal' AND return_kind IS NULL LIMIT 1;
  SELECT id INTO v_warehouse FROM warehouses LIMIT 1;
  IF v_partner IS NULL OR v_uom IS NULL OR v_loc IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','no_fixtures');
  END IF;

  INSERT INTO stock_locations(name,type,active) VALUES (tag||'_DOCK','internal',true) RETURNING id INTO v_dock_loc;
  INSERT INTO stock_locations(name,type,active) VALUES (tag||'_LANE','internal',true) RETURNING id INTO v_lane_loc;
  INSERT INTO stock_locations(name,type,active) VALUES (tag||'_VEH','internal',true) RETURNING id INTO v_veh_loc;
  INSERT INTO loading_docks(warehouse_id,name,stock_location_id,active) VALUES (v_warehouse,tag||'_D',v_dock_loc,true) RETURNING id INTO v_dock;
  INSERT INTO loading_dock_lanes(dock_id,code,stock_location_id,active) VALUES (v_dock,'A',v_lane_loc,true) RETURNING id INTO v_lane;

  INSERT INTO delivery_zones(name,zip_from,zip_to,max_deliveries_per_day,max_assembly_minutes_per_day,weekdays)
  VALUES (tag||'_z','00000','99999',5,500,ARRAY[0,1,2,3,4,5,6]::smallint[]) RETURNING id INTO v_zone;

  INSERT INTO vehicles(name,active,stock_location_id,volume_m3,weight_kg,assembly_minutes_capacity,
                       usable_length_cm,usable_width_cm,usable_height_cm,usable_volume_m3,max_weight_kg,supports_flat_transport)
  VALUES (tag||'_v',true,v_veh_loc,100,5000,1000,500,200,220,100,5000,true) RETURNING id INTO v_vehicle;

  INSERT INTO stock_packages(product_id, package_template_id, package_ref, qty, current_location_id,
                              condition, status, is_virtual)
  SELECT v_product, id, tag||'_PKG', 1, v_loc, 'good', 'available', false
    FROM product_package_templates WHERE product_id=v_product LIMIT 1
  RETURNING id INTO v_pkg;

  INSERT INTO sale_orders(name,partner_id,state,operational_status,amount_total)
  VALUES (tag||'_so',v_partner,'confirmed'::sale_state,'reserved',100) RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price,subtotal,line_kind)
  VALUES (v_so,v_product,1,v_uom,100,100,'product') RETURNING id INTO v_sol;
  UPDATE stock_packages SET sale_order_id=v_so, sale_order_line_id=v_sol WHERE id=v_pkg;

  r := public.delivery_schedule_create(v_so,'home_delivery',CURRENT_DATE+1,NULL,NULL,NULL);
  v_sched := (r->>'schedule_id')::uuid;
  r := public.delivery_schedule_assign(v_sched, CURRENT_DATE+1, v_zone, NULL, NULL);
  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+1, v_zone, v_vehicle, NULL, NULL, tag);
  v_route := (r->>'route_id')::uuid;
  r := public.delivery_route_assign_order(v_route, v_sched, false, NULL);
  SELECT id INTO v_dro FROM delivery_route_orders WHERE route_id=v_route AND schedule_id=v_sched;

  -- T1
  r := public.delivery_pick_to_dock(v_route, v_dock, v_lane);
  IF (r->>'ok')='true' AND (SELECT current_location_id FROM stock_packages WHERE id=v_pkg)=v_lane_loc
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',1,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',1,'ok',false,'r',r); END IF;

  -- T2 idempotent
  PERFORM public.delivery_pick_to_dock(v_route, v_dock, v_lane);
  PERFORM public.delivery_pick_to_dock(v_route, v_dock, v_lane);
  SELECT COUNT(*) INTO v_count FROM stock_package_movements WHERE stock_package_id=v_pkg AND to_location_id=v_lane_loc;
  IF v_count = 1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',2,'ok',true,'mv',v_count);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',2,'ok',false,'mv',v_count); END IF;

  -- T3 load_vehicle
  r := public.delivery_load_vehicle(v_route);
  IF (r->>'ok')='true' AND (SELECT current_location_id FROM stock_packages WHERE id=v_pkg)=v_veh_loc
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',3,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',3,'ok',false,'r',r); END IF;

  -- T4 manifest with dims snapshot
  SELECT id INTO v_man FROM vehicle_route_manifest WHERE route_id=v_route AND stock_package_id=v_pkg;
  IF v_man IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_route_manifest WHERE id=v_man AND length_cm>0 AND volume_m3>0)
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',4,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',4,'ok',false); END IF;

  -- T5 load idempotent
  PERFORM public.delivery_load_vehicle(v_route);
  SELECT COUNT(*) INTO v_count FROM vehicle_route_manifest WHERE route_id=v_route AND stock_package_id=v_pkg;
  IF v_count=1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',5,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',5,'ok',false,'c',v_count); END IF;

  -- T6 start
  r := public.delivery_route_start(v_route);
  IF (r->>'ok')='true' THEN pass:=pass+1; res:=res||jsonb_build_object('t',6,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',6,'ok',false,'r',r); END IF;

  -- T7 deliver
  r := public.delivery_order_deliver(v_dro,
    jsonb_build_array(jsonb_build_object('sale_order_line_id',v_sol,'stock_package_id',v_pkg,'qty_delivered',1)));
  IF (r->>'ok')='true' AND (SELECT status FROM stock_packages WHERE id=v_pkg)='delivered'
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',7,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',7,'ok',false,'r',r); END IF;

  -- T8 qty_delivered
  IF (SELECT qty_delivered FROM sale_order_lines WHERE id=v_sol) = 1
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',8,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',8,'ok',false); END IF;

  -- T9 route_close passes
  r := public.delivery_route_close(v_route);
  IF (r->>'ok')='true' THEN pass:=pass+1; res:=res||jsonb_build_object('t',9,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',9,'ok',false,'r',r); END IF;

  -- second flow: damaged return
  INSERT INTO stock_packages(product_id, package_template_id, package_ref, qty, current_location_id,
                              condition, status, is_virtual)
  SELECT v_product, id, tag||'_PKG2', 1, v_loc, 'good', 'available', false
    FROM product_package_templates WHERE product_id=v_product LIMIT 1
  RETURNING id INTO v_pkg2;
  INSERT INTO sale_orders(name,partner_id,state,operational_status,amount_total)
  VALUES (tag||'_so2',v_partner,'confirmed'::sale_state,'reserved',100) RETURNING id INTO v_so2;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price,subtotal,line_kind)
  VALUES (v_so2,v_product,1,v_uom,100,100,'product') RETURNING id INTO v_sol2;
  UPDATE stock_packages SET sale_order_id=v_so2, sale_order_line_id=v_sol2 WHERE id=v_pkg2;
  r := public.delivery_schedule_create(v_so2,'home_delivery',CURRENT_DATE+2,NULL,NULL,NULL);
  v_sched2 := (r->>'schedule_id')::uuid;
  r := public.delivery_schedule_assign(v_sched2, CURRENT_DATE+2, v_zone, NULL, NULL);
  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+2, v_zone, v_vehicle, NULL, NULL, tag||'_r2');
  v_route2 := (r->>'route_id')::uuid;
  r := public.delivery_route_assign_order(v_route2, v_sched2, false, NULL);
  SELECT id INTO v_dro2 FROM delivery_route_orders WHERE route_id=v_route2 AND schedule_id=v_sched2;
  PERFORM public.delivery_pick_to_dock(v_route2, v_dock, v_lane);
  PERFORM public.delivery_load_vehicle(v_route2);
  PERFORM public.delivery_route_start(v_route2);
  PERFORM public.delivery_order_fail(v_dro2, 'cliente ausente');

  -- T10 close blocked
  r := public.delivery_route_close(v_route2);
  IF (r->>'ok')='false' AND (r->>'error')='vehicle_not_empty'
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',10,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',10,'ok',false,'r',r); END IF;

  -- T11 return damaged
  r := public.delivery_return_to_warehouse(v_dro2,
    jsonb_build_array(jsonb_build_object('stock_package_id',v_pkg2,'qty',1,'return_condition','damaged','reason','dano transporte')),
    'release_reserved');
  v_dmg_loc := public._m4_return_loc('damaged');
  IF (r->>'ok')='true'
     AND (SELECT current_location_id FROM stock_packages WHERE id=v_pkg2)=v_dmg_loc
     AND (SELECT condition FROM stock_packages WHERE id=v_pkg2)='damaged'
     AND EXISTS (SELECT 1 FROM package_damage_report WHERE stock_package_id=v_pkg2)
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',11,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',11,'ok',false,'r',r); END IF;

  -- T12 route_complete
  r := public.delivery_route_complete(v_route2);
  IF (r->>'ok')='true' AND (r->>'state') IN ('awaiting_cash_closure','return_pending')
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',12,'ok',true,'state',r->>'state');
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',12,'ok',false,'r',r); END IF;

  -- T13 damaged not available
  IF NOT EXISTS (SELECT 1 FROM stock_packages WHERE id=v_pkg2 AND status='available' AND condition='good')
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',13,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',13,'ok',false); END IF;

  -- T14 invariants (no global flag, no triggers)
  IF NOT COALESCE((SELECT (value::text)::boolean FROM app_settings WHERE key='package_tracking_enabled'),false)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
                     WHERE c.relname='stock_quants' AND tg.tgname ILIKE '%package%' AND NOT tg.tgisinternal)
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',14,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',14,'ok',false); END IF;

  -- T15: no stock_moves.package_id leak (legacy column not set to stock_packages.id by M4 flow)
  IF NOT EXISTS (SELECT 1 FROM stock_moves sm WHERE sm.package_id IN (v_pkg, v_pkg2))
  THEN pass:=pass+1; res:=res||jsonb_build_object('t',15,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',15,'ok',false); END IF;

  -- T16: every stock_package_movement created by M4 flow has stock_move_id set
  SELECT COUNT(*) INTO v_count FROM stock_package_movements
   WHERE stock_package_id IN (v_pkg, v_pkg2) AND stock_move_id IS NULL;
  IF v_count = 0 THEN pass:=pass+1; res:=res||jsonb_build_object('t',16,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',16,'ok',false,'orphans',v_count); END IF;

  -- T17: no package left on any vehicle stock_location without a manifest row
  IF NOT EXISTS (
    SELECT 1 FROM stock_packages sp
     JOIN vehicles v ON v.stock_location_id = sp.current_location_id
     WHERE NOT EXISTS (SELECT 1 FROM vehicle_route_manifest m WHERE m.stock_package_id=sp.id)
  ) THEN pass:=pass+1; res:=res||jsonb_build_object('t',17,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',17,'ok',false); END IF;

  -- cleanup (use stock_package_movements.stock_move_id, not legacy package_id)
  DELETE FROM stock_moves WHERE id IN (
    SELECT stock_move_id FROM stock_package_movements
     WHERE stock_package_id IN (v_pkg, v_pkg2) AND stock_move_id IS NOT NULL
  );
  DELETE FROM package_damage_report WHERE stock_package_id IN (v_pkg, v_pkg2);
  DELETE FROM stock_package_movements WHERE stock_package_id IN (v_pkg, v_pkg2);
  DELETE FROM vehicle_route_manifest WHERE route_id IN (v_route, v_route2);
  DELETE FROM dock_transfers WHERE route_id IN (v_route, v_route2);
  DELETE FROM delivery_route_orders WHERE route_id IN (v_route, v_route2);
  DELETE FROM delivery_schedules WHERE id IN (v_sched, v_sched2);
  DELETE FROM delivery_routes WHERE id IN (v_route, v_route2);
  DELETE FROM stock_packages WHERE id IN (v_pkg, v_pkg2);
  DELETE FROM sale_order_timeline WHERE sale_order_id IN (v_so, v_so2);
  DELETE FROM sale_order_lines WHERE order_id IN (v_so, v_so2);
  DELETE FROM sale_orders WHERE id IN (v_so, v_so2);
  DELETE FROM vehicles WHERE id=v_vehicle;
  DELETE FROM loading_dock_lanes WHERE id=v_lane;
  DELETE FROM loading_docks WHERE id=v_dock;
  DELETE FROM delivery_zones WHERE id=v_zone;
  DELETE FROM stock_locations WHERE id IN (v_dock_loc, v_lane_loc, v_veh_loc);

  RETURN jsonb_build_object('passed',pass,'failed',fail,'total',pass+fail,'results',res);
END $$;