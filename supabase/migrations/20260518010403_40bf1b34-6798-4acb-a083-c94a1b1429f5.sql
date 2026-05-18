-- ============================================================
-- D20: post-delivery rollup for sale_orders.operational_status
-- ============================================================

CREATE OR REPLACE FUNCTION public.so_apply_delivery_rollup(_so uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lines_total int; v_lines_done int; v_lines_some int;
  v_op text; v_ff text;
BEGIN
  IF _so IS NULL THEN RETURN jsonb_build_object('ok',false,'error','so_required'); END IF;

  -- 1) Marca linhas totalmente entregues como 'delivered' (idempotente).
  UPDATE sale_order_lines
     SET operational_status = 'delivered'
   WHERE order_id = _so
     AND line_kind = 'product'
     AND product_id IS NOT NULL
     AND quantity > 0
     AND COALESCE(qty_delivered,0) >= quantity
     AND operational_status IS DISTINCT FROM 'delivered';

  -- 2) Atualiza payment_status e fulfillment_status pelos helpers existentes.
  BEGIN PERFORM public.recalc_payment_status(_so); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.recalc_so_fulfillment(_so); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 3) Conta linhas entregues para override defensivo de fulfillment_status
  --    (a entrega pode ocorrer via _m4_make_move sem fechar stock_pickings.outgoing,
  --     caso em que recalc_so_fulfillment não detecta a entrega).
  SELECT
    COUNT(*) FILTER (WHERE line_kind='product' AND quantity > 0),
    COUNT(*) FILTER (WHERE line_kind='product' AND quantity > 0
                     AND COALESCE(qty_delivered,0) >= quantity),
    COUNT(*) FILTER (WHERE line_kind='product' AND quantity > 0
                     AND COALESCE(qty_delivered,0) > 0
                     AND COALESCE(qty_delivered,0) < quantity)
  INTO v_lines_total, v_lines_done, v_lines_some
  FROM sale_order_lines WHERE order_id = _so;

  v_op := public.so_rollup_operational_status(_so);

  IF v_lines_total > 0 AND v_lines_done = v_lines_total THEN
    v_ff := 'delivered';
  ELSIF v_lines_done > 0 OR v_lines_some > 0 THEN
    v_ff := 'delivered_partial';
  ELSE
    v_ff := NULL; -- não força mudança
  END IF;

  -- 4) Atualiza header. Trigger trg_so_recompute_state cuida do state='done'
  --    quando payment_status='paid' e fulfillment_status='delivered'.
  UPDATE sale_orders
     SET operational_status = v_op,
         fulfillment_status = COALESCE(v_ff, fulfillment_status),
         last_planned_at = now()
   WHERE id = _so
     AND (operational_status IS DISTINCT FROM v_op
          OR (v_ff IS NOT NULL AND fulfillment_status IS DISTINCT FROM v_ff));

  RETURN jsonb_build_object(
    'ok', true,
    'operational_status', v_op,
    'fulfillment_status', v_ff,
    'lines_total', v_lines_total,
    'lines_done', v_lines_done,
    'lines_partial', v_lines_some);
END
$function$;

GRANT EXECUTE ON FUNCTION public.so_apply_delivery_rollup(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Integra rollup em delivery_order_deliver (idempotente).
-- ------------------------------------------------------------
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
  v_total int; v_done int; v_partial boolean := false;
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

  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
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
        UPDATE sale_order_lines SET qty_delivered=COALESCE(qty_delivered,0)+(l->>'qty_delivered')::numeric
         WHERE id=(l->>'sale_order_line_id')::uuid;
        v_delivered := v_delivered+1;
      END IF;
      IF COALESCE((l->>'qty_returned')::numeric,0) > 0 THEN
        UPDATE vehicle_route_manifest SET qty_returned=qty_returned+(l->>'qty_returned')::numeric,
                                          return_condition=COALESCE(l->>'return_condition','good')::return_kind,
                                          return_reason=l->>'return_reason', updated_at=now()
         WHERE id=v_man.id;
        v_returned := v_returned+1;
      END IF;
    END IF;
  END LOOP;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE qty_pending<=0) INTO v_total, v_done
    FROM vehicle_route_manifest WHERE route_order_id=_route_order_id AND stock_package_id IS NOT NULL;
  IF v_total > 0 AND v_done < v_total THEN v_partial := true; END IF;

  IF v_partial THEN
    UPDATE delivery_route_orders SET status='partial', delivered_at=COALESCE(delivered_at,now()) WHERE id=_route_order_id;
    UPDATE delivery_schedules SET status='partial', updated_at=now() WHERE id=v_dro.schedule_id;
    PERFORM public.so_split_partial_delivery(v_sched.sale_order_id);
  ELSE
    UPDATE delivery_route_orders SET status='delivered', delivered_at=now() WHERE id=_route_order_id;
    UPDATE delivery_schedules SET status='delivered', physical_state='delivered', updated_at=now() WHERE id=v_dro.schedule_id;
  END IF;

  -- D20: rollup pós-entrega. Idempotente; o trigger trg_so_recompute_state
  -- cuida de promover sale_orders.state='done' quando payment_status='paid'.
  BEGIN
    PERFORM public.so_apply_delivery_rollup(v_sched.sale_order_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM public._m3_log(v_sched.sale_order_id,'delivery.order.delivered',_route_order_id::text,
    jsonb_build_object('delivered',v_delivered,'returned',v_returned,'partial',v_partial,'assist',v_assist));
  RETURN jsonb_build_object('ok',true,'delivered',v_delivered,'returned',v_returned,'partial',v_partial);
END
$function$;