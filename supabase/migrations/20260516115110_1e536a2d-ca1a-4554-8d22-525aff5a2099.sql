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
             return_condition=v_cond, return_reason=l->>'reason', updated_at=now()
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