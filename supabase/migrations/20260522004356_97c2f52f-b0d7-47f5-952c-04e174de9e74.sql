
-- =============================================
-- 1. Helper: write activity_events for SO + picking
-- =============================================
CREATE OR REPLACE FUNCTION public.log_schedule_event(
  _so uuid,
  _picking uuid,
  _type text,
  _msg text,
  _meta jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _so IS NOT NULL THEN
    INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
    VALUES ('sale_order', _so, _type, auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
            _msg, COALESCE(_meta,'{}'::jsonb), 'internal');
  END IF;
  IF _picking IS NOT NULL THEN
    INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
    VALUES ('stock_picking', _picking, _type, auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
            _msg, COALESCE(_meta,'{}'::jsonb), 'internal');
  END IF;
END $$;

-- =============================================
-- 2. Trigger on delivery_schedules to emit timeline events + mirror to picking
-- =============================================
CREATE OR REPLACE FUNCTION public.tg_delivery_schedules_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_picking uuid;
  v_so_name text;
  v_zone_name text;
  v_route_date date;
  v_msg text;
  v_meta jsonb;
  v_event text;
BEGIN
  -- Resolve linked picking (outgoing, not done/cancelled) for the SO
  SELECT so.name INTO v_so_name FROM sale_orders so WHERE so.id = COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_name IS NOT NULL THEN
    SELECT id INTO v_picking FROM stock_pickings
     WHERE origin = v_so_name AND kind = 'outgoing'
       AND state NOT IN ('done','cancelled')
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Mirror route_id / scheduled_at into the picking
    IF v_picking IS NOT NULL AND NEW.route_id IS NOT NULL THEN
      UPDATE stock_pickings
         SET route_id = NEW.route_id,
             scheduled_at = (NEW.scheduled_date::timestamp + COALESCE(NEW.slot_start, time '09:00'))
       WHERE id = v_picking
         AND (route_id IS DISTINCT FROM NEW.route_id OR scheduled_at IS DISTINCT FROM (NEW.scheduled_date::timestamp + COALESCE(NEW.slot_start, time '09:00')));
    END IF;

    SELECT dz.name, dr.route_date INTO v_zone_name, v_route_date
      FROM delivery_routes dr LEFT JOIN delivery_zones dz ON dz.id = dr.zone_id
     WHERE dr.id = NEW.route_id;

    v_event := CASE WHEN NEW.status = 'requested' THEN 'delivery_schedule_requested' ELSE 'delivery_schedule_scheduled' END;
    v_msg := format('Entrega %s para %s%s',
              CASE WHEN NEW.status='requested' THEN 'proposta' ELSE 'agendada' END,
              to_char(NEW.scheduled_date,'DD/MM/YYYY'),
              CASE WHEN v_zone_name IS NOT NULL THEN ' · '||v_zone_name ELSE '' END);
    v_meta := jsonb_build_object(
      'schedule_id', NEW.id, 'new_date', NEW.scheduled_date,
      'route_id', NEW.route_id, 'route_date', v_route_date, 'zone_name', v_zone_name,
      'slot_start', NEW.slot_start, 'slot_end', NEW.slot_end, 'status', NEW.status
    );
    PERFORM public.log_schedule_event(NEW.sale_order_id, v_picking, v_event, v_msg, v_meta);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Mirror to picking when route or date changes
    IF v_picking IS NOT NULL AND
       (NEW.route_id IS DISTINCT FROM OLD.route_id OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date) THEN
      UPDATE stock_pickings
         SET route_id = NEW.route_id,
             scheduled_at = (NEW.scheduled_date::timestamp + COALESCE(NEW.slot_start, time '09:00'))
       WHERE id = v_picking;
    END IF;

    -- Status change → confirmed / cancelled
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'confirmed' THEN
        SELECT dz.name, dr.route_date INTO v_zone_name, v_route_date
          FROM delivery_routes dr LEFT JOIN delivery_zones dz ON dz.id = dr.zone_id
         WHERE dr.id = NEW.route_id;
        PERFORM public.log_schedule_event(NEW.sale_order_id, v_picking,
          'delivery_schedule_confirmed',
          format('Logística confirmou entrega em %s%s',
            to_char(NEW.scheduled_date,'DD/MM/YYYY'),
            CASE WHEN v_zone_name IS NOT NULL THEN ' · '||v_zone_name ELSE '' END),
          jsonb_build_object('schedule_id', NEW.id, 'route_id', NEW.route_id,
                             'zone_name', v_zone_name, 'date', NEW.scheduled_date));
      ELSIF NEW.status = 'cancelled' THEN
        PERFORM public.log_schedule_event(NEW.sale_order_id, v_picking,
          'delivery_schedule_cancelled',
          format('Agendamento cancelado%s',
            CASE WHEN NEW.cancel_reason IS NOT NULL THEN '. Motivo: '||NEW.cancel_reason ELSE '' END),
          jsonb_build_object('schedule_id', NEW.id, 'reason', NEW.cancel_reason,
                             'date', NEW.scheduled_date, 'route_id', NEW.route_id));
      ELSIF NEW.status = 'rescheduled' THEN
        -- The "new" schedule is logged via its own INSERT trigger; here we log the closure of the old.
        PERFORM public.log_schedule_event(NEW.sale_order_id, v_picking,
          'delivery_schedule_replaced',
          format('Agendamento de %s substituído%s',
            to_char(OLD.scheduled_date,'DD/MM/YYYY'),
            CASE WHEN NEW.cancel_reason IS NOT NULL AND NEW.cancel_reason <> 'rescheduled' THEN '. Motivo: '||NEW.cancel_reason ELSE '' END),
          jsonb_build_object('schedule_id', NEW.id, 'old_date', OLD.scheduled_date,
                             'old_route_id', OLD.route_id, 'reason', NEW.cancel_reason));
      END IF;
      RETURN NEW;
    END IF;

    -- Date / route changed without status change → simple reschedule audit
    IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.route_id IS DISTINCT FROM OLD.route_id THEN
      SELECT dz.name INTO v_zone_name
        FROM delivery_routes dr LEFT JOIN delivery_zones dz ON dz.id = dr.zone_id
       WHERE dr.id = NEW.route_id;
      PERFORM public.log_schedule_event(NEW.sale_order_id, v_picking,
        'delivery_schedule_rescheduled',
        format('Reagendado de %s para %s%s',
          to_char(OLD.scheduled_date,'DD/MM/YYYY'),
          to_char(NEW.scheduled_date,'DD/MM/YYYY'),
          CASE WHEN v_zone_name IS NOT NULL THEN ' · '||v_zone_name ELSE '' END),
        jsonb_build_object('schedule_id', NEW.id,
                           'old_date', OLD.scheduled_date, 'new_date', NEW.scheduled_date,
                           'old_route_id', OLD.route_id, 'new_route_id', NEW.route_id,
                           'zone_name', v_zone_name));
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS tg_delivery_schedules_audit ON public.delivery_schedules;
CREATE TRIGGER tg_delivery_schedules_audit
AFTER INSERT OR UPDATE ON public.delivery_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_delivery_schedules_audit();

-- =============================================
-- 3. schedule_picking_to_route: also create/update delivery_schedules
-- =============================================
CREATE OR REPLACE FUNCTION public.schedule_picking_to_route(_picking uuid, _route uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  pk record;
  v_so_id uuid;
  v_existing uuid;
  v_zone uuid;
BEGIN
  SELECT * INTO r FROM public.delivery_routes WHERE id = _route;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rota não encontrada'; END IF;

  SELECT * INTO pk FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;

  UPDATE public.stock_pickings
     SET route_id = _route,
         scheduled_at = (r.route_date::timestamp + time '09:00')
   WHERE id = _picking;

  -- Mirror to delivery_schedules for the linked SO (if any)
  IF pk.origin IS NOT NULL THEN
    SELECT id INTO v_so_id FROM public.sale_orders WHERE name = pk.origin LIMIT 1;
    v_zone := r.zone_id;
    IF v_so_id IS NOT NULL THEN
      SELECT id INTO v_existing FROM public.delivery_schedules
       WHERE sale_order_id = v_so_id
         AND status NOT IN ('cancelled','delivered','rescheduled')
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        UPDATE public.delivery_schedules
           SET route_id = _route,
               scheduled_date = r.route_date,
               zone_id = COALESCE(v_zone, zone_id),
               status = CASE WHEN status = 'requested' THEN 'confirmed' ELSE status END,
               updated_at = now()
         WHERE id = v_existing;
      ELSE
        INSERT INTO public.delivery_schedules(
          sale_order_id, partner_id, scheduled_date, route_id, zone_id,
          status, physical_state, fulfillment_type, created_by
        )
        SELECT v_so_id, so.partner_id, r.route_date, _route, v_zone,
               'confirmed', 'in_stock', 'delivery', auth.uid()
          FROM public.sale_orders so WHERE so.id = v_so_id;
      END IF;
    END IF;
  END IF;

  -- Keep legacy log_record_event for backward compatibility
  PERFORM public.log_record_event('stock_picking', _picking,
    'Atribuído à rota ' || r.route_date::text, jsonb_build_object('route_id',_route));
END $$;

-- =============================================
-- 4. Confirm / propose-other-date helpers used by inventory UI
-- =============================================
CREATE OR REPLACE FUNCTION public.delivery_schedule_confirm(_schedule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  IF NOT (
       has_group(auth.uid(),'inventory_user')
    OR has_group(auth.uid(),'inventory_manager')
    OR has_group(auth.uid(),'system_admin')
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  SELECT * INTO v_row FROM public.delivery_schedules WHERE id = _schedule_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF v_row.status NOT IN ('requested','scheduled','waiting_confirmation') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_status','status',v_row.status);
  END IF;

  UPDATE public.delivery_schedules
     SET status = 'confirmed', updated_at = now()
   WHERE id = _schedule_id;

  RETURN jsonb_build_object('ok',true,'schedule_id',_schedule_id);
END $$;
