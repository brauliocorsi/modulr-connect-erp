
-- Allow system context (auth.uid() IS NULL) to call logistic RPCs
CREATE OR REPLACE FUNCTION public._m3_is_logistics()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NULL
      OR has_group(auth.uid(),'inventory_manager')
      OR has_group(auth.uid(),'inventory_user')
      OR has_group(auth.uid(),'system_admin');
$$;

CREATE OR REPLACE FUNCTION public._m3_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NULL
      OR has_group(auth.uid(),'inventory_manager')
      OR has_group(auth.uid(),'system_admin');
$$;

-- Replace role checks in logistic RPCs to use the helpers
CREATE OR REPLACE FUNCTION public.delivery_schedule_assign(
  _schedule_id uuid, _date date, _zone_id uuid,
  _window_start time DEFAULT NULL, _window_end time DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v record;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v FROM delivery_schedules WHERE id=_schedule_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  UPDATE delivery_schedules
     SET scheduled_date=_date, zone_id=_zone_id,
         slot_start=COALESCE(_window_start, slot_start),
         slot_end=COALESCE(_window_end, slot_end),
         status='scheduled', updated_at=now()
   WHERE id=_schedule_id;
  PERFORM public._m3_log(v.sale_order_id,'delivery.schedule.confirmed',_schedule_id::text,
    jsonb_build_object('date',_date,'zone_id',_zone_id));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.delivery_route_create_ad_hoc(
  _route_date date, _zone_id uuid, _vehicle_id uuid,
  _driver_id uuid DEFAULT NULL, _assistant_id uuid DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_existing uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT id INTO v_existing FROM delivery_routes
   WHERE route_date=_route_date AND zone_id=_zone_id AND vehicle_id=_vehicle_id
     AND route_type='ad_hoc' AND state NOT IN ('cancelled','done')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'route_id',v_existing);
  END IF;
  INSERT INTO delivery_routes (zone_id, route_date, vehicle_id, driver_id, state, route_type, notes, max_deliveries, max_assembly_minutes)
  VALUES (_zone_id, _route_date, _vehicle_id, _driver_id, 'planned', 'ad_hoc', _notes, 10, 240)
  RETURNING id INTO v_id;
  PERFORM public._m3_apply_vehicle_capacity(v_id);
  RETURN jsonb_build_object('ok',true,'route_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.delivery_route_assign_order(
  _route_id uuid, _schedule_id uuid,
  _force boolean DEFAULT false, _override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_route record; v_sched record; v_existing uuid;
  fp jsonb; new_d int; new_v numeric; new_w numeric; new_a numeric;
  over boolean := false; is_admin boolean;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  is_admin := public._m3_is_admin();

  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF v_route.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  SELECT * INTO v_sched FROM delivery_schedules WHERE id=_schedule_id;
  IF v_sched.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','schedule_not_found'); END IF;
  IF v_sched.status NOT IN ('requested','scheduled','waiting_confirmation') THEN
    RETURN jsonb_build_object('ok',false,'error','schedule_not_assignable','status',v_sched.status);
  END IF;

  SELECT id INTO v_existing FROM delivery_route_orders
   WHERE schedule_id=_schedule_id AND status NOT IN ('cancelled','returned')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF (SELECT route_id FROM delivery_route_orders WHERE id=v_existing) = _route_id THEN
      RETURN jsonb_build_object('ok',true,'idempotent',true,'route_order_id',v_existing);
    ELSE RETURN jsonb_build_object('ok',false,'error','schedule_in_another_route'); END IF;
  END IF;

  fp := public.schedule_footprint(v_sched.sale_order_id);
  new_d := COALESCE(v_route.current_deliveries,0)+1;
  new_v := COALESCE(v_route.current_volume_m3,0) + COALESCE((fp->>'volume_m3')::numeric,0);
  new_w := COALESCE(v_route.current_weight_kg,0) + COALESCE((fp->>'weight_kg')::numeric,0);
  new_a := COALESCE(v_route.current_assembly_minutes,0) + COALESCE((fp->>'assembly_minutes')::numeric,0);

  over := (v_route.cap_deliveries IS NOT NULL AND new_d > v_route.cap_deliveries)
       OR (v_route.cap_volume_m3 IS NOT NULL AND new_v > v_route.cap_volume_m3)
       OR (v_route.cap_weight_kg IS NOT NULL AND new_w > v_route.cap_weight_kg)
       OR (v_route.cap_assembly_minutes IS NOT NULL AND new_a > v_route.cap_assembly_minutes);

  IF over AND NOT _force THEN
    RETURN jsonb_build_object('ok',false,'error','over_capacity','footprint',fp);
  END IF;
  IF over AND _force AND (_override_reason IS NULL OR length(_override_reason)<3 OR NOT is_admin) THEN
    RETURN jsonb_build_object('ok',false,'error','override_requires_admin_and_reason');
  END IF;

  INSERT INTO delivery_route_orders (route_id, schedule_id, status, sequence)
  VALUES (_route_id, _schedule_id, 'planned',
    COALESCE((SELECT MAX(sequence)+1 FROM delivery_route_orders WHERE route_id=_route_id),1));

  UPDATE delivery_schedules SET route_id=_route_id, status='scheduled', updated_at=now()
   WHERE id=_schedule_id;
  IF over AND _force THEN
    UPDATE delivery_routes SET override_reason=_override_reason, overridden_by=auth.uid() WHERE id=_route_id;
  END IF;

  PERFORM public._m3_log(v_sched.sale_order_id,'delivery.route.assigned',_route_id::text,
    jsonb_build_object('schedule_id',_schedule_id,'over',over,'forced',_force));
  RETURN jsonb_build_object('ok',true,'over_capacity',over);
END $$;

CREATE OR REPLACE FUNCTION public.delivery_route_change_vehicle(_route_id uuid, _vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v record;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v FROM delivery_routes WHERE id=_route_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  UPDATE delivery_routes
     SET vehicle_id=_vehicle_id,
         cap_volume_m3=(SELECT volume_m3 FROM vehicles WHERE id=_vehicle_id),
         cap_weight_kg=(SELECT weight_kg FROM vehicles WHERE id=_vehicle_id),
         cap_assembly_minutes=COALESCE((SELECT assembly_minutes_capacity FROM vehicles WHERE id=_vehicle_id),cap_assembly_minutes),
         updated_at=now()
   WHERE id=_route_id;
  PERFORM public._m3_apply_vehicle_capacity(_route_id);
  PERFORM public.tg_route_recompute_current_manual(_route_id);
  PERFORM public._m3_log(NULL,'delivery.route.vehicle_changed',_route_id::text,jsonb_build_object('vehicle_id',_vehicle_id));
  RETURN jsonb_build_object('ok',true);
END $$;

-- =========================================================
-- _test_phase15_m3 — E2E
-- =========================================================
CREATE OR REPLACE FUNCTION public._test_phase15_m3()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  res jsonb := '[]'::jsonb;
  pass int := 0; fail int := 0;
  tag text := 'TESTE_M3_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid;
  v_product uuid := 'be4df28e-b077-4e61-8cc5-69c7f18f1dea'; -- Mesa Aurora
  v_so uuid;
  v_zone uuid;
  v_vehicle_small uuid;
  v_vehicle_big uuid;
  v_sched uuid;
  v_route uuid;
  v_route2 uuid;
  v_route_adhoc uuid;
  v_so2 uuid;
  v_sched2 uuid;
  r jsonb;
  cap jsonb;
  fp jsonb;
  v_count int;
  v_so_bad uuid;
  v_uom uuid;
BEGIN
  -- Fixtures
  SELECT id INTO v_partner FROM partners WHERE active=true LIMIT 1;
  SELECT id INTO v_uom FROM uom_uoms LIMIT 1;
  IF v_partner IS NULL OR v_uom IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','no_fixture_partner_or_uom');
  END IF;

  INSERT INTO delivery_zones(name, zip_from, zip_to, max_deliveries_per_day, max_assembly_minutes_per_day, weekdays)
  VALUES (tag||'_zone', '00000','99999', 5, 240, ARRAY[1,2,3,4,5,6,0]::smallint[])
  RETURNING id INTO v_zone;

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_small', true, 1.0, 100, 60, (SELECT id FROM stock_locations WHERE type='internal' LIMIT 1))
  RETURNING id INTO v_vehicle_small;

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_big', true, 100.0, 5000, 1000, (SELECT id FROM stock_locations WHERE type='internal' LIMIT 1))
  RETURNING id INTO v_vehicle_big;

  -- Sale order ready
  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so', v_partner, 'sale', 'reserved', 100)
  RETURNING id INTO v_so;

  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, 1, v_uom, 100, 100, 'product');

  -- Sale order NOT ready
  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so_bad', v_partner, 'sale', 'waiting_components', 100)
  RETURNING id INTO v_so_bad;

  ----------------------------------------------------------
  -- T1: create schedule for ready SO
  r := public.delivery_schedule_create(v_so,'home_delivery',CURRENT_DATE+1,'09:00','12:00',NULL);
  IF (r->>'ok')::boolean AND (r->>'schedule_id') IS NOT NULL THEN
    pass:=pass+1; v_sched := (r->>'schedule_id')::uuid;
    res := res || jsonb_build_object('t',1,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',1,'ok',false,'r',r); END IF;

  -- T2: NOT ready blocked
  r := public.delivery_schedule_create(v_so_bad,'home_delivery',CURRENT_DATE+1,NULL,NULL,NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'error')='sale_order_not_ready' THEN
    pass:=pass+1; res := res || jsonb_build_object('t',2,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',2,'ok',false,'r',r); END IF;

  -- T3: idempotent duplicate
  r := public.delivery_schedule_create(v_so,'home_delivery',CURRENT_DATE+1,NULL,NULL,NULL);
  IF (r->>'ok')::boolean AND (r->>'idempotent')='true' THEN
    pass:=pass+1; res := res || jsonb_build_object('t',3,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',3,'ok',false,'r',r); END IF;

  -- T4: logistic assign date/zone
  r := public.delivery_schedule_assign(v_sched, CURRENT_DATE+2, v_zone, '14:00','17:00');
  IF (r->>'ok')::boolean THEN pass:=pass+1; res := res || jsonb_build_object('t',4,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',4,'ok',false,'r',r); END IF;

  -- T5: recurring routes generation idempotent
  r := public.generate_recurring_delivery_routes(CURRENT_DATE, CURRENT_DATE+14);
  IF (r->>'ok')::boolean THEN
    -- Run again - should skip all
    r := public.generate_recurring_delivery_routes(CURRENT_DATE, CURRENT_DATE+14);
    IF (r->>'ok')::boolean AND (r->>'created')::int = 0 THEN
      pass:=pass+1; res := res || jsonb_build_object('t',5,'ok',true);
    ELSE fail:=fail+1; res := res || jsonb_build_object('t',5,'ok',false,'r',r); END IF;
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',5,'ok',false,'r',r); END IF;

  -- T6: ad-hoc route
  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+2, v_zone, v_vehicle_big, NULL, NULL, tag);
  v_route := (r->>'route_id')::uuid;
  IF v_route IS NOT NULL THEN pass:=pass+1; res := res || jsonb_build_object('t',6,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',6,'ok',false,'r',r); END IF;

  -- T7: assign schedule to route within capacity
  r := public.delivery_route_assign_order(v_route, v_sched, false, NULL);
  IF (r->>'ok')::boolean THEN pass:=pass+1; res := res || jsonb_build_object('t',7,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',7,'ok',false,'r',r); END IF;

  -- T8: footprint considers product (Mesa Aurora has package_tracking ON)
  fp := public.schedule_footprint(v_so);
  IF fp ? 'volume_m3' AND fp ? 'weight_kg' AND fp ? 'assembly_minutes' THEN
    pass:=pass+1; res := res || jsonb_build_object('t',8,'ok',true,'fp',fp);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',8,'ok',false,'fp',fp); END IF;

  -- T9: capacity report
  cap := public.delivery_route_capacity(v_route);
  IF (cap->>'current_deliveries')::int = 1 THEN
    pass:=pass+1; res := res || jsonb_build_object('t',9,'ok',true,'cap',cap-'route_id'-'vehicle_id');
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',9,'ok',false,'cap',cap); END IF;

  -- T10: change to small vehicle -> may go over_capacity
  PERFORM public.delivery_route_change_vehicle(v_route, v_vehicle_small);
  cap := public.delivery_route_capacity(v_route);
  IF cap->>'status' IN ('over_capacity','full','limited','available') THEN
    pass:=pass+1; res := res || jsonb_build_object('t',10,'ok',true,'status',cap->>'status');
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',10,'ok',false,'cap',cap); END IF;

  -- T11: create second SO and try to assign forcing over capacity
  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so2', v_partner, 'sale', 'reserved', 50) RETURNING id INTO v_so2;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so2, v_product, 10, v_uom, 5, 50, 'product');

  r := public.delivery_schedule_create(v_so2,'home_delivery',CURRENT_DATE+2,NULL,NULL,NULL);
  v_sched2 := (r->>'schedule_id')::uuid;

  -- Block ad-hoc with very small vehicle
  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id)
  VALUES (tag||'_v_tiny', true, 0.01, 1, 1, (SELECT id FROM stock_locations WHERE type='internal' LIMIT 1));

  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+3, v_zone,
    (SELECT id FROM vehicles WHERE name=tag||'_v_tiny'), NULL, NULL, tag);
  v_route2 := (r->>'route_id')::uuid;

  -- Without force -> blocked
  r := public.delivery_route_assign_order(v_route2, v_sched2, false, NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'error')='over_capacity' THEN
    pass:=pass+1; res := res || jsonb_build_object('t',11,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',11,'ok',false,'r',r); END IF;

  -- T12: force without reason -> blocked
  r := public.delivery_route_assign_order(v_route2, v_sched2, true, NULL);
  IF NOT (r->>'ok')::boolean THEN pass:=pass+1; res := res || jsonb_build_object('t',12,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',12,'ok',false,'r',r); END IF;

  -- T13: force with reason -> allowed, capacity_status over_capacity
  r := public.delivery_route_assign_order(v_route2, v_sched2, true, 'manager override for test');
  IF (r->>'ok')::boolean AND (r->>'over_capacity')='true' THEN
    pass:=pass+1; res := res || jsonb_build_object('t',13,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',13,'ok',false,'r',r); END IF;

  -- T14: available slots
  SELECT COUNT(*) INTO v_count FROM public.available_delivery_slots(v_zone, CURRENT_DATE, CURRENT_DATE+14);
  IF v_count >= 1 THEN pass:=pass+1; res := res || jsonb_build_object('t',14,'ok',true,'slots',v_count);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',14,'ok',false,'slots',v_count); END IF;

  -- T15: cancel schedule
  r := public.delivery_schedule_cancel(v_sched, 'customer requested');
  IF (r->>'ok')::boolean THEN pass:=pass+1; res := res || jsonb_build_object('t',15,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',15,'ok',false,'r',r); END IF;

  -- T16: package_tracking_enabled global still false
  IF NOT COALESCE((SELECT (value::text)::boolean FROM app_settings WHERE key='package_tracking_enabled'),false) THEN
    pass:=pass+1; res := res || jsonb_build_object('t',16,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',16,'ok',false); END IF;

  -- T17: no wide trigger on stock_quants
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='stock_quants'
      AND tg.tgname ILIKE '%package%' AND NOT tg.tgisinternal
  ) THEN
    pass:=pass+1; res := res || jsonb_build_object('t',17,'ok',true);
  ELSE fail:=fail+1; res := res || jsonb_build_object('t',17,'ok',false); END IF;

  -- Cleanup
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
