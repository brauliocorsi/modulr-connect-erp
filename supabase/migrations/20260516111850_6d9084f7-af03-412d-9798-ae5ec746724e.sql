
CREATE OR REPLACE FUNCTION public._test_phase15_m3()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  res jsonb := '[]'::jsonb;
  pass int := 0; fail int := 0;
  tag text := 'TESTE_M3_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid;
  v_product uuid := 'be4df28e-b077-4e61-8cc5-69c7f18f1dea';
  v_so uuid; v_zone uuid; v_vehicle_small uuid; v_vehicle_big uuid;
  v_sched uuid; v_route uuid; v_route2 uuid; v_so2 uuid; v_sched2 uuid;
  r jsonb; cap jsonb; fp jsonb;
  v_count int; v_so_bad uuid; v_uom uuid; v_loc uuid;
BEGIN
  SELECT id INTO v_partner FROM partners WHERE active=true LIMIT 1;
  SELECT id INTO v_uom FROM product_uom LIMIT 1;
  SELECT id INTO v_loc FROM stock_locations WHERE type='internal' LIMIT 1;
  IF v_partner IS NULL OR v_uom IS NULL OR v_loc IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','no_fixtures');
  END IF;

  INSERT INTO delivery_zones(name, zip_from, zip_to, max_deliveries_per_day, max_assembly_minutes_per_day, weekdays)
  VALUES (tag||'_zone','00000','99999',5,240, ARRAY[0,1,2,3,4,5,6]::smallint[])
  RETURNING id INTO v_zone;

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_small', true, 1.0, 100, 60, v_loc) RETURNING id INTO v_vehicle_small;
  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_big', true, 100.0, 5000, 1000, v_loc) RETURNING id INTO v_vehicle_big;

  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so', v_partner, 'confirmed'::sale_state, 'reserved', 100) RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, 1, v_uom, 100, 100, 'product');

  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so_bad', v_partner, 'confirmed'::sale_state, 'waiting_components', 100) RETURNING id INTO v_so_bad;

  r := public.delivery_schedule_create(v_so,'home_delivery',CURRENT_DATE+1,'09:00','12:00',NULL);
  IF (r->>'ok')::boolean AND r ? 'schedule_id' THEN pass:=pass+1; v_sched:=(r->>'schedule_id')::uuid; res:=res||jsonb_build_object('t',1,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',1,'ok',false,'r',r); END IF;

  r := public.delivery_schedule_create(v_so_bad,'home_delivery',CURRENT_DATE+1,NULL,NULL,NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'error')='sale_order_not_ready' THEN pass:=pass+1; res:=res||jsonb_build_object('t',2,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',2,'ok',false,'r',r); END IF;

  r := public.delivery_schedule_create(v_so,'home_delivery',CURRENT_DATE+1,NULL,NULL,NULL);
  IF (r->>'ok')::boolean AND (r->>'idempotent')='true' THEN pass:=pass+1; res:=res||jsonb_build_object('t',3,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',3,'ok',false,'r',r); END IF;

  r := public.delivery_schedule_assign(v_sched, CURRENT_DATE+2, v_zone, '14:00','17:00');
  IF (r->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',4,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',4,'ok',false,'r',r); END IF;

  r := public.generate_recurring_delivery_routes(CURRENT_DATE, CURRENT_DATE+14);
  IF (r->>'ok')::boolean THEN
    r := public.generate_recurring_delivery_routes(CURRENT_DATE, CURRENT_DATE+14);
    IF (r->>'ok')::boolean AND (r->>'created')::int=0 THEN pass:=pass+1; res:=res||jsonb_build_object('t',5,'ok',true);
    ELSE fail:=fail+1; res:=res||jsonb_build_object('t',5,'ok',false,'r',r); END IF;
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',5,'ok',false,'r',r); END IF;

  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+2, v_zone, v_vehicle_big, NULL, NULL, tag);
  v_route := (r->>'route_id')::uuid;
  IF v_route IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t',6,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',6,'ok',false,'r',r); END IF;

  r := public.delivery_route_assign_order(v_route, v_sched, false, NULL);
  IF (r->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',7,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',7,'ok',false,'r',r); END IF;

  fp := public.schedule_footprint(v_so);
  IF fp ? 'volume_m3' THEN pass:=pass+1; res:=res||jsonb_build_object('t',8,'ok',true,'fp',fp);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',8,'ok',false); END IF;

  cap := public.delivery_route_capacity(v_route);
  IF (cap->>'current_deliveries')::int = 1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',9,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',9,'ok',false,'cap',cap); END IF;

  PERFORM public.delivery_route_change_vehicle(v_route, v_vehicle_small);
  cap := public.delivery_route_capacity(v_route);
  IF (cap->>'status') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t',10,'ok',true,'status',cap->>'status');
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',10,'ok',false); END IF;

  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so2', v_partner, 'confirmed'::sale_state, 'reserved', 50) RETURNING id INTO v_so2;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so2, v_product, 10, v_uom, 5, 50, 'product');

  r := public.delivery_schedule_create(v_so2,'home_delivery',CURRENT_DATE+2,NULL,NULL,NULL);
  v_sched2 := (r->>'schedule_id')::uuid;

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_tiny', true, 0.01, 1, 1, v_loc);

  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+3, v_zone,
    (SELECT id FROM vehicles WHERE name=tag||'_v_tiny'), NULL, NULL, tag);
  v_route2 := (r->>'route_id')::uuid;

  r := public.delivery_route_assign_order(v_route2, v_sched2, false, NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'error')='over_capacity' THEN pass:=pass+1; res:=res||jsonb_build_object('t',11,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',11,'ok',false,'r',r); END IF;

  r := public.delivery_route_assign_order(v_route2, v_sched2, true, NULL);
  IF NOT (r->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',12,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',12,'ok',false,'r',r); END IF;

  r := public.delivery_route_assign_order(v_route2, v_sched2, true, 'manager override for test');
  IF (r->>'ok')::boolean AND (r->>'over_capacity')='true' THEN pass:=pass+1; res:=res||jsonb_build_object('t',13,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',13,'ok',false,'r',r); END IF;

  SELECT COUNT(*) INTO v_count FROM public.available_delivery_slots(v_zone, CURRENT_DATE, CURRENT_DATE+14);
  IF v_count >= 1 THEN pass:=pass+1; res:=res||jsonb_build_object('t',14,'ok',true,'slots',v_count);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',14,'ok',false); END IF;

  r := public.delivery_schedule_cancel(v_sched, 'customer requested');
  IF (r->>'ok')::boolean THEN pass:=pass+1; res:=res||jsonb_build_object('t',15,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',15,'ok',false,'r',r); END IF;

  IF NOT COALESCE((SELECT (value::text)::boolean FROM app_settings WHERE key='package_tracking_enabled'),false) THEN
    pass:=pass+1; res:=res||jsonb_build_object('t',16,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',16,'ok',false); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='stock_quants' AND tg.tgname ILIKE '%package%' AND NOT tg.tgisinternal
  ) THEN pass:=pass+1; res:=res||jsonb_build_object('t',17,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',17,'ok',false); END IF;

  DELETE FROM delivery_route_orders WHERE schedule_id IN (v_sched, v_sched2);
  DELETE FROM delivery_schedules WHERE id IN (v_sched, v_sched2);
  DELETE FROM delivery_routes WHERE id IN (v_route, v_route2);
  DELETE FROM delivery_routes WHERE zone_id=v_zone;
  DELETE FROM sale_order_timeline WHERE sale_order_id IN (v_so, v_so2, v_so_bad);
  DELETE FROM sale_order_lines WHERE order_id IN (v_so, v_so2);
  DELETE FROM sale_orders WHERE id IN (v_so, v_so2, v_so_bad);
  DELETE FROM vehicles WHERE name LIKE tag||'%';
  DELETE FROM delivery_zones WHERE id=v_zone;

  RETURN jsonb_build_object('passed',pass,'failed',fail,'total',pass+fail,'results',res);
END $$;
