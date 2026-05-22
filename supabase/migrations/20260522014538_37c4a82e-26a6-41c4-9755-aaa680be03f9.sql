-- Realtime coverage for route dashboard dependencies
ALTER TABLE public.stock_pickings REPLICA IDENTITY FULL;
ALTER TABLE public.stock_moves REPLICA IDENTITY FULL;
ALTER TABLE public.sale_orders REPLICA IDENTITY FULL;
ALTER TABLE public.sale_order_lines REPLICA IDENTITY FULL;
ALTER TABLE public.service_requests REPLICA IDENTITY FULL;
ALTER TABLE public.cash_sessions REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stock_pickings','stock_moves','sale_orders','sale_order_lines','service_requests','cash_sessions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Route cash summary should be based on posted customer payments for route orders,
-- not only on cash_movements with a specific kind/reference.
CREATE OR REPLACE FUNCTION public.delivery_route_cash_summary(_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_route record;
  v_cash numeric := 0;
  v_mb numeric := 0;
  v_trf numeric := 0;
  v_mbway numeric := 0;
  v_other numeric := 0;
  v_total numeric := 0;
  v_existing record;
  v_payments jsonb;
BEGIN
  SELECT * INTO v_route FROM delivery_routes WHERE id = _route_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'route_not_found');
  END IF;

  WITH route_payments AS (
    SELECT
      cp.id,
      cp.amount,
      lower(coalesce(pm.code, '')) AS method_code,
      lower(coalesce(pm.name, '')) AS method_name
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id = dro.schedule_id
    JOIN customer_payments cp ON cp.order_id = ds.sale_order_id AND cp.state = 'posted'
    LEFT JOIN payment_methods pm ON pm.id = cp.method_id
    WHERE dro.route_id = _route_id
  )
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE method_code = 'cash' OR method_name LIKE '%dinheiro%' OR method_name LIKE '%cash%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method_code = 'mbway' OR method_name LIKE '%mbway%' OR method_name LIKE '%mb way%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method_code IN ('mb','multibanco','card') OR method_name LIKE '%multibanco%' OR method_name LIKE '%cart%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method_code IN ('transfer','transf','bank_transfer') OR method_name LIKE '%transfer%'), 0),
    COALESCE(SUM(amount) FILTER (WHERE NOT (
      method_code IN ('cash','mbway','mb','multibanco','card','transfer','transf','bank_transfer')
      OR method_name LIKE '%dinheiro%'
      OR method_name LIKE '%cash%'
      OR method_name LIKE '%mbway%'
      OR method_name LIKE '%mb way%'
      OR method_name LIKE '%multibanco%'
      OR method_name LIKE '%cart%'
      OR method_name LIKE '%transfer%'
    )), 0)
  INTO v_cash, v_mbway, v_mb, v_trf, v_other
  FROM route_payments;

  v_total := v_cash + v_mbway + v_mb + v_trf + v_other;

  SELECT * INTO v_existing FROM delivery_route_cash_closure WHERE route_id = _route_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_id', rp.id,
    'amount', rp.amount,
    'method', COALESCE(pm.name, pm.code, 'Pagamento')
  ) ORDER BY rp.created_at), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT cp.id, cp.amount, cp.method_id, cp.created_at
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id = dro.schedule_id
    JOIN customer_payments cp ON cp.order_id = ds.sale_order_id AND cp.state = 'posted'
    WHERE dro.route_id = _route_id
  ) rp
  LEFT JOIN payment_methods pm ON pm.id = rp.method_id;

  RETURN jsonb_build_object(
    'ok', true,
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

-- Driver app delivery now synchronizes the route order and simple manifest.
CREATE OR REPLACE FUNCTION public.driver_deliver_picking_multi(
  _picking uuid,
  _payments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pk record; rt record; bt record;
  v_driver uuid; v_vehicle uuid; v_register uuid; v_session uuid; v_journal uuid;
  v_is_unassigned boolean := false;
  so_id uuid; total_open numeric; total_pay numeric := 0;
  pay record; pay_id uuid; pay_ids uuid[] := '{}';
  v_method record; v_method_name text;
  v_route_id uuid; v_route_order_id uuid; v_schedule_id uuid;
  v_dest_type text; v_delivered_manifest int := 0;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;
  IF pk.kind <> 'outgoing' THEN RAISE EXCEPTION 'Apenas pickings de saída'; END IF;

  IF pk.route_id IS NOT NULL THEN
    SELECT * INTO rt FROM delivery_routes WHERE id = pk.route_id;
    v_driver := rt.driver_id; v_vehicle := rt.vehicle_id; v_route_id := rt.id;
  ELSIF pk.batch_id IS NOT NULL THEN
    SELECT * INTO bt FROM stock_picking_batches WHERE id = pk.batch_id;
    v_driver := bt.driver_id; v_vehicle := bt.vehicle_id;
  ELSE
    v_is_unassigned := true;
  END IF;

  IF NOT v_is_unassigned AND v_driver IS DISTINCT FROM auth.uid()
     AND NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'Esta entrega não está atribuída ao motorista atual';
  END IF;

  UPDATE stock_moves
     SET quantity_done = quantity
   WHERE picking_id = _picking
     AND coalesce(quantity_done, 0) = 0
     AND state NOT IN ('done', 'cancelled');

  PERFORM public.validate_picking(_picking);

  SELECT id, amount_total INTO so_id, total_open FROM sale_orders WHERE name = pk.origin;

  IF so_id IS NOT NULL AND v_route_id IS NOT NULL THEN
    SELECT dro.id, dro.schedule_id
      INTO v_route_order_id, v_schedule_id
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id = dro.schedule_id
    WHERE dro.route_id = v_route_id
      AND ds.sale_order_id = so_id
    LIMIT 1;
  END IF;

  IF so_id IS NOT NULL THEN
    SELECT amount_total - COALESCE((
      SELECT SUM(amount) FROM customer_payments
      WHERE order_id = so_id AND state = 'posted'
    ), 0)
    INTO total_open
    FROM sale_orders WHERE id = so_id;
  END IF;

  IF v_vehicle IS NOT NULL THEN
    SELECT cash_register_id INTO v_register FROM vehicles WHERE id = v_vehicle;
  END IF;
  IF v_register IS NULL THEN
    SELECT id INTO v_register FROM cash_registers WHERE driver_id = auth.uid() AND active LIMIT 1;
  END IF;
  IF v_register IS NOT NULL THEN
    SELECT id INTO v_session FROM cash_sessions
    WHERE register_id = v_register AND state = 'open'
    ORDER BY opened_at DESC LIMIT 1;
    IF v_session IS NOT NULL AND v_route_id IS NOT NULL THEN
      UPDATE cash_sessions SET route_id = v_route_id WHERE id = v_session AND route_id IS NULL;
    END IF;
  END IF;

  IF _payments IS NOT NULL AND jsonb_array_length(_payments) > 0 THEN
    FOR pay IN SELECT * FROM jsonb_to_recordset(_payments) AS x(method_id uuid, amount numeric) LOOP
      IF pay.amount IS NULL OR pay.amount <= 0 THEN CONTINUE; END IF;
      total_pay := total_pay + pay.amount;
      IF so_id IS NULL THEN CONTINUE; END IF;

      SELECT * INTO v_method FROM payment_methods WHERE id = pay.method_id;
      v_method_name := COALESCE(v_method.name, 'Pagamento');
      v_journal := v_method.default_journal_id;

      INSERT INTO customer_payments(name, partner_id, order_id, payment_date, amount,
              method_id, journal_id, reference, state, created_by)
      VALUES (next_sequence('customer_payment'),
              pk.partner_id, so_id, current_date, pay.amount, pay.method_id, v_journal,
              'Entrega ' || pk.name || ' (' || v_method_name || ')',
              'posted', auth.uid())
      RETURNING id INTO pay_id;
      pay_ids := pay_ids || pay_id;

      IF v_session IS NOT NULL THEN
        INSERT INTO cash_movements(session_id, kind, amount, reference, partner_id,
                user_id, payment_id, created_by, route_id, picking_id)
        VALUES (v_session, 'sale', pay.amount,
                'Entrega ' || pk.name || ' (' || v_method_name || ')',
                pk.partner_id, auth.uid(), pay_id, auth.uid(), v_route_id, _picking);
      END IF;
    END LOOP;
  END IF;

  IF total_open IS NOT NULL AND ABS(COALESCE(total_pay, 0) - total_open) > 0.01 THEN
    RAISE EXCEPTION 'Soma dos pagamentos (% €) não bate com saldo em aberto (% €)',
      to_char(total_pay, 'FM999G990D00'), to_char(total_open, 'FM999G990D00');
  END IF;

  SELECT type INTO v_dest_type FROM stock_locations WHERE id = pk.destination_location_id;

  IF v_route_order_id IS NOT NULL AND v_dest_type = 'customer' THEN
    UPDATE vehicle_route_manifest
       SET qty_delivered = GREATEST(qty_delivered, qty_loaded),
           assistance_required = assistance_required OR EXISTS (
             SELECT 1 FROM service_requests sr
             WHERE sr.state <> 'cancelled'
               AND (sr.picking_id = _picking OR sr.route_id = v_route_id)
               AND (sr.product_id IS NULL OR sr.product_id = vehicle_route_manifest.product_id)
           ),
           updated_at = now()
     WHERE route_order_id = v_route_order_id
       AND COALESCE(qty_delivered, 0) < qty_loaded;
    GET DIAGNOSTICS v_delivered_manifest = ROW_COUNT;

    UPDATE sale_order_lines sol
       SET qty_delivered = GREATEST(COALESCE(qty_delivered, 0), quantity),
           operational_status = 'delivered'
     WHERE sol.id IN (
       SELECT DISTINCT sale_order_line_id
       FROM vehicle_route_manifest
       WHERE route_order_id = v_route_order_id
         AND sale_order_line_id IS NOT NULL
     );

    UPDATE delivery_route_orders
       SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
     WHERE id = v_route_order_id;

    UPDATE delivery_schedules
       SET status = 'delivered', physical_state = 'delivered', updated_at = now()
     WHERE id = v_schedule_id;

    BEGIN
      PERFORM public.so_apply_delivery_rollup(so_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'picking', _picking,
    'payments', pay_ids,
    'sale_order', so_id,
    'route_order', v_route_order_id,
    'manifest_delivered', v_delivered_manifest,
    'total', total_pay
  );
END $$;

-- Route manual delivery also supports simple manifest lines without stock packages.
CREATE OR REPLACE FUNCTION public.delivery_order_deliver(_route_order_id uuid, _lines jsonb, _payment jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dro record; v_sched record; v_veh record; v_cust uuid;
  l jsonb; v_pkg record; v_man record; v_move uuid;
  v_delivered int := 0; v_returned int := 0; v_assist boolean := false;
  v_total int; v_done int; v_partial boolean := false; v_has_physical boolean := false;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_dro FROM delivery_route_orders WHERE id=_route_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_order_not_found'); END IF;
  SELECT * INTO v_sched FROM delivery_schedules WHERE id=v_dro.schedule_id;
  SELECT v.* INTO v_veh FROM vehicles v JOIN delivery_routes r ON r.vehicle_id=v.id WHERE r.id=v_dro.route_id;

  SELECT id INTO v_cust FROM stock_locations WHERE type='customer' LIMIT 1;
  IF v_cust IS NULL THEN
    INSERT INTO stock_locations(name, type, active) VALUES ('CUSTOMERS','customer',true) RETURNING id INTO v_cust;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vehicle_route_manifest
    WHERE route_order_id = _route_order_id AND stock_package_id IS NOT NULL
  ) INTO v_has_physical;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) LOOP
    IF COALESCE((l->>'assistance_required')::boolean,false) THEN v_assist := true; END IF;
    IF (l->>'stock_package_id') IS NOT NULL THEN
      SELECT * INTO v_pkg FROM stock_packages WHERE id=(l->>'stock_package_id')::uuid;
      SELECT * INTO v_man FROM vehicle_route_manifest
        WHERE route_id=v_dro.route_id AND stock_package_id=v_pkg.id LIMIT 1;
      IF v_man.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','package_not_in_manifest','pkg',v_pkg.id); END IF;
      IF v_pkg.current_location_id <> v_veh.stock_location_id THEN
        RETURN jsonb_build_object('ok',false,'error','package_not_in_vehicle','pkg',v_pkg.id);
      END IF;
      IF v_pkg.status='delivered' THEN RETURN jsonb_build_object('ok',false,'error','already_delivered'); END IF;

      IF COALESCE((l->>'qty_delivered')::numeric,0) > 0 THEN
        v_move := public._m4_make_move(v_pkg.product_id, v_veh.stock_location_id, v_cust,
                                       (l->>'qty_delivered')::numeric, 'deliver:'||_route_order_id, v_pkg.id);
        PERFORM public.package_move(v_pkg.id, v_cust, NULL, NULL, 'delivered', v_move, (l->>'qty_delivered')::numeric);
        UPDATE stock_packages SET status='delivered'::package_status WHERE id=v_pkg.id;
        UPDATE vehicle_route_manifest SET qty_delivered=qty_delivered+(l->>'qty_delivered')::numeric,
                                          assistance_required=v_man.assistance_required OR COALESCE((l->>'assistance_required')::boolean,false),
                                          updated_at=now()
         WHERE id=v_man.id;
        IF (l->>'sale_order_line_id') IS NOT NULL THEN
          UPDATE sale_order_lines SET qty_delivered=COALESCE(qty_delivered,0)+(l->>'qty_delivered')::numeric
           WHERE id=(l->>'sale_order_line_id')::uuid;
        END IF;
        v_delivered := v_delivered+1;
      END IF;
      IF COALESCE((l->>'qty_returned')::numeric,0) > 0 THEN
        UPDATE vehicle_route_manifest SET qty_returned=qty_returned+(l->>'qty_returned')::numeric,
                                          return_condition=COALESCE(l->>'return_condition','good')::return_kind,
                                          return_reason=l->>'return_reason', updated_at=now()
         WHERE id=v_man.id;
        v_returned := v_returned+1;
      END IF;
    ELSIF NOT v_has_physical AND (l->>'manifest_id') IS NOT NULL THEN
      UPDATE vehicle_route_manifest
         SET qty_delivered = GREATEST(qty_delivered, COALESCE((l->>'qty_delivered')::numeric, qty_loaded)),
             assistance_required = assistance_required OR COALESCE((l->>'assistance_required')::boolean,false),
             updated_at = now()
       WHERE id = (l->>'manifest_id')::uuid
         AND route_order_id = _route_order_id;
      v_delivered := v_delivered + 1;
    END IF;
  END LOOP;

  IF NOT v_has_physical AND v_delivered = 0 THEN
    UPDATE vehicle_route_manifest
       SET qty_delivered = GREATEST(qty_delivered, qty_loaded), updated_at = now()
     WHERE route_order_id = _route_order_id
       AND COALESCE(qty_delivered,0) < qty_loaded;
    GET DIAGNOSTICS v_delivered = ROW_COUNT;
  END IF;

  IF NOT v_has_physical THEN
    UPDATE sale_order_lines sol
       SET qty_delivered = GREATEST(COALESCE(qty_delivered, 0), quantity),
           operational_status = 'delivered'
     WHERE sol.id IN (
       SELECT DISTINCT sale_order_line_id
       FROM vehicle_route_manifest
       WHERE route_order_id = _route_order_id
         AND sale_order_line_id IS NOT NULL
     );
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE qty_pending<=0) INTO v_total, v_done
    FROM vehicle_route_manifest WHERE route_order_id=_route_order_id;
  IF v_total > 0 AND v_done < v_total THEN v_partial := true; END IF;

  IF v_partial THEN
    UPDATE delivery_route_orders SET status='partial', delivered_at=COALESCE(delivered_at,now()), updated_at=now() WHERE id=_route_order_id;
    UPDATE delivery_schedules SET status='partial', updated_at=now() WHERE id=v_dro.schedule_id;
    PERFORM public.so_split_partial_delivery(v_sched.sale_order_id);
  ELSE
    UPDATE delivery_route_orders SET status='delivered', delivered_at=now(), updated_at=now() WHERE id=_route_order_id;
    UPDATE delivery_schedules SET status='delivered', physical_state='delivered', updated_at=now() WHERE id=v_dro.schedule_id;
  END IF;

  BEGIN
    PERFORM public.so_apply_delivery_rollup(v_sched.sale_order_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM public._m3_log(v_sched.sale_order_id,'delivery.order.delivered',_route_order_id::text,
    jsonb_build_object('delivered',v_delivered,'returned',v_returned,'partial',v_partial,'assist',v_assist));
  RETURN jsonb_build_object('ok',true,'delivered',v_delivered,'returned',v_returned,'partial',v_partial);
END
$function$;