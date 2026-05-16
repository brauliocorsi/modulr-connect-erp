
-- =====================================================================
-- M5: schema patch + helpers + RPCs
-- =====================================================================

-- Allow `with_carrier` as a physical_state value (additive — keeps prior values)
ALTER TABLE public.delivery_schedules
  DROP CONSTRAINT IF EXISTS delivery_schedules_physical_chk;
ALTER TABLE public.delivery_schedules
  ADD CONSTRAINT delivery_schedules_physical_chk
  CHECK (physical_state = ANY (ARRAY[
    'in_stock','reserved','picked','at_dock','in_truck',
    'at_customer','delivered','at_pickup_area','returned','with_carrier'
  ]));

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public._m5_pickup_loc()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM stock_locations
   WHERE type='internal' AND name='PICKUP_AREA' LIMIT 1;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._m5_customer_loc()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM stock_locations WHERE type='customer' LIMIT 1;
  IF v IS NULL THEN
    INSERT INTO stock_locations(name,type,active) VALUES ('CUSTOMERS','customer',true) RETURNING id INTO v;
  END IF;
  RETURN v;
END $$;

-- Find or create a stock location for a carrier. Bootstrap trigger usually does it,
-- this is a safety net.
CREATE OR REPLACE FUNCTION public._m5_carrier_loc(_carrier_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
  SELECT stock_location_id INTO v FROM delivery_carriers WHERE id=_carrier_id;
  IF v IS NULL THEN
    INSERT INTO stock_locations(name,type,active)
    VALUES ('CARRIER/'||COALESCE((SELECT name FROM delivery_carriers WHERE id=_carrier_id),'X'),'internal',true)
    RETURNING id INTO v;
    UPDATE delivery_carriers SET stock_location_id=v WHERE id=_carrier_id;
  END IF;
  RETURN v;
END $$;

-- Internal: record a cash receipt linked to a route/schedule.
-- Uses the open cash session passed in `_payment.session_id`. Also creates a
-- customer_payments row tagged with the schedule.
CREATE OR REPLACE FUNCTION public._m5_record_payment(_so uuid, _schedule uuid, _route uuid, _payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_method uuid; v_partner uuid; v_cm uuid; v_cp uuid;
  v_amount numeric; v_code text; v_session uuid; v_state text;
BEGIN
  IF _payment IS NULL THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  v_amount := (_payment->>'amount')::numeric;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_amount'); END IF;
  v_code := UPPER(COALESCE(_payment->>'method_code','CASH'));
  SELECT id INTO v_method FROM payment_methods WHERE code=v_code AND active LIMIT 1;
  IF v_method IS NULL THEN RETURN jsonb_build_object('ok',false,'error','payment_method_missing','code',v_code); END IF;

  SELECT partner_id INTO v_partner FROM sale_orders WHERE id=_so;

  INSERT INTO customer_payments(name, partner_id, order_id, schedule_id, payment_date,
                                amount, method_id, reference, state, created_by, idempotency_key)
  VALUES ('PAY/'||to_char(now(),'YYYYMMDDHH24MISSMS'), v_partner, _so, _schedule, CURRENT_DATE,
          v_amount, v_method, _payment->>'reference', 'posted', auth.uid(),
          COALESCE(_payment->>'idempotency_key', 'pay:'||_schedule::text||':'||v_amount::text))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_cp;

  -- Cash session is only mandatory for CASH; for digital methods we still log a
  -- movement when a session is provided.
  v_session := NULLIF(_payment->>'session_id','')::uuid;
  IF v_session IS NOT NULL THEN
    SELECT state INTO v_state FROM cash_sessions WHERE id=v_session;
    IF v_state IS NULL THEN RETURN jsonb_build_object('ok',false,'error','session_not_found'); END IF;
    IF v_state <> 'open' THEN RETURN jsonb_build_object('ok',false,'error','session_not_open'); END IF;
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id,
                               payment_id, route_id)
    VALUES (v_session, 'deposit', abs(v_amount), 'PAY:'||v_code, _payment->>'reference',
            auth.uid(), auth.uid(), v_cp, _route)
    RETURNING id INTO v_cm;
  ELSIF v_code='CASH' THEN
    RETURN jsonb_build_object('ok',false,'error','cash_requires_session');
  END IF;

  RETURN jsonb_build_object('ok',true,'payment_id',v_cp,'cash_movement_id',v_cm,'method',v_code);
END $$;

-- =====================================================================
-- PICKUP RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_customer_pickup(_sale_order_id uuid, _scheduled_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_so record; v_pickup uuid; v_sched uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_so FROM sale_orders WHERE id=_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','sale_order_not_found'); END IF;
  IF v_so.state NOT IN ('confirmed','done') THEN
    RETURN jsonb_build_object('ok',false,'error','sale_order_not_confirmed','state',v_so.state);
  END IF;

  -- Idempotent: reuse pending schedule if present
  SELECT id INTO v_sched FROM delivery_schedules
   WHERE sale_order_id=_sale_order_id
     AND fulfillment_type='customer_pickup'
     AND status NOT IN ('cancelled','delivered')
   LIMIT 1;
  IF v_sched IS NULL THEN
    INSERT INTO delivery_schedules(sale_order_id, partner_id, scheduled_date, status, physical_state,
                                   fulfillment_type, created_by)
    VALUES (_sale_order_id, v_so.partner_id, _scheduled_date, 'scheduled', 'reserved',
            'customer_pickup', auth.uid())
    RETURNING id INTO v_sched;
  END IF;

  SELECT id INTO v_pickup FROM customer_pickups
   WHERE sale_order_id=_sale_order_id AND status IN ('scheduled','ready')
   LIMIT 1;
  IF v_pickup IS NULL THEN
    INSERT INTO customer_pickups(sale_order_id, scheduled_date, status)
    VALUES (_sale_order_id, _scheduled_date, 'scheduled')
    RETURNING id INTO v_pickup;
  END IF;

  PERFORM public._m3_log(_sale_order_id,'pickup.created', v_pickup::text,
    jsonb_build_object('schedule_id',v_sched,'date',_scheduled_date));
  RETURN jsonb_build_object('ok',true,'pickup_id',v_pickup,'schedule_id',v_sched);
END $$;

CREATE OR REPLACE FUNCTION public.delivery_pick_to_pickup_area(_pickup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pk record; v_sched record; v_dst uuid; v_pkg record; v_moved int := 0;
  v_sol record; v_src uuid; v_qty numeric; v_move uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_pk FROM customer_pickups WHERE id=_pickup_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','pickup_not_found'); END IF;
  IF v_pk.status='picked_up' THEN RETURN jsonb_build_object('ok',true,'noop','already_picked'); END IF;

  v_dst := public._m5_pickup_loc();
  IF v_dst IS NULL THEN RETURN jsonb_build_object('ok',false,'error','pickup_area_missing'); END IF;

  SELECT * INTO v_sched FROM delivery_schedules
   WHERE sale_order_id=v_pk.sale_order_id AND fulfillment_type='customer_pickup'
     AND status NOT IN ('cancelled','delivered') LIMIT 1;

  -- Tracking ON: move stock_packages
  FOR v_pkg IN
    SELECT sp.* FROM stock_packages sp
     WHERE sp.sale_order_id=v_pk.sale_order_id
       AND sp.current_location_id<>v_dst
       AND sp.status NOT IN ('delivered')
  LOOP
    IF v_pkg.condition IN ('damaged','quarantine') THEN
      RETURN jsonb_build_object('ok',false,'error','package_not_good','pkg',v_pkg.id,'cond',v_pkg.condition);
    END IF;
    v_move := public._m4_make_move(v_pkg.product_id, v_pkg.current_location_id, v_dst,
                                   v_pkg.qty, 'pickup:'||_pickup_id, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_dst, NULL, NULL, 'pickup_area', v_move, v_pkg.qty);
    v_moved := v_moved + 1;
  END LOOP;

  -- Tracking OFF: lines without packages — produce a stock move from a default internal loc
  FOR v_sol IN
    SELECT sol.* FROM sale_order_lines sol
      JOIN sale_orders so ON so.id=sol.order_id
     WHERE sol.order_id=v_pk.sale_order_id
       AND NOT public.is_package_tracking_enabled_for_product(sol.product_id)
       AND COALESCE(sol.qty_delivered,0) < sol.quantity
  LOOP
    SELECT id INTO v_src FROM stock_locations WHERE type='internal' AND return_kind IS NULL AND id<>v_dst LIMIT 1;
    v_qty := sol.quantity - COALESCE(sol.qty_delivered,0);
    IF v_qty > 0 AND v_src IS NOT NULL THEN
      PERFORM public._m4_make_move(v_sol.product_id, v_src, v_dst, v_qty, 'pickup:'||_pickup_id, NULL);
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  UPDATE customer_pickups SET status='ready', updated_at=now() WHERE id=_pickup_id;
  IF v_sched.id IS NOT NULL THEN
    UPDATE delivery_schedules SET physical_state='at_pickup_area', status='loaded', updated_at=now()
      WHERE id=v_sched.id;
  END IF;
  PERFORM public._m3_log(v_pk.sale_order_id,'pickup.to_area',_pickup_id::text,jsonb_build_object('moved',v_moved));
  RETURN jsonb_build_object('ok',true,'moved',v_moved);
END $$;

CREATE OR REPLACE FUNCTION public.validate_customer_pickup(_pickup_id uuid, _payment jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pk record; v_sched record; v_src uuid; v_cust uuid;
  v_pkg record; v_sol record; v_count int := 0; v_move uuid; v_pay jsonb;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_pk FROM customer_pickups WHERE id=_pickup_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','pickup_not_found'); END IF;
  IF v_pk.status='picked_up' THEN RETURN jsonb_build_object('ok',true,'noop','already_picked'); END IF;
  IF v_pk.status<>'ready' THEN
    RETURN jsonb_build_object('ok',false,'error','pickup_not_ready','status',v_pk.status);
  END IF;

  v_src := public._m5_pickup_loc();
  v_cust := public._m5_customer_loc();

  -- Tracking ON packages currently at PICKUP_AREA
  FOR v_pkg IN
    SELECT sp.* FROM stock_packages sp
     WHERE sp.sale_order_id=v_pk.sale_order_id
       AND sp.current_location_id=v_src
       AND sp.status NOT IN ('delivered')
  LOOP
    IF v_pkg.condition IN ('damaged','quarantine') THEN
      RETURN jsonb_build_object('ok',false,'error','package_not_good','pkg',v_pkg.id);
    END IF;
    v_move := public._m4_make_move(v_pkg.product_id, v_src, v_cust, v_pkg.qty,
                                   'pickup_validated:'||_pickup_id, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_cust, NULL, NULL, 'delivered', v_move, v_pkg.qty);
    UPDATE stock_packages SET status='delivered'::package_status WHERE id=v_pkg.id;
    UPDATE sale_order_lines SET qty_delivered=COALESCE(qty_delivered,0)+v_pkg.qty
      WHERE id=v_pkg.sale_order_line_id;
    v_count := v_count + 1;
  END LOOP;

  -- Tracking OFF: consume remaining qty
  FOR v_sol IN
    SELECT sol.* FROM sale_order_lines sol
     WHERE sol.order_id=v_pk.sale_order_id
       AND NOT public.is_package_tracking_enabled_for_product(sol.product_id)
       AND COALESCE(sol.qty_delivered,0) < sol.quantity
  LOOP
    PERFORM public._m4_make_move(v_sol.product_id, v_src, v_cust,
                                 v_sol.quantity - COALESCE(v_sol.qty_delivered,0),
                                 'pickup_validated:'||_pickup_id, NULL);
    UPDATE sale_order_lines SET qty_delivered=v_sol.quantity WHERE id=v_sol.id;
    v_count := v_count + 1;
  END LOOP;

  -- Payment handling
  IF _payment IS NOT NULL THEN
    v_pay := public._m5_record_payment(v_pk.sale_order_id, NULL, NULL, _payment);
    IF (v_pay->>'ok')='false' THEN RETURN v_pay; END IF;
  END IF;

  SELECT * INTO v_sched FROM delivery_schedules
   WHERE sale_order_id=v_pk.sale_order_id AND fulfillment_type='customer_pickup'
     AND status NOT IN ('cancelled','delivered') LIMIT 1;
  UPDATE customer_pickups
     SET status='picked_up', picked_up_at=now(), validated_by=auth.uid(), updated_at=now()
   WHERE id=_pickup_id;
  IF v_sched.id IS NOT NULL THEN
    UPDATE delivery_schedules SET status='delivered', physical_state='delivered', updated_at=now()
      WHERE id=v_sched.id;
  END IF;

  PERFORM public._m3_log(v_pk.sale_order_id,'pickup.validated',_pickup_id::text,
    jsonb_build_object('count',v_count,'payment',v_pay));
  RETURN jsonb_build_object('ok',true,'count',v_count,'payment',v_pay);
END $$;

-- =====================================================================
-- CARRIER RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delivery_handover_to_carrier(_schedule_id uuid, _carrier_id uuid, _tracking_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sched record; v_dst uuid; v_pkg record; v_count int := 0; v_move uuid;
        v_sol record; v_src uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_sched FROM delivery_schedules WHERE id=_schedule_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schedule_not_found'); END IF;
  IF v_sched.fulfillment_type<>'carrier_pickup' THEN
    RETURN jsonb_build_object('ok',false,'error','not_carrier_schedule');
  END IF;
  IF v_sched.physical_state='with_carrier' AND v_sched.carrier_id=_carrier_id THEN
    RETURN jsonb_build_object('ok',true,'noop','already_handed');
  END IF;

  v_dst := public._m5_carrier_loc(_carrier_id);

  FOR v_pkg IN
    SELECT sp.* FROM stock_packages sp
     WHERE sp.sale_order_id=v_sched.sale_order_id
       AND sp.current_location_id<>v_dst
       AND sp.status NOT IN ('delivered')
  LOOP
    IF v_pkg.condition IN ('damaged','quarantine') THEN
      RETURN jsonb_build_object('ok',false,'error','package_not_good','pkg',v_pkg.id);
    END IF;
    v_move := public._m4_make_move(v_pkg.product_id, v_pkg.current_location_id, v_dst,
                                   v_pkg.qty, 'carrier_handover:'||_schedule_id, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_dst, NULL, NULL, 'handed_to_carrier', v_move, v_pkg.qty);
    v_count := v_count + 1;
  END LOOP;

  FOR v_sol IN
    SELECT sol.* FROM sale_order_lines sol
     WHERE sol.order_id=v_sched.sale_order_id
       AND NOT public.is_package_tracking_enabled_for_product(sol.product_id)
       AND COALESCE(sol.qty_delivered,0) < sol.quantity
  LOOP
    SELECT id INTO v_src FROM stock_locations WHERE type='internal' AND return_kind IS NULL AND id<>v_dst LIMIT 1;
    IF v_src IS NOT NULL THEN
      PERFORM public._m4_make_move(v_sol.product_id, v_src, v_dst,
                                   v_sol.quantity - COALESCE(v_sol.qty_delivered,0),
                                   'carrier_handover:'||_schedule_id, NULL);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  UPDATE delivery_schedules
     SET carrier_id=_carrier_id, physical_state='with_carrier', status='in_transit',
         notes=COALESCE(notes,'')||CASE WHEN _tracking_code IS NOT NULL
                                       THEN E'\nTRACKING:'||_tracking_code ELSE '' END,
         updated_at=now()
   WHERE id=_schedule_id;

  PERFORM public._m3_log(v_sched.sale_order_id,'carrier.handover',_schedule_id::text,
    jsonb_build_object('carrier',_carrier_id,'tracking',_tracking_code,'count',v_count));
  RETURN jsonb_build_object('ok',true,'count',v_count,'destination',v_dst,'tracking',_tracking_code);
END $$;

CREATE OR REPLACE FUNCTION public.carrier_confirm_delivered(_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sched record; v_src uuid; v_cust uuid; v_pkg record; v_count int := 0; v_move uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_sched FROM delivery_schedules WHERE id=_schedule_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schedule_not_found'); END IF;
  IF v_sched.status='delivered' THEN RETURN jsonb_build_object('ok',true,'noop','already_delivered'); END IF;
  IF v_sched.carrier_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_carrier'); END IF;

  v_src := public._m5_carrier_loc(v_sched.carrier_id);
  v_cust := public._m5_customer_loc();

  FOR v_pkg IN
    SELECT sp.* FROM stock_packages sp
     WHERE sp.sale_order_id=v_sched.sale_order_id
       AND sp.current_location_id=v_src
       AND sp.status NOT IN ('delivered')
  LOOP
    v_move := public._m4_make_move(v_pkg.product_id, v_src, v_cust, v_pkg.qty,
                                   'carrier_delivered:'||_schedule_id, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_cust, NULL, NULL, 'delivered', v_move, v_pkg.qty);
    UPDATE stock_packages SET status='delivered'::package_status WHERE id=v_pkg.id;
    UPDATE sale_order_lines SET qty_delivered=COALESCE(qty_delivered,0)+v_pkg.qty
      WHERE id=v_pkg.sale_order_line_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE delivery_schedules SET status='delivered', physical_state='delivered', updated_at=now()
    WHERE id=_schedule_id;
  PERFORM public._m3_log(v_sched.sale_order_id,'carrier.delivered',_schedule_id::text,
    jsonb_build_object('count',v_count));
  RETURN jsonb_build_object('ok',true,'count',v_count);
END $$;

CREATE OR REPLACE FUNCTION public.carrier_mark_failed_or_returned(_schedule_id uuid, _reason text, _condition text DEFAULT 'good')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sched record; v_src uuid; v_dst uuid; v_pkg record; v_count int := 0; v_move uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF _condition NOT IN ('good','damaged','quarantine') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_condition');
  END IF;
  SELECT * INTO v_sched FROM delivery_schedules WHERE id=_schedule_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schedule_not_found'); END IF;
  IF v_sched.carrier_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_carrier'); END IF;

  v_src := public._m5_carrier_loc(v_sched.carrier_id);
  v_dst := public._m4_return_loc(_condition);
  IF v_dst IS NULL THEN RETURN jsonb_build_object('ok',false,'error','return_location_missing'); END IF;

  FOR v_pkg IN
    SELECT sp.* FROM stock_packages sp
     WHERE sp.sale_order_id=v_sched.sale_order_id
       AND sp.current_location_id=v_src
       AND sp.status NOT IN ('delivered')
  LOOP
    v_move := public._m4_make_move(v_pkg.product_id, v_src, v_dst, v_pkg.qty,
                                   'carrier_return:'||_condition, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_dst, NULL, NULL, 'return_'||_condition, v_move, v_pkg.qty);
    UPDATE stock_packages
       SET condition = CASE WHEN _condition IN ('damaged','quarantine')
                            THEN _condition::package_condition ELSE condition END,
           status = 'available'::package_status
     WHERE id=v_pkg.id;
    IF _condition IN ('damaged','quarantine') THEN
      INSERT INTO package_damage_report(stock_package_id, condition, reason, reported_by)
      VALUES (v_pkg.id, _condition, _reason, auth.uid());
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE delivery_schedules
     SET status = CASE WHEN _condition='good' THEN 'failed' ELSE 'failed' END,
         physical_state = 'returned',
         notes = COALESCE(notes,'')||E'\nCARRIER_RETURN:'||_reason,
         updated_at = now()
   WHERE id=_schedule_id;
  PERFORM public._m3_log(v_sched.sale_order_id,'carrier.returned',_schedule_id::text,
    jsonb_build_object('count',v_count,'condition',_condition,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'count',v_count,'destination',v_dst,'condition',_condition);
END $$;

-- =====================================================================
-- CASH CLOSURE
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delivery_route_cash_summary(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_route record; v_cash numeric := 0; v_mb numeric := 0; v_trf numeric := 0;
  v_mbway numeric := 0; v_other numeric := 0; v_total numeric := 0;
  v_existing record; v_payments jsonb;
BEGIN
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;

  -- expected = sum of customer_payments whose schedule belongs to this route
  SELECT
    COALESCE(SUM(CASE WHEN pm.code='CASH'   THEN cp.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN pm.code='MBWAY'  THEN cp.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN pm.code='MB'     THEN cp.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN pm.code='TRANSF' THEN cp.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN pm.code NOT IN ('CASH','MBWAY','MB','TRANSF') THEN cp.amount ELSE 0 END),0),
    COALESCE(SUM(cp.amount),0)
  INTO v_cash, v_mbway, v_mb, v_trf, v_other, v_total
  FROM customer_payments cp
  JOIN delivery_schedules ds ON ds.id=cp.schedule_id
  JOIN payment_methods pm ON pm.id=cp.method_id
  WHERE ds.route_id=_route_id;

  -- Also include cash_movements directly tagged to the route (deliveries from M4)
  SELECT
    COALESCE(SUM(CASE WHEN cm.kind='deposit' AND COALESCE(cm.reference,'') LIKE 'PAY:CASH%'   THEN cm.amount ELSE 0 END),0) + v_cash,
    COALESCE(SUM(CASE WHEN cm.kind='deposit' AND COALESCE(cm.reference,'') LIKE 'PAY:MBWAY%'  THEN cm.amount ELSE 0 END),0) + v_mbway,
    COALESCE(SUM(CASE WHEN cm.kind='deposit' AND COALESCE(cm.reference,'') LIKE 'PAY:MB%'     AND COALESCE(cm.reference,'') NOT LIKE 'PAY:MBWAY%' THEN cm.amount ELSE 0 END),0) + v_mb,
    COALESCE(SUM(CASE WHEN cm.kind='deposit' AND COALESCE(cm.reference,'') LIKE 'PAY:TRANSF%' THEN cm.amount ELSE 0 END),0) + v_trf,
    COALESCE(SUM(CASE WHEN cm.kind='deposit' AND COALESCE(cm.reference,'') NOT LIKE 'PAY:CASH%' AND COALESCE(cm.reference,'') NOT LIKE 'PAY:MBWAY%' AND COALESCE(cm.reference,'') NOT LIKE 'PAY:MB%' AND COALESCE(cm.reference,'') NOT LIKE 'PAY:TRANSF%' AND cm.payment_id IS NULL THEN cm.amount ELSE 0 END),0) + v_other
  INTO v_cash, v_mbway, v_mb, v_trf, v_other
  FROM cash_movements cm WHERE cm.route_id=_route_id AND cm.payment_id IS NULL;

  v_total := v_cash + v_mbway + v_mb + v_trf + v_other;

  SELECT * INTO v_existing FROM delivery_route_cash_closure WHERE route_id=_route_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('schedule_id',cp.schedule_id,'amount',cp.amount,'method',pm.code)),'[]'::jsonb)
  INTO v_payments
  FROM customer_payments cp
  JOIN delivery_schedules ds ON ds.id=cp.schedule_id
  JOIN payment_methods pm ON pm.id=cp.method_id
  WHERE ds.route_id=_route_id;

  RETURN jsonb_build_object(
    'ok',true,
    'route_id', _route_id,
    'expected_cash', v_cash,
    'expected_mbway', v_mbway,
    'expected_multibanco', v_mb,
    'expected_transfer', v_trf,
    'expected_other', v_other,
    'total_expected', v_total,
    'closure_existing', to_jsonb(v_existing),
    'payments', v_payments
  );
END $$;

CREATE OR REPLACE FUNCTION public.delivery_route_cash_close(_route_id uuid, _actuals jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_route record; v_sum jsonb; v_id uuid; v_var numeric; v_session uuid;
  v_actual_cash numeric; v_actual_mb numeric; v_actual_trf numeric; v_actual_other numeric;
  v_actual_mbway numeric;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.state NOT IN ('in_progress','return_pending','awaiting_cash_closure','completed','done','closed') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_state','state',v_route.state);
  END IF;

  v_sum := public.delivery_route_cash_summary(_route_id);
  v_actual_cash  := COALESCE((_actuals->>'actual_cash')::numeric,0);
  v_actual_mbway := COALESCE((_actuals->>'actual_mbway')::numeric,0);
  v_actual_mb    := COALESCE((_actuals->>'actual_multibanco')::numeric,
                              (_actuals->>'actual_mb')::numeric,0);
  v_actual_trf   := COALESCE((_actuals->>'actual_transfer')::numeric,0);
  v_actual_other := COALESCE((_actuals->>'actual_other')::numeric,0);
  v_session      := NULLIF(_actuals->>'session_id','')::uuid;

  -- Idempotent: if closure exists, return it (don't duplicate)
  SELECT id INTO v_id FROM delivery_route_cash_closure WHERE route_id=_route_id;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'closure_id',v_id,'noop','already_closed');
  END IF;

  INSERT INTO delivery_route_cash_closure(route_id, cash_register_id,
    expected_cash, expected_mbway, expected_transfer, expected_other,
    actual_cash,   actual_mbway,   actual_transfer,   actual_other,
    notes, closed_by, closed_at)
  VALUES (_route_id,
    (SELECT register_id FROM cash_sessions WHERE id=v_session),
    (v_sum->>'expected_cash')::numeric,
    (v_sum->>'expected_mbway')::numeric,
    (v_sum->>'expected_transfer')::numeric,
    ((v_sum->>'expected_multibanco')::numeric + (v_sum->>'expected_other')::numeric),
    v_actual_cash, v_actual_mbway, v_actual_trf, v_actual_mb + v_actual_other,
    _notes, auth.uid(), now())
  RETURNING id, variance INTO v_id, v_var;

  -- Variance adjustment: log a cash_movement if session known
  IF v_session IS NOT NULL AND v_var <> 0 THEN
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id, route_id)
    VALUES (v_session,
            CASE WHEN v_var > 0 THEN 'bonus' ELSE 'expense' END,
            abs(v_var), 'CASH_CLOSURE_VARIANCE',
            'route='||_route_id::text||' variance='||v_var::text,
            auth.uid(), auth.uid(), _route_id);
  END IF;

  PERFORM public._m3_log(NULL,'delivery.cash.closed',_route_id::text,
    jsonb_build_object('closure_id',v_id,'variance',v_var));
  RETURN jsonb_build_object('ok',true,'closure_id',v_id,'variance',v_var);
END $$;

-- =====================================================================
-- Adjust delivery_route_close to require cash closure when payments exist
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delivery_route_close(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_route record; v_stock int; v_open int; v_unv int; v_pay int; v_closure int;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  SELECT COUNT(*) INTO v_stock FROM stock_packages sp
    JOIN vehicles v ON v.stock_location_id=sp.current_location_id
   WHERE v.id=v_route.vehicle_id;
  IF v_stock > 0 THEN RETURN jsonb_build_object('ok',false,'error','vehicle_not_empty','packages',v_stock); END IF;
  SELECT COUNT(*) INTO v_open FROM delivery_route_orders
   WHERE route_id=_route_id AND status NOT IN ('delivered','partial','failed','returned','cancelled');
  IF v_open > 0 THEN RETURN jsonb_build_object('ok',false,'error','orders_open','open',v_open); END IF;
  SELECT COUNT(*) INTO v_unv FROM vehicle_route_manifest
   WHERE route_id=_route_id AND verification_required=true AND verified_at IS NULL;
  IF v_unv > 0 THEN RETURN jsonb_build_object('ok',false,'error','manifests_unverified','count',v_unv); END IF;

  -- M5: require cash closure when route received payments
  SELECT COUNT(*) INTO v_pay FROM (
    SELECT 1 FROM customer_payments cp
      JOIN delivery_schedules ds ON ds.id=cp.schedule_id
     WHERE ds.route_id=_route_id
    UNION ALL
    SELECT 1 FROM cash_movements WHERE route_id=_route_id AND payment_id IS NOT NULL
  ) p;
  SELECT COUNT(*) INTO v_closure FROM delivery_route_cash_closure WHERE route_id=_route_id;
  IF v_pay > 0 AND v_closure = 0 THEN
    RETURN jsonb_build_object('ok',false,'error','cash_closure_required','payments',v_pay);
  END IF;

  UPDATE delivery_routes SET state='closed', updated_at=now() WHERE id=_route_id;
  PERFORM public._m3_log(NULL,'delivery.route.closed',_route_id::text,jsonb_build_object());
  RETURN jsonb_build_object('ok',true,'state','closed');
END $$;

-- =====================================================================
-- RESCHEDULE
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delivery_schedule_reschedule(_schedule_id uuid, _new_date date,
                                                                _new_route_id uuid DEFAULT NULL,
                                                                _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old record; v_new uuid; v_bad int; v_stock int; v_existing uuid;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_old FROM delivery_schedules WHERE id=_schedule_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','schedule_not_found'); END IF;
  IF v_old.status = 'delivered' THEN
    RETURN jsonb_build_object('ok',false,'error','already_delivered');
  END IF;

  -- Stock still on a vehicle?
  IF v_old.route_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_stock
      FROM stock_packages sp
      JOIN vehicles v ON v.stock_location_id=sp.current_location_id
      JOIN delivery_routes r ON r.vehicle_id=v.id
     WHERE r.id=v_old.route_id AND sp.sale_order_id=v_old.sale_order_id;
    IF v_stock > 0 THEN
      RETURN jsonb_build_object('ok',false,'error','vehicle_stock_present','packages',v_stock);
    END IF;
  END IF;

  -- Damaged / quarantine block
  SELECT COUNT(*) INTO v_bad FROM stock_packages
   WHERE sale_order_id=v_old.sale_order_id
     AND condition IN ('damaged','quarantine')
     AND status<>'delivered';
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('ok',false,'error','damaged_packages','count',v_bad);
  END IF;

  -- Idempotent: if a new active schedule for same SO already exists at the requested date, return it
  SELECT id INTO v_existing FROM delivery_schedules
   WHERE sale_order_id=v_old.sale_order_id
     AND id<>_schedule_id
     AND status NOT IN ('cancelled','delivered','rescheduled')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE delivery_schedules
       SET status='rescheduled', cancelled_at=now(), cancelled_by=auth.uid(),
           cancel_reason=COALESCE(_reason,'rescheduled'), updated_at=now()
     WHERE id=_schedule_id AND status<>'rescheduled';
    RETURN jsonb_build_object('ok',true,'new_schedule_id',v_existing,'noop','already_rescheduled');
  END IF;

  -- Mark old as rescheduled first to free the unique active constraint
  UPDATE delivery_schedules
     SET status='rescheduled', cancelled_at=now(), cancelled_by=auth.uid(),
         cancel_reason=COALESCE(_reason,'rescheduled'), updated_at=now()
   WHERE id=_schedule_id;

  INSERT INTO delivery_schedules(sale_order_id, partner_id, scheduled_date, status, physical_state,
                                 fulfillment_type, delivery_address_id, route_id, zone_id, created_by, notes)
  VALUES (v_old.sale_order_id, v_old.partner_id, _new_date, 'scheduled', 'reserved',
          COALESCE(v_old.fulfillment_type,'home_delivery'),
          v_old.delivery_address_id, _new_route_id, v_old.zone_id, auth.uid(),
          'rescheduled_from:'||_schedule_id::text||COALESCE(' reason:'||_reason,''))
  RETURNING id INTO v_new;

  PERFORM public._m3_log(v_old.sale_order_id,'schedule.rescheduled',_schedule_id::text,
    jsonb_build_object('new_schedule_id',v_new,'new_date',_new_date,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'old_schedule_id',_schedule_id,'new_schedule_id',v_new);
END $$;
