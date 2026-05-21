-- F27-C — Secure scheduling RPC from the delivery calendar
CREATE OR REPLACE FUNCTION public.sale_order_schedule_delivery(
  _sale_order_id uuid,
  _scheduled_date date,
  _slot_start time DEFAULT NULL,
  _slot_end time DEFAULT NULL,
  _route_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so record;
  v_existing uuid;
  v_schedule_id uuid;
  v_route record;
  v_warnings jsonb := '[]'::jsonb;
  v_capacity text := 'unknown';
  v_zone uuid;
  v_ratio numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- Permission gate: sales or logistics roles
  IF NOT (
       has_group(auth.uid(), 'sales_manager')
    OR has_group(auth.uid(), 'sales_user')
    OR has_group(auth.uid(), 'inventory_manager')
    OR has_group(auth.uid(), 'inventory_user')
    OR has_group(auth.uid(), 'system_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id, state, delivery_mode, include_delivery, partner_id, name
    INTO v_so
    FROM sale_orders WHERE id = _sale_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;

  IF v_so.state IN ('cancelled') THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;
  IF v_so.state IN ('done') THEN RAISE EXCEPTION 'sale_order_done'; END IF;
  IF v_so.delivery_mode = 'pickup' THEN RAISE EXCEPTION 'pickup_cannot_schedule_delivery'; END IF;
  IF COALESCE(v_so.include_delivery, false) = false THEN RAISE EXCEPTION 'delivery_not_included'; END IF;
  IF _scheduled_date IS NULL THEN RAISE EXCEPTION 'scheduled_date_required'; END IF;
  IF _slot_start IS NOT NULL AND _slot_end IS NOT NULL AND _slot_end <= _slot_start THEN
    RAISE EXCEPTION 'invalid_slot_window';
  END IF;

  IF _route_id IS NOT NULL THEN
    SELECT id, route_date, state, zone_id, cap_deliveries, current_deliveries,
           cap_volume_m3, current_volume_m3
      INTO v_route
      FROM delivery_routes WHERE id = _route_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'route_not_found'; END IF;
    IF v_route.route_date IS DISTINCT FROM _scheduled_date THEN
      RAISE EXCEPTION 'route_date_mismatch' USING HINT = v_route.route_date::text;
    END IF;
    IF v_route.state = ANY (ARRAY['completed','cancelled','closed']) THEN
      RAISE EXCEPTION 'route_not_open' USING HINT = v_route.state;
    END IF;
    v_zone := v_route.zone_id;

    IF v_route.cap_deliveries IS NOT NULL AND v_route.cap_deliveries > 0 THEN
      v_ratio := COALESCE(v_route.current_deliveries, 0)::numeric / v_route.cap_deliveries;
      IF v_ratio >= 1 THEN
        v_capacity := 'saturated';
        v_warnings := v_warnings || to_jsonb('route_capacity_exceeded'::text);
      ELSIF v_ratio >= 0.85 THEN
        v_capacity := 'tight';
        v_warnings := v_warnings || to_jsonb('route_capacity_tight'::text);
      ELSE
        v_capacity := 'available';
      END IF;
    END IF;
  END IF;

  SELECT id INTO v_existing FROM delivery_schedules
   WHERE sale_order_id = _sale_order_id
     AND status <> ALL (ARRAY['cancelled','delivered','rescheduled'])
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE delivery_schedules
       SET scheduled_date = _scheduled_date,
           slot_start     = _slot_start,
           slot_end       = _slot_end,
           route_id       = _route_id,
           zone_id        = COALESCE(v_zone, zone_id),
           status         = CASE WHEN status = 'requested' THEN 'scheduled' ELSE status END,
           notes          = COALESCE(_notes, notes),
           updated_at     = now()
     WHERE id = v_existing;
    v_schedule_id := v_existing;
    PERFORM public._m3_log(
      _sale_order_id, 'delivery.schedule.rescheduled', v_schedule_id::text,
      jsonb_build_object('date', _scheduled_date, 'route_id', _route_id,
                         'slot_start', _slot_start, 'slot_end', _slot_end,
                         'capacity_status', v_capacity)
    );
  ELSE
    INSERT INTO delivery_schedules(
      sale_order_id, partner_id, scheduled_date, slot_start, slot_end,
      route_id, zone_id, status, physical_state, fulfillment_type, notes, created_by
    ) VALUES (
      _sale_order_id, v_so.partner_id, _scheduled_date, _slot_start, _slot_end,
      _route_id, v_zone, 'scheduled', 'in_stock', 'delivery', _notes, auth.uid()
    ) RETURNING id INTO v_schedule_id;
    PERFORM public._m3_log(
      _sale_order_id, 'delivery.schedule.created', v_schedule_id::text,
      jsonb_build_object('date', _scheduled_date, 'route_id', _route_id,
                         'slot_start', _slot_start, 'slot_end', _slot_end,
                         'capacity_status', v_capacity)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'schedule_id', v_schedule_id,
    'warnings', v_warnings,
    'capacity_status', v_capacity
  );
END $$;

GRANT EXECUTE ON FUNCTION public.sale_order_schedule_delivery(uuid,date,time,time,uuid,text) TO authenticated;

-- Extend protection trigger to allow sales roles to schedule/reschedule
CREATE OR REPLACE FUNCTION public.tg_delivery_schedules_protect_logistics()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE is_authorized boolean;
BEGIN
  is_authorized := auth.uid() IS NULL
               OR has_group(auth.uid(),'inventory_manager')
               OR has_group(auth.uid(),'system_admin')
               OR has_group(auth.uid(),'inventory_user')
               OR has_group(auth.uid(),'sales_manager')
               OR has_group(auth.uid(),'sales_user');
  IF is_authorized THEN RETURN NEW; END IF;
  IF NEW.route_id IS DISTINCT FROM OLD.route_id
     OR NEW.dock_id IS DISTINCT FROM OLD.dock_id
     OR NEW.lane_id IS DISTINCT FROM OLD.lane_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.carrier_id IS DISTINCT FROM OLD.carrier_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.physical_state IS DISTINCT FROM OLD.physical_state THEN
    RAISE EXCEPTION 'Only logistics or sales roles may change route/status/physical_state on delivery_schedules';
  END IF;
  RETURN NEW;
END
$function$;