CREATE OR REPLACE FUNCTION public.delivery_return_to_warehouse(_route_order_id uuid, _lines jsonb, _mode text DEFAULT 'release_reserved'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_dro record; v_veh record; l jsonb; v_pkg record; v_man record;
  v_dest uuid; v_move uuid; v_count int := 0; v_cond text;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF _mode NOT IN ('keep_reserved','release_reserved') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_mode');
  END IF;
  SELECT * INTO v_dro FROM delivery_route_orders WHERE id=_route_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_order_not_found'); END IF;
  SELECT v.* INTO v_veh FROM vehicles v JOIN delivery_routes r ON r.vehicle_id=v.id WHERE r.id=v_dro.route_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_cond := COALESCE(l->>'return_condition','good');
    v_dest := public._m4_return_loc(v_cond);
    IF v_dest IS NULL THEN RETURN jsonb_build_object('ok',false,'error','return_location_missing','kind',v_cond); END IF;

    SELECT * INTO v_pkg FROM stock_packages WHERE id=(l->>'stock_package_id')::uuid;
    SELECT * INTO v_man FROM vehicle_route_manifest WHERE route_id=v_dro.route_id AND stock_package_id=v_pkg.id LIMIT 1;
    IF v_pkg.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','package_not_found'); END IF;
    IF v_pkg.status='delivered' THEN RETURN jsonb_build_object('ok',false,'error','already_delivered'); END IF;
    IF v_pkg.current_location_id <> v_veh.stock_location_id THEN
      RETURN jsonb_build_object('ok',false,'error','package_not_in_vehicle');
    END IF;

    v_move := public._m4_make_move(v_pkg.product_id, v_veh.stock_location_id, v_dest,
                                   COALESCE((l->>'qty')::numeric, v_pkg.qty),
                                   'return:'||v_cond, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_dest, NULL, NULL, 'return_'||v_cond, v_move, COALESCE((l->>'qty')::numeric,v_pkg.qty));

    UPDATE stock_packages
       SET condition = CASE WHEN v_cond IN ('damaged','quarantine') THEN v_cond::package_condition ELSE condition END,
           status = CASE WHEN v_cond='good' AND _mode='keep_reserved' THEN 'reserved'::package_status ELSE 'available'::package_status END
     WHERE id=v_pkg.id;

    IF v_cond IN ('damaged','quarantine') THEN
      INSERT INTO package_damage_report(stock_package_id, route_id, route_order_id, condition, reason, reported_by)
      VALUES (v_pkg.id, v_dro.route_id, _route_order_id, v_cond, l->>'reason', auth.uid());
    END IF;

    IF v_man.id IS NOT NULL THEN
      UPDATE vehicle_route_manifest
         SET qty_returned=qty_returned+COALESCE((l->>'qty')::numeric, v_pkg.qty),
             return_condition=v_cond::return_kind, return_reason=l->>'reason', updated_at=now()
       WHERE id=v_man.id;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE delivery_route_orders SET status=CASE WHEN status='failed' THEN 'returned' ELSE status END,
                                   returned_at=now() WHERE id=_route_order_id;
  PERFORM public._m3_log(NULL,'delivery.returned_to_warehouse',_route_order_id::text,
    jsonb_build_object('mode',_mode,'count',v_count));
  RETURN jsonb_build_object('ok',true,'returned',v_count);
END $$;

-- Also patch delivery_order_deliver for the same enum cast
CREATE OR REPLACE FUNCTION public.delivery_order_deliver(_route_order_id uuid, _lines jsonb, _payment jsonb DEFAULT NULL::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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

  PERFORM public._m3_log(v_sched.sale_order_id,'delivery.order.delivered',_route_order_id::text,
    jsonb_build_object('delivered',v_delivered,'returned',v_returned,'partial',v_partial,'assist',v_assist));
  RETURN jsonb_build_object('ok',true,'delivered',v_delivered,'returned',v_returned,'partial',v_partial);
END $$;