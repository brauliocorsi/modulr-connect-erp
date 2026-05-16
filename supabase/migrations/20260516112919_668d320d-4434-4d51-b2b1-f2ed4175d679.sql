
-- 1. product_package_templates: dimensions + flags
ALTER TABLE public.product_package_templates
  ADD COLUMN IF NOT EXISTS default_length_cm numeric,
  ADD COLUMN IF NOT EXISTS default_width_cm numeric,
  ADD COLUMN IF NOT EXISTS default_height_cm numeric,
  ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fragile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_flat_transport boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_pkg_template_autovolume()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.default_length_cm IS NOT NULL
     AND NEW.default_width_cm IS NOT NULL
     AND NEW.default_height_cm IS NOT NULL THEN
    NEW.default_volume_m3 := ROUND(
      (NEW.default_length_cm * NEW.default_width_cm * NEW.default_height_cm)::numeric / 1000000.0
    , 6);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pkg_template_autovolume ON public.product_package_templates;
CREATE TRIGGER trg_pkg_template_autovolume
  BEFORE INSERT OR UPDATE ON public.product_package_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_pkg_template_autovolume();

-- 2. stock_packages snapshot
ALTER TABLE public.stock_packages
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fragile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_flat_transport boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tg_stock_packages_dim_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE t record;
BEGIN
  IF NEW.package_template_id IS NOT NULL THEN
    SELECT default_length_cm, default_width_cm, default_height_cm,
           default_weight_kg, default_volume_m3,
           stackable, fragile, requires_flat_transport
      INTO t
      FROM public.product_package_templates WHERE id = NEW.package_template_id;
    IF FOUND THEN
      NEW.length_cm := COALESCE(NEW.length_cm, t.default_length_cm);
      NEW.width_cm  := COALESCE(NEW.width_cm,  t.default_width_cm);
      NEW.height_cm := COALESCE(NEW.height_cm, t.default_height_cm);
      NEW.weight_kg := COALESCE(NEW.weight_kg, t.default_weight_kg);
      NEW.volume_m3 := COALESCE(NEW.volume_m3, t.default_volume_m3);
      NEW.stackable := COALESCE(NEW.stackable, t.stackable, false);
      NEW.fragile := COALESCE(NEW.fragile, t.fragile, false);
      NEW.requires_flat_transport := COALESCE(NEW.requires_flat_transport, t.requires_flat_transport, false);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_packages_dim_snapshot ON public.stock_packages;
CREATE TRIGGER trg_stock_packages_dim_snapshot
  BEFORE INSERT ON public.stock_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_packages_dim_snapshot();

-- 3. vehicles usable dims
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS usable_length_cm numeric,
  ADD COLUMN IF NOT EXISTS usable_width_cm numeric,
  ADD COLUMN IF NOT EXISTS usable_height_cm numeric,
  ADD COLUMN IF NOT EXISTS usable_volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS max_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS max_stops int,
  ADD COLUMN IF NOT EXISTS max_assembly_minutes int,
  ADD COLUMN IF NOT EXISTS supports_flat_transport boolean NOT NULL DEFAULT false;

-- 4. schedule_footprint with dim fields
CREATE OR REPLACE FUNCTION public.schedule_footprint(_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vol numeric := 0; v_w numeric := 0; v_asm numeric := 0;
  v_max_l numeric := 0; v_max_w numeric := 0; v_max_h numeric := 0;
  v_pkg_count int := 0; v_non_stack int := 0; v_fragile int := 0; v_flat int := 0;
  r record; use_tpl boolean;
  t record;
BEGIN
  FOR r IN
    SELECT sol.product_id, sol.quantity, p.package_tracking_enabled,
           COALESCE(p.volume_m3,0) AS p_vol,
           COALESCE(p.weight_kg, p.weight, 0) AS p_w,
           COALESCE(p.assembly_minutes,0) AS p_asm
    FROM sale_order_lines sol
    JOIN products p ON p.id=sol.product_id
    WHERE sol.order_id=_sale_order_id
      AND COALESCE(sol.line_kind,'product')='product'
      AND p.type IN ('storable','consumable')
  LOOP
    use_tpl := COALESCE(r.package_tracking_enabled,false) AND EXISTS (
      SELECT 1 FROM product_package_templates t WHERE t.product_id=r.product_id AND t.active
    );
    IF use_tpl THEN
      FOR t IN
        SELECT default_volume_m3, default_weight_kg, default_assembly_minutes,
               default_length_cm, default_width_cm, default_height_cm,
               stackable, fragile, requires_flat_transport
        FROM product_package_templates
        WHERE product_id=r.product_id AND active
      LOOP
        v_vol := v_vol + COALESCE(t.default_volume_m3,0) * r.quantity;
        v_w := v_w + COALESCE(t.default_weight_kg,0) * r.quantity;
        v_asm := v_asm + COALESCE(t.default_assembly_minutes,0) * r.quantity;
        v_max_l := GREATEST(v_max_l, COALESCE(t.default_length_cm,0));
        v_max_w := GREATEST(v_max_w, COALESCE(t.default_width_cm,0));
        v_max_h := GREATEST(v_max_h, COALESCE(t.default_height_cm,0));
        v_pkg_count := v_pkg_count + r.quantity::int;
        IF NOT COALESCE(t.stackable,false) THEN v_non_stack := v_non_stack + r.quantity::int; END IF;
        IF COALESCE(t.fragile,false) THEN v_fragile := v_fragile + r.quantity::int; END IF;
        IF COALESCE(t.requires_flat_transport,false) THEN v_flat := v_flat + r.quantity::int; END IF;
      END LOOP;
    ELSE
      v_vol := v_vol + r.p_vol * r.quantity;
      v_w := v_w + r.p_w * r.quantity;
      v_asm := v_asm + r.p_asm * r.quantity;
      v_pkg_count := v_pkg_count + r.quantity::int;
      v_non_stack := v_non_stack + r.quantity::int; -- assume não empilhável sem template
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'deliveries', 1,
    'volume_m3', v_vol,
    'weight_kg', v_w,
    'assembly_minutes', v_asm,
    'package_count', v_pkg_count,
    'max_length_cm', v_max_l,
    'max_width_cm', v_max_w,
    'max_height_cm', v_max_h,
    'non_stackable_count', v_non_stack,
    'fragile_count', v_fragile,
    'flat_transport_count', v_flat
  );
END $function$;

-- 5. delivery_route_assign_order with dim validation
CREATE OR REPLACE FUNCTION public.delivery_route_assign_order(_route_id uuid, _schedule_id uuid, _force boolean DEFAULT false, _override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_route record; v_sched record; v_existing uuid; v_veh record;
  fp jsonb; new_d int; new_v numeric; new_w numeric; new_a numeric;
  over boolean := false; over_reason text := NULL;
  is_admin boolean;
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

  -- agregadas
  IF v_route.cap_deliveries IS NOT NULL AND new_d > v_route.cap_deliveries THEN over:=true; over_reason:='over_deliveries'; END IF;
  IF v_route.cap_volume_m3 IS NOT NULL AND new_v > v_route.cap_volume_m3 THEN over:=true; over_reason:=COALESCE(over_reason,'over_volume'); END IF;
  IF v_route.cap_weight_kg IS NOT NULL AND new_w > v_route.cap_weight_kg THEN over:=true; over_reason:=COALESCE(over_reason,'over_weight'); END IF;
  IF v_route.cap_assembly_minutes IS NOT NULL AND new_a > v_route.cap_assembly_minutes THEN over:=true; over_reason:=COALESCE(over_reason,'over_assembly'); END IF;

  -- dimensões físicas da viatura
  IF v_route.vehicle_id IS NOT NULL THEN
    SELECT * INTO v_veh FROM vehicles WHERE id=v_route.vehicle_id;
    IF v_veh.usable_length_cm IS NOT NULL AND COALESCE((fp->>'max_length_cm')::numeric,0) > v_veh.usable_length_cm THEN
      over:=true; over_reason:=COALESCE(over_reason,'over_dim_length');
    END IF;
    IF v_veh.usable_width_cm IS NOT NULL AND COALESCE((fp->>'max_width_cm')::numeric,0) > v_veh.usable_width_cm THEN
      over:=true; over_reason:=COALESCE(over_reason,'over_dim_width');
    END IF;
    IF v_veh.usable_height_cm IS NOT NULL AND COALESCE((fp->>'max_height_cm')::numeric,0) > v_veh.usable_height_cm THEN
      over:=true; over_reason:=COALESCE(over_reason,'over_dim_height');
    END IF;
    IF v_veh.usable_volume_m3 IS NOT NULL AND new_v > v_veh.usable_volume_m3 THEN
      over:=true; over_reason:=COALESCE(over_reason,'over_vehicle_volume');
    END IF;
    IF v_veh.max_weight_kg IS NOT NULL AND new_w > v_veh.max_weight_kg THEN
      over:=true; over_reason:=COALESCE(over_reason,'over_vehicle_weight');
    END IF;
    IF COALESCE((fp->>'flat_transport_count')::int,0) > 0 AND COALESCE(v_veh.supports_flat_transport,false) = false THEN
      over:=true; over_reason:=COALESCE(over_reason,'requires_flat_transport_unsupported');
    END IF;
  END IF;

  IF over AND NOT _force THEN
    RETURN jsonb_build_object('ok',false,'error','over_capacity','reason',over_reason,'footprint',fp);
  END IF;
  IF over AND _force AND (_override_reason IS NULL OR length(_override_reason)<3 OR NOT is_admin) THEN
    RETURN jsonb_build_object('ok',false,'error','override_requires_admin_and_reason','reason',over_reason);
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
    jsonb_build_object('schedule_id',_schedule_id,'over',over,'forced',_force,'reason',over_reason));
  RETURN jsonb_build_object('ok',true,'over_capacity',over,'reason',over_reason);
END $function$;

-- 6. update _test_phase15_m3 with T18..T22
CREATE OR REPLACE FUNCTION public._test_phase15_m3()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_v_short uuid; v_v_low uuid; v_route_short uuid; v_route_low uuid;
  v_so3 uuid; v_sched3 uuid; v_so4 uuid; v_sched4 uuid;
  v_tpl_id uuid; v_pkg_id uuid; v_snap_vol numeric;
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

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id,
                       usable_length_cm, usable_width_cm, usable_height_cm, usable_volume_m3, max_weight_kg)
  VALUES (tag||'_v_small', true, 1.0, 100, 60, v_loc, 250,160,150, 1.0, 100) RETURNING id INTO v_vehicle_small;
  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id,
                       usable_length_cm, usable_width_cm, usable_height_cm, usable_volume_m3, max_weight_kg)
  VALUES (tag||'_v_big', true, 100.0, 5000, 1000, v_loc, 500,200,220, 100.0, 5000) RETURNING id INTO v_vehicle_big;

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
  IF fp ? 'volume_m3' AND fp ? 'max_length_cm' THEN pass:=pass+1; res:=res||jsonb_build_object('t',8,'ok',true,'fp',fp);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',8,'ok',false,'fp',fp); END IF;

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

  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id,
                       usable_length_cm, usable_width_cm, usable_height_cm, usable_volume_m3, max_weight_kg)
  VALUES (tag||'_v_tiny', true, 0.01, 1, 1, v_loc, 300,200,200, 0.01, 1);

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

  -- T18: viatura curta (length insuficiente) bloqueia mesmo com volume ok
  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id,
                       usable_length_cm, usable_width_cm, usable_height_cm, usable_volume_m3, max_weight_kg)
  VALUES (tag||'_v_short', true, 100.0, 5000, 1000, v_loc, 100, 200, 220, 100.0, 5000) RETURNING id INTO v_v_short;
  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so3', v_partner, 'confirmed'::sale_state, 'reserved', 100) RETURNING id INTO v_so3;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so3, v_product, 1, v_uom, 100, 100, 'product');
  r := public.delivery_schedule_create(v_so3,'home_delivery',CURRENT_DATE+4,NULL,NULL,NULL);
  v_sched3 := (r->>'schedule_id')::uuid;
  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+4, v_zone, v_v_short, NULL, NULL, tag||'_short');
  v_route_short := (r->>'route_id')::uuid;
  r := public.delivery_route_assign_order(v_route_short, v_sched3, false, NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'reason')='over_dim_length' THEN pass:=pass+1; res:=res||jsonb_build_object('t',18,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',18,'ok',false,'r',r); END IF;

  -- T19: viatura baixa bloqueia
  INSERT INTO vehicles(name, active, volume_m3, weight_kg, assembly_minutes_capacity, stock_location_id,
                       usable_length_cm, usable_width_cm, usable_height_cm, usable_volume_m3, max_weight_kg)
  VALUES (tag||'_v_low', true, 100.0, 5000, 1000, v_loc, 500, 200, 5, 100.0, 5000) RETURNING id INTO v_v_low;
  INSERT INTO sale_orders(name, partner_id, state, operational_status, amount_total)
  VALUES (tag||'_so4', v_partner, 'confirmed'::sale_state, 'reserved', 100) RETURNING id INTO v_so4;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price, subtotal, line_kind)
  VALUES (v_so4, v_product, 1, v_uom, 100, 100, 'product');
  r := public.delivery_schedule_create(v_so4,'home_delivery',CURRENT_DATE+5,NULL,NULL,NULL);
  v_sched4 := (r->>'schedule_id')::uuid;
  r := public.delivery_route_create_ad_hoc(CURRENT_DATE+5, v_zone, v_v_low, NULL, NULL, tag||'_low');
  v_route_low := (r->>'route_id')::uuid;
  r := public.delivery_route_assign_order(v_route_low, v_sched4, false, NULL);
  IF NOT (r->>'ok')::boolean AND (r->>'reason')='over_dim_height' THEN pass:=pass+1; res:=res||jsonb_build_object('t',19,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',19,'ok',false,'r',r); END IF;

  -- T20: footprint inclui non_stackable_count > 0 (Mesa Aurora tem colis não empilháveis)
  fp := public.schedule_footprint(v_so3);
  IF COALESCE((fp->>'non_stackable_count')::int,0) > 0 THEN pass:=pass+1; res:=res||jsonb_build_object('t',20,'ok',true,'ns',fp->>'non_stackable_count');
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',20,'ok',false,'fp',fp); END IF;

  -- T21: snapshot preservado em stock_packages mesmo após mudar template
  SELECT id INTO v_pkg_id FROM stock_packages
    WHERE package_template_id='90fda689-2b44-44c4-90ce-952554ae10c6' AND length_cm IS NOT NULL LIMIT 1;
  IF v_pkg_id IS NOT NULL THEN
    SELECT volume_m3 INTO v_snap_vol FROM stock_packages WHERE id=v_pkg_id;
    UPDATE product_package_templates SET default_length_cm=default_length_cm+10 WHERE id='90fda689-2b44-44c4-90ce-952554ae10c6';
    IF (SELECT volume_m3 FROM stock_packages WHERE id=v_pkg_id) = v_snap_vol THEN
      pass:=pass+1; res:=res||jsonb_build_object('t',21,'ok',true);
    ELSE fail:=fail+1; res:=res||jsonb_build_object('t',21,'ok',false); END IF;
    UPDATE product_package_templates SET default_length_cm=default_length_cm-10 WHERE id='90fda689-2b44-44c4-90ce-952554ae10c6';
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',21,'ok',false,'why','no_pkg'); END IF;

  -- T22: cálculo automático de volume a partir de L*W*H
  UPDATE product_package_templates
     SET default_length_cm=100, default_width_cm=100, default_height_cm=100
   WHERE id='ca13eab6-e0b5-4c36-9b66-81084837d9ec';
  IF (SELECT default_volume_m3 FROM product_package_templates WHERE id='ca13eab6-e0b5-4c36-9b66-81084837d9ec') = 1.0 THEN
    pass:=pass+1; res:=res||jsonb_build_object('t',22,'ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t',22,'ok',false); END IF;
  -- restaura
  UPDATE product_package_templates
     SET default_length_cm=60, default_width_cm=55, default_height_cm=85
   WHERE id='ca13eab6-e0b5-4c36-9b66-81084837d9ec';

  -- cleanup
  DELETE FROM delivery_route_orders WHERE schedule_id IN (v_sched, v_sched2, v_sched3, v_sched4);
  DELETE FROM delivery_schedules WHERE id IN (v_sched, v_sched2, v_sched3, v_sched4);
  DELETE FROM delivery_routes WHERE id IN (v_route, v_route2, v_route_short, v_route_low);
  DELETE FROM delivery_routes WHERE zone_id=v_zone;
  DELETE FROM sale_order_timeline WHERE sale_order_id IN (v_so, v_so2, v_so3, v_so4, v_so_bad);
  DELETE FROM sale_order_lines WHERE order_id IN (v_so, v_so2, v_so3, v_so4);
  DELETE FROM sale_orders WHERE id IN (v_so, v_so2, v_so3, v_so4, v_so_bad);
  DELETE FROM vehicles WHERE name LIKE tag||'%';
  DELETE FROM delivery_zones WHERE id=v_zone;

  RETURN jsonb_build_object('passed',pass,'failed',fail,'total',pass+fail,'results',res);
END $function$;
