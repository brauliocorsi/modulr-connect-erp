
-- =========================================================
-- F15 M3 — RPCs comerciais, agendamento, rotas, capacidade
-- =========================================================

-- 1) Schema additions ------------------------------------------------
ALTER TABLE public.delivery_routes
  ADD COLUMN IF NOT EXISTS route_type text NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.delivery_route_templates(id),
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS overridden_by uuid,
  ADD COLUMN IF NOT EXISTS capacity_status text NOT NULL DEFAULT 'available';

ALTER TABLE public.delivery_route_templates
  ADD COLUMN IF NOT EXISTS max_volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS max_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS route_type text NOT NULL DEFAULT 'recurring';

ALTER TABLE public.delivery_schedules
  ADD COLUMN IF NOT EXISTS fulfillment_type text,
  ADD COLUMN IF NOT EXISTS delivery_address_id uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.delivery_zones(id);

-- One active schedule per sale order
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_schedules_active_per_so
  ON public.delivery_schedules(sale_order_id)
  WHERE status NOT IN ('cancelled','delivered');

-- Idempotency for recurring routes: one route per (template, date)
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_routes_template_date
  ON public.delivery_routes(template_id, route_date)
  WHERE template_id IS NOT NULL;

-- One schedule cannot be on two active routes
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_route_orders_active_schedule
  ON public.delivery_route_orders(schedule_id)
  WHERE status NOT IN ('cancelled','returned');

-- 2) Helper: timeline log -------------------------------------------
CREATE OR REPLACE FUNCTION public._m3_log(_so uuid, _step text, _ref text, _payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _so IS NULL THEN RETURN; END IF;
  INSERT INTO sale_order_timeline (sale_order_id, step, status, ref, payload, source, occurred_at, created_by)
  VALUES (_so, _step, 'ok', _ref, _payload, 'm3', now(), auth.uid());
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 3) Helper: schedule footprint -------------------------------------
-- Returns volume_m3, weight_kg, assembly_minutes for a sale_order
CREATE OR REPLACE FUNCTION public.schedule_footprint(_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vol numeric := 0;
  v_w numeric := 0;
  v_asm numeric := 0;
  r record;
  tpl_vol numeric;
  tpl_w numeric;
  tpl_asm numeric;
  use_tpl boolean;
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
      SELECT
        COALESCE(SUM(COALESCE(default_volume_m3,0)),0),
        COALESCE(SUM(COALESCE(default_weight_kg,0)),0),
        COALESCE(SUM(COALESCE(default_assembly_minutes,0)),0)
      INTO tpl_vol, tpl_w, tpl_asm
      FROM product_package_templates WHERE product_id=r.product_id AND active;
      v_vol := v_vol + tpl_vol * r.quantity;
      v_w := v_w + tpl_w * r.quantity;
      v_asm := v_asm + GREATEST(tpl_asm, r.p_asm) * r.quantity;
    ELSE
      v_vol := v_vol + r.p_vol * r.quantity;
      v_w := v_w + r.p_w * r.quantity;
      v_asm := v_asm + r.p_asm * r.quantity;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'deliveries', 1,
    'volume_m3', v_vol,
    'weight_kg', v_w,
    'assembly_minutes', v_asm
  );
END $$;

-- 4) Trigger: keep route current_* in sync from delivery_route_orders
CREATE OR REPLACE FUNCTION public.tg_route_recompute_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_route uuid;
  v_d int := 0; v_v numeric := 0; v_w numeric := 0; v_a numeric := 0;
  r record;
  fp jsonb;
  cap_d int; cap_v numeric; cap_w numeric; cap_a int;
  v_status text;
BEGIN
  v_route := COALESCE(NEW.route_id, OLD.route_id);
  FOR r IN
    SELECT dro.schedule_id, ds.sale_order_id
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id=dro.schedule_id
    WHERE dro.route_id=v_route AND dro.status NOT IN ('cancelled','returned')
  LOOP
    fp := public.schedule_footprint(r.sale_order_id);
    v_d := v_d + 1;
    v_v := v_v + COALESCE((fp->>'volume_m3')::numeric,0);
    v_w := v_w + COALESCE((fp->>'weight_kg')::numeric,0);
    v_a := v_a + COALESCE((fp->>'assembly_minutes')::numeric,0);
  END LOOP;

  SELECT cap_deliveries, cap_volume_m3, cap_weight_kg, cap_assembly_minutes
  INTO cap_d, cap_v, cap_w, cap_a
  FROM delivery_routes WHERE id=v_route;

  v_status := CASE
    WHEN (cap_d IS NOT NULL AND v_d > cap_d)
      OR (cap_v IS NOT NULL AND v_v > cap_v)
      OR (cap_w IS NOT NULL AND v_w > cap_w)
      OR (cap_a IS NOT NULL AND v_a > cap_a) THEN 'over_capacity'
    WHEN (cap_d IS NOT NULL AND v_d >= cap_d)
      OR (cap_v IS NOT NULL AND cap_v>0 AND v_v/cap_v >= 1)
      OR (cap_w IS NOT NULL AND cap_w>0 AND v_w/cap_w >= 1) THEN 'full'
    WHEN (cap_d IS NOT NULL AND cap_d>0 AND v_d::numeric/cap_d >= 0.8) THEN 'limited'
    ELSE 'available'
  END;

  UPDATE delivery_routes
     SET current_deliveries=v_d,
         current_volume_m3=v_v,
         current_weight_kg=v_w,
         current_assembly_minutes=v_a::int,
         capacity_status=v_status,
         updated_at=now()
   WHERE id=v_route;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_route_orders_recompute ON public.delivery_route_orders;
CREATE TRIGGER trg_route_orders_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_route_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_route_recompute_current();

-- 5) Apply vehicle capacity to a route
CREATE OR REPLACE FUNCTION public._m3_apply_vehicle_capacity(_route_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v record;
  v_cur_d int; v_cur_v numeric; v_cur_w numeric; v_cur_a int;
  v_status text;
BEGIN
  SELECT vh.volume_m3, vh.weight_kg, vh.assembly_minutes_capacity
  INTO v
  FROM delivery_routes r
  LEFT JOIN vehicles vh ON vh.id=r.vehicle_id
  WHERE r.id=_route_id;

  UPDATE delivery_routes
     SET cap_volume_m3 = COALESCE(v.volume_m3, cap_volume_m3),
         cap_weight_kg = COALESCE(v.weight_kg, cap_weight_kg),
         cap_assembly_minutes = COALESCE(v.assembly_minutes_capacity, cap_assembly_minutes),
         cap_deliveries = COALESCE(cap_deliveries, max_deliveries)
   WHERE id=_route_id;

  SELECT current_deliveries, current_volume_m3, current_weight_kg, current_assembly_minutes
  INTO v_cur_d, v_cur_v, v_cur_w, v_cur_a
  FROM delivery_routes WHERE id=_route_id;

  SELECT CASE
    WHEN (cap_deliveries IS NOT NULL AND v_cur_d > cap_deliveries)
      OR (cap_volume_m3 IS NOT NULL AND v_cur_v > cap_volume_m3)
      OR (cap_weight_kg IS NOT NULL AND v_cur_w > cap_weight_kg)
      OR (cap_assembly_minutes IS NOT NULL AND v_cur_a > cap_assembly_minutes) THEN 'over_capacity'
    WHEN (cap_deliveries IS NOT NULL AND v_cur_d >= cap_deliveries)
      OR (cap_volume_m3 IS NOT NULL AND cap_volume_m3>0 AND v_cur_v/cap_volume_m3>=1) THEN 'full'
    WHEN (cap_deliveries IS NOT NULL AND cap_deliveries>0 AND v_cur_d::numeric/cap_deliveries>=0.8) THEN 'limited'
    ELSE 'available'
  END INTO v_status
  FROM delivery_routes WHERE id=_route_id;

  UPDATE delivery_routes SET capacity_status=v_status WHERE id=_route_id;
END $$;

-- 6) COMMERCIAL — create schedule
CREATE OR REPLACE FUNCTION public.delivery_schedule_create(
  _so_id uuid,
  _fulfillment_type text,
  _preferred_date date,
  _window_start time DEFAULT NULL,
  _window_end time DEFAULT NULL,
  _delivery_address_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so record;
  v_existing uuid;
  v_id uuid;
BEGIN
  SELECT id, operational_status, partner_id INTO v_so FROM sale_orders WHERE id=_so_id;
  IF v_so.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','sale_order_not_found'); END IF;

  IF v_so.operational_status NOT IN ('ready_delivery','reserved','completed') THEN
    RETURN jsonb_build_object('ok',false,'error','sale_order_not_ready','operational_status',v_so.operational_status);
  END IF;

  SELECT id INTO v_existing FROM delivery_schedules
   WHERE sale_order_id=_so_id AND status NOT IN ('cancelled','delivered')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'schedule_id',v_existing);
  END IF;

  INSERT INTO delivery_schedules(
    sale_order_id, partner_id, scheduled_date, slot_start, slot_end,
    status, physical_state, fulfillment_type, delivery_address_id, created_by
  ) VALUES (
    _so_id, v_so.partner_id, _preferred_date, _window_start, _window_end,
    'requested', 'in_stock', _fulfillment_type, _delivery_address_id, auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public._m3_log(_so_id, 'delivery.schedule.created', v_id::text,
    jsonb_build_object('fulfillment_type',_fulfillment_type,'preferred_date',_preferred_date));

  RETURN jsonb_build_object('ok',true,'schedule_id',v_id);
END $$;

-- 7) COMMERCIAL — cancel schedule
CREATE OR REPLACE FUNCTION public.delivery_schedule_cancel(_schedule_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM delivery_schedules WHERE id=_schedule_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF v.status IN ('loaded','out_for_delivery','delivered') THEN
    RETURN jsonb_build_object('ok',false,'error','cannot_cancel_after_load','status',v.status);
  END IF;

  -- Detach from any route (no physical stock movement)
  DELETE FROM delivery_route_orders WHERE schedule_id=_schedule_id;

  UPDATE delivery_schedules
     SET status='cancelled', cancel_reason=_reason, cancelled_at=now(),
         cancelled_by=auth.uid(), updated_at=now()
   WHERE id=_schedule_id;

  PERFORM public._m3_log(v.sale_order_id, 'delivery.schedule.cancelled', _schedule_id::text,
    jsonb_build_object('reason',_reason));

  RETURN jsonb_build_object('ok',true);
END $$;

-- 8) LOGISTICS — assign schedule (date/zone/window)
CREATE OR REPLACE FUNCTION public.delivery_schedule_assign(
  _schedule_id uuid, _date date, _zone_id uuid,
  _window_start time DEFAULT NULL, _window_end time DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v record;
BEGIN
  IF NOT (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'inventory_user') OR has_group(auth.uid(),'system_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;
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

-- 9) LOGISTICS — generate recurring routes
CREATE OR REPLACE FUNCTION public.generate_recurring_delivery_routes(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t record;
  d date;
  v_created int := 0;
  v_skipped int := 0;
  v_id uuid;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_range');
  END IF;

  FOR t IN
    SELECT * FROM delivery_route_templates WHERE active AND COALESCE(route_type,'recurring')='recurring'
  LOOP
    d := _from;
    WHILE d <= _to LOOP
      IF EXTRACT(ISODOW FROM d)::int % 7 = t.weekday % 7 THEN
        IF NOT EXISTS (SELECT 1 FROM delivery_routes WHERE template_id=t.id AND route_date=d) THEN
          INSERT INTO delivery_routes (
            zone_id, route_date, vehicle_id, driver_id,
            max_deliveries, max_assembly_minutes, state, route_type, template_id
          ) VALUES (
            t.zone_id, d, t.default_vehicle_id, t.default_driver_id,
            COALESCE(t.max_deliveries,10), COALESCE(t.max_assembly_minutes,240),
            'planned', 'recurring', t.id
          ) RETURNING id INTO v_id;
          PERFORM public._m3_apply_vehicle_capacity(v_id);
          v_created := v_created+1;
        ELSE
          v_skipped := v_skipped+1;
        END IF;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'created',v_created,'skipped',v_skipped);
END $$;

-- 10) LOGISTICS — ad-hoc route
CREATE OR REPLACE FUNCTION public.delivery_route_create_ad_hoc(
  _route_date date, _zone_id uuid, _vehicle_id uuid,
  _driver_id uuid DEFAULT NULL, _assistant_id uuid DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_existing uuid;
BEGIN
  IF NOT (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'inventory_user') OR has_group(auth.uid(),'system_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

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

-- 11) LOGISTICS — assign schedule to route
CREATE OR REPLACE FUNCTION public.delivery_route_assign_order(
  _route_id uuid, _schedule_id uuid,
  _force boolean DEFAULT false, _override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_route record;
  v_sched record;
  v_existing uuid;
  fp jsonb;
  new_d int; new_v numeric; new_w numeric; new_a numeric;
  over boolean := false;
  is_admin boolean;
BEGIN
  IF NOT (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'inventory_user') OR has_group(auth.uid(),'system_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;
  is_admin := has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'system_admin');

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
    ELSE
      RETURN jsonb_build_object('ok',false,'error','schedule_in_another_route');
    END IF;
  END IF;

  fp := public.schedule_footprint(v_sched.sale_order_id);
  new_d := COALESCE(v_route.current_deliveries,0) + 1;
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

-- 12) Route capacity report
CREATE OR REPLACE FUNCTION public.delivery_route_capacity(_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM delivery_routes WHERE id=_route_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  RETURN jsonb_build_object(
    'route_id', r.id,
    'vehicle_id', r.vehicle_id,
    'cap_deliveries', r.cap_deliveries,
    'cap_volume_m3', r.cap_volume_m3,
    'cap_weight_kg', r.cap_weight_kg,
    'cap_assembly_minutes', r.cap_assembly_minutes,
    'current_deliveries', r.current_deliveries,
    'current_volume_m3', r.current_volume_m3,
    'current_weight_kg', r.current_weight_kg,
    'current_assembly_minutes', r.current_assembly_minutes,
    'remaining_deliveries', GREATEST(COALESCE(r.cap_deliveries,0) - r.current_deliveries, 0),
    'remaining_volume_m3', GREATEST(COALESCE(r.cap_volume_m3,0) - r.current_volume_m3, 0),
    'remaining_weight_kg', GREATEST(COALESCE(r.cap_weight_kg,0) - r.current_weight_kg, 0),
    'remaining_assembly_minutes', GREATEST(COALESCE(r.cap_assembly_minutes,0) - r.current_assembly_minutes, 0),
    'utilization_percent', CASE WHEN COALESCE(r.cap_deliveries,0)>0
        THEN ROUND(r.current_deliveries::numeric*100/r.cap_deliveries,1) ELSE NULL END,
    'status', r.capacity_status
  );
END $$;

-- 13) Available slots
CREATE OR REPLACE FUNCTION public.available_delivery_slots(_zone_id uuid, _from date, _to date)
RETURNS TABLE (
  route_id uuid, route_date date, zone_id uuid, vehicle_id uuid,
  remaining_deliveries int, remaining_volume_m3 numeric, remaining_weight_kg numeric,
  remaining_assembly_minutes int, status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.id, r.route_date, r.zone_id, r.vehicle_id,
    GREATEST(COALESCE(r.cap_deliveries,0)-r.current_deliveries,0)::int,
    GREATEST(COALESCE(r.cap_volume_m3,0)-r.current_volume_m3,0),
    GREATEST(COALESCE(r.cap_weight_kg,0)-r.current_weight_kg,0),
    GREATEST(COALESCE(r.cap_assembly_minutes,0)-r.current_assembly_minutes,0)::int,
    r.capacity_status
  FROM delivery_routes r
  WHERE r.zone_id=_zone_id
    AND r.route_date BETWEEN _from AND _to
    AND r.state NOT IN ('cancelled','done')
  ORDER BY r.route_date, r.id;
$$;

-- 14) Change vehicle
CREATE OR REPLACE FUNCTION public.delivery_route_change_vehicle(_route_id uuid, _vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v record;
BEGIN
  IF NOT (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'inventory_user') OR has_group(auth.uid(),'system_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;
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

  -- Recompute current_* (and capacity_status) by triggering a no-op on first child if any, else manual
  PERFORM public.tg_route_recompute_current_manual(_route_id);

  PERFORM public._m3_log(NULL,'delivery.route.vehicle_changed',_route_id::text,
    jsonb_build_object('vehicle_id',_vehicle_id));
  RETURN jsonb_build_object('ok',true);
END $$;

-- Manual variant of route recompute (for use without trigger row)
CREATE OR REPLACE FUNCTION public.tg_route_recompute_current_manual(_route_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d int := 0; v_v numeric := 0; v_w numeric := 0; v_a numeric := 0;
  r record; fp jsonb;
  cap_d int; cap_v numeric; cap_w numeric; cap_a int;
  v_status text;
BEGIN
  FOR r IN
    SELECT dro.schedule_id, ds.sale_order_id
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id=dro.schedule_id
    WHERE dro.route_id=_route_id AND dro.status NOT IN ('cancelled','returned')
  LOOP
    fp := public.schedule_footprint(r.sale_order_id);
    v_d := v_d+1;
    v_v := v_v + COALESCE((fp->>'volume_m3')::numeric,0);
    v_w := v_w + COALESCE((fp->>'weight_kg')::numeric,0);
    v_a := v_a + COALESCE((fp->>'assembly_minutes')::numeric,0);
  END LOOP;
  SELECT cap_deliveries, cap_volume_m3, cap_weight_kg, cap_assembly_minutes
  INTO cap_d, cap_v, cap_w, cap_a FROM delivery_routes WHERE id=_route_id;
  v_status := CASE
    WHEN (cap_d IS NOT NULL AND v_d > cap_d)
      OR (cap_v IS NOT NULL AND v_v > cap_v)
      OR (cap_w IS NOT NULL AND v_w > cap_w)
      OR (cap_a IS NOT NULL AND v_a > cap_a) THEN 'over_capacity'
    WHEN (cap_d IS NOT NULL AND v_d >= cap_d) THEN 'full'
    WHEN (cap_d IS NOT NULL AND cap_d>0 AND v_d::numeric/cap_d>=0.8) THEN 'limited'
    ELSE 'available'
  END;
  UPDATE delivery_routes
     SET current_deliveries=v_d, current_volume_m3=v_v, current_weight_kg=v_w,
         current_assembly_minutes=v_a::int, capacity_status=v_status, updated_at=now()
   WHERE id=_route_id;
END $$;

-- 15) Health checks M3
CREATE OR REPLACE FUNCTION public.erp_m3_health_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f jsonb := '[]'::jsonb;
  r record;
  p0 int:=0; p1 int:=0; p2 int:=0;
BEGIN
  -- P1 schedule_without_ready_so
  FOR r IN
    SELECT ds.id, so.operational_status FROM delivery_schedules ds
    JOIN sale_orders so ON so.id=ds.sale_order_id
    WHERE ds.status NOT IN ('cancelled','delivered')
      AND COALESCE(so.operational_status,'') NOT IN ('ready_delivery','reserved','completed')
  LOOP
    f := f || jsonb_build_object('severity','P1','code','schedule_without_ready_so','entity_id',r.id);
    p1:=p1+1;
  END LOOP;

  -- P0 duplicate_active_schedule (defensive even with unique index)
  FOR r IN
    SELECT sale_order_id, COUNT(*) c FROM delivery_schedules
     WHERE status NOT IN ('cancelled','delivered') GROUP BY sale_order_id HAVING COUNT(*)>1
  LOOP
    f := f || jsonb_build_object('severity','P0','code','duplicate_active_schedule','entity_id',r.sale_order_id);
    p0:=p0+1;
  END LOOP;

  -- P0 schedule in multiple routes
  FOR r IN
    SELECT schedule_id, COUNT(*) c FROM delivery_route_orders
     WHERE status NOT IN ('cancelled','returned') GROUP BY schedule_id HAVING COUNT(*)>1
  LOOP
    f := f || jsonb_build_object('severity','P0','code','schedule_assigned_to_multiple_routes','entity_id',r.schedule_id);
    p0:=p0+1;
  END LOOP;

  -- P1 route_over_capacity sem override
  FOR r IN
    SELECT id FROM delivery_routes WHERE capacity_status='over_capacity' AND override_reason IS NULL
  LOOP
    f := f || jsonb_build_object('severity','P1','code','route_over_capacity','entity_id',r.id);
    p1:=p1+1;
  END LOOP;

  -- P1 route_without_vehicle
  FOR r IN SELECT id FROM delivery_routes WHERE vehicle_id IS NULL AND state NOT IN ('cancelled','done') LOOP
    f := f || jsonb_build_object('severity','P1','code','route_without_vehicle','entity_id',r.id);
    p1:=p1+1;
  END LOOP;

  -- P0 route_vehicle_without_location
  FOR r IN
    SELECT dr.id FROM delivery_routes dr JOIN vehicles v ON v.id=dr.vehicle_id
     WHERE v.stock_location_id IS NULL AND dr.state NOT IN ('cancelled','done')
  LOOP
    f := f || jsonb_build_object('severity','P0','code','route_vehicle_without_location','entity_id',r.id);
    p0:=p0+1;
  END LOOP;

  -- P1 route_template_without_vehicle
  FOR r IN SELECT id FROM delivery_route_templates WHERE active AND default_vehicle_id IS NULL LOOP
    f := f || jsonb_build_object('severity','P1','code','route_template_without_vehicle','entity_id',r.id);
    p1:=p1+1;
  END LOOP;

  -- P0 slot_capacity_negative
  FOR r IN
    SELECT id FROM delivery_routes
     WHERE (cap_deliveries IS NOT NULL AND cap_deliveries < 0)
        OR (cap_volume_m3 IS NOT NULL AND cap_volume_m3 < 0)
        OR (cap_weight_kg IS NOT NULL AND cap_weight_kg < 0)
        OR current_deliveries < 0
  LOOP
    f := f || jsonb_build_object('severity','P0','code','slot_capacity_negative','entity_id',r.id);
    p0:=p0+1;
  END LOOP;

  -- P2 schedule sem janela
  FOR r IN
    SELECT id FROM delivery_schedules
     WHERE (slot_start IS NULL OR slot_end IS NULL) AND status NOT IN ('cancelled','delivered')
  LOOP
    f := f || jsonb_build_object('severity','P2','code','schedule_without_window','entity_id',r.id);
    p2:=p2+1;
  END LOOP;

  -- P2 schedule sem zone
  FOR r IN
    SELECT id FROM delivery_schedules
     WHERE zone_id IS NULL AND status NOT IN ('cancelled','delivered','requested')
  LOOP
    f := f || jsonb_build_object('severity','P2','code','schedule_without_zone','entity_id',r.id);
    p2:=p2+1;
  END LOOP;

  RETURN jsonb_build_object('p0_count',p0,'p1_count',p1,'p2_count',p2,'findings',f);
END $$;
