
CREATE OR REPLACE FUNCTION public.delivery_pick_to_pickup_area(_pickup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  FOR v_sol IN
    SELECT sol.* FROM sale_order_lines sol
     WHERE sol.order_id=v_pk.sale_order_id
       AND NOT public.is_package_tracking_enabled_for_product(sol.product_id)
       AND COALESCE(sol.qty_delivered,0) < sol.quantity
  LOOP
    SELECT id INTO v_src FROM stock_locations WHERE type='internal' AND return_kind IS NULL AND id<>v_dst LIMIT 1;
    v_qty := v_sol.quantity - COALESCE(v_sol.qty_delivered,0);
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
