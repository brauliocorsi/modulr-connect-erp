
-- ========== SCHEMA ==========
ALTER TABLE public.delivery_routes DROP CONSTRAINT IF EXISTS delivery_routes_state_check;
ALTER TABLE public.delivery_routes
  ADD CONSTRAINT delivery_routes_state_check
  CHECK (state = ANY (ARRAY['planned','loading','in_progress','return_pending','awaiting_cash_closure','closed','done','cancelled']));

ALTER TABLE public.vehicle_route_manifest
  ADD COLUMN IF NOT EXISTS stock_package_id uuid REFERENCES public.stock_packages(id),
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS stackable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fragile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_flat_transport boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_manifest_pkg_route
  ON public.vehicle_route_manifest(route_id, stock_package_id)
  WHERE stock_package_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.package_damage_report(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_package_id uuid NOT NULL REFERENCES public.stock_packages(id),
  route_id uuid REFERENCES public.delivery_routes(id),
  route_order_id uuid REFERENCES public.delivery_route_orders(id),
  condition text NOT NULL CHECK (condition IN ('damaged','quarantine')),
  reason text,
  reported_by uuid,
  reported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.package_damage_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdr_logistics ON public.package_damage_report;
CREATE POLICY pdr_logistics ON public.package_damage_report
  FOR ALL USING (public._m3_is_logistics()) WITH CHECK (public._m3_is_logistics());

CREATE OR REPLACE FUNCTION public._m4_pick_lane(_dock_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT l.id FROM loading_dock_lanes l
   WHERE l.dock_id=_dock_id AND l.active
   ORDER BY l.code NULLS LAST, l.id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._m4_return_loc(_kind text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM stock_locations WHERE return_kind=_kind::return_kind LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._m4_make_move(_product uuid, _src uuid, _dst uuid, _qty numeric, _ref text, _pkg uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO stock_moves(product_id, source_location_id, destination_location_id,
                          quantity, quantity_done, state, reference, package_id)
  VALUES (_product, _src, _dst, _qty, _qty, 'done', _ref, _pkg)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- RPC: pick_to_dock
CREATE OR REPLACE FUNCTION public.delivery_pick_to_dock(_route_id uuid, _dock_id uuid, _lane_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_route record; v_lane_loc uuid; v_lane uuid := _lane_id;
  r record; pkg record; v_move uuid; v_count int := 0; v_dt_count int := 0;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_lane IS NULL THEN v_lane := public._m4_pick_lane(_dock_id); END IF;
  IF v_lane IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_lane_available'); END IF;
  SELECT stock_location_id INTO v_lane_loc FROM loading_dock_lanes WHERE id=v_lane;
  IF v_lane_loc IS NULL THEN RETURN jsonb_build_object('ok',false,'error','lane_no_stock_location'); END IF;

  FOR r IN
    SELECT dro.id AS route_order_id, dro.schedule_id, ds.sale_order_id
      FROM delivery_route_orders dro
      JOIN delivery_schedules ds ON ds.id=dro.schedule_id
     WHERE dro.route_id=_route_id AND dro.status NOT IN ('cancelled','returned')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM dock_transfers WHERE route_id=_route_id AND schedule_id=r.schedule_id) THEN
      INSERT INTO dock_transfers(route_id, schedule_id, dock_id, lane_id, status, moved_at, created_by)
      VALUES (_route_id, r.schedule_id, _dock_id, v_lane, 'moved_to_dock', now(), auth.uid());
      v_dt_count := v_dt_count + 1;
    ELSE
      UPDATE dock_transfers SET status='moved_to_dock', moved_at=COALESCE(moved_at,now()), dock_id=_dock_id, lane_id=v_lane
       WHERE route_id=_route_id AND schedule_id=r.schedule_id AND status='planned';
    END IF;

    FOR pkg IN
      SELECT sp.* FROM stock_packages sp
       JOIN products p ON p.id=sp.product_id
       WHERE sp.sale_order_id=r.sale_order_id
         AND COALESCE(p.package_tracking_enabled,false)=true
         AND sp.status IN ('available','reserved')
         AND sp.condition NOT IN ('damaged','quarantine','missing')
         AND sp.current_location_id IS NOT NULL
         AND sp.current_location_id <> v_lane_loc
    LOOP
      v_move := public._m4_make_move(pkg.product_id, pkg.current_location_id, v_lane_loc,
                                     pkg.qty, 'pick_to_dock:'||_route_id, pkg.id);
      PERFORM public.package_move(pkg.id, v_lane_loc, NULL, NULL, 'pick_to_dock', v_move, pkg.qty);
      v_count := v_count + 1;
    END LOOP;

    UPDATE delivery_schedules SET physical_state='at_dock', dock_id=_dock_id, lane_id=v_lane, updated_at=now()
     WHERE id=r.schedule_id;
    PERFORM public._m3_log(r.sale_order_id,'delivery.picked_to_dock',_route_id::text,
      jsonb_build_object('dock_id',_dock_id,'lane_id',v_lane));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'packages_moved',v_count,'dock_transfers_created',v_dt_count,'lane_id',v_lane);
END $$;

-- RPC: load_vehicle
CREATE OR REPLACE FUNCTION public.delivery_load_vehicle(_route_id uuid, _lines jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_route record; v_veh record; v_veh_loc uuid;
  r record; pkg record; v_move uuid; v_loaded int := 0;
  v_verify_req boolean;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.vehicle_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_vehicle'); END IF;
  SELECT * INTO v_veh FROM vehicles WHERE id=v_route.vehicle_id;
  IF v_veh.stock_location_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','vehicle_no_location'); END IF;
  v_veh_loc := v_veh.stock_location_id;
  v_verify_req := COALESCE(v_route.requires_load_verification,false);

  FOR r IN
    SELECT dro.id AS route_order_id, dro.schedule_id, ds.sale_order_id, dt.lane_id, dt.id AS dock_transfer_id,
           lane.stock_location_id AS lane_loc
      FROM delivery_route_orders dro
      JOIN delivery_schedules ds ON ds.id=dro.schedule_id
      LEFT JOIN dock_transfers dt ON dt.route_id=_route_id AND dt.schedule_id=dro.schedule_id
      LEFT JOIN loading_dock_lanes lane ON lane.id=dt.lane_id
     WHERE dro.route_id=_route_id AND dro.status NOT IN ('cancelled','returned')
  LOOP
    IF r.lane_loc IS NULL THEN CONTINUE; END IF;
    FOR pkg IN
      SELECT sp.*, sol.id AS sale_order_line_id
        FROM stock_packages sp
        JOIN sale_order_lines sol ON sol.order_id=r.sale_order_id AND sol.product_id=sp.product_id
        JOIN products p ON p.id=sp.product_id
       WHERE sp.sale_order_id=r.sale_order_id
         AND COALESCE(p.package_tracking_enabled,false)=true
         AND sp.status IN ('available','reserved')
         AND sp.condition NOT IN ('damaged','quarantine','missing')
         AND sp.current_location_id = r.lane_loc
    LOOP
      v_move := public._m4_make_move(pkg.product_id, r.lane_loc, v_veh_loc, pkg.qty,
                                     'load_vehicle:'||_route_id, pkg.id);
      PERFORM public.package_move(pkg.id, v_veh_loc, NULL, NULL, 'load_vehicle', v_move, pkg.qty);
      IF NOT EXISTS (SELECT 1 FROM vehicle_route_manifest WHERE route_id=_route_id AND stock_package_id=pkg.id) THEN
        INSERT INTO vehicle_route_manifest(
          route_id, route_order_id, schedule_id, sale_order_line_id, product_id, stock_move_id,
          vehicle_location_id, qty_loaded, qty_delivered, qty_returned, qty_pending,
          stock_package_id, package_ref, package_sequence, package_group, package_total,
          length_cm, width_cm, height_cm, volume_m3, weight_kg, stackable, fragile, requires_flat_transport,
          verification_required, loaded_by, loaded_at
        ) VALUES (
          _route_id, r.route_order_id, r.schedule_id, pkg.sale_order_line_id, pkg.product_id, v_move,
          v_veh_loc, pkg.qty, 0, 0, pkg.qty,
          pkg.id, pkg.package_ref, pkg.package_sequence, pkg.package_group, pkg.package_total,
          pkg.length_cm, pkg.width_cm, pkg.height_cm, pkg.volume_m3, pkg.weight_kg,
          pkg.stackable, pkg.fragile, pkg.requires_flat_transport,
          v_verify_req, auth.uid(), now()
        );
        v_loaded := v_loaded + 1;
      END IF;
    END LOOP;
    UPDATE dock_transfers SET status='loaded', loaded_at=now()
     WHERE route_id=_route_id AND schedule_id=r.schedule_id AND status='moved_to_dock';
    UPDATE delivery_schedules SET physical_state='in_truck', vehicle_id=v_route.vehicle_id, status='loaded', updated_at=now()
     WHERE id=r.schedule_id;
    UPDATE delivery_route_orders SET status='loaded', loaded_at=now() WHERE id=r.route_order_id AND status='planned';
    PERFORM public._m3_log(r.sale_order_id,'delivery.vehicle.loaded',_route_id::text, jsonb_build_object('packages',v_loaded));
  END LOOP;

  UPDATE delivery_routes SET state='loading', updated_at=now()
   WHERE id=_route_id AND state IN ('planned','loading');
  RETURN jsonb_build_object('ok',true,'packages_loaded',v_loaded,'vehicle_location_id',v_veh_loc);
END $$;

-- RPC: verify_load
CREATE OR REPLACE FUNCTION public.delivery_verify_load(_route_id uuid, _manifest_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int := 0; r record;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  FOR r IN SELECT id, loaded_by, verification_required FROM vehicle_route_manifest WHERE route_id=_route_id AND id=ANY(_manifest_ids) LOOP
    IF r.verification_required AND auth.uid() IS NOT NULL AND r.loaded_by IS NOT NULL AND r.loaded_by=auth.uid() THEN
      RETURN jsonb_build_object('ok',false,'error','auto_verification_forbidden','manifest_id',r.id);
    END IF;
    UPDATE vehicle_route_manifest SET verified_by=auth.uid(), verified_at=now(), updated_at=now()
     WHERE id=r.id AND verified_at IS NULL;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'verified',v_count);
END $$;

-- RPC: route_start
CREATE OR REPLACE FUNCTION public.delivery_route_start(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_route record; v_pending int;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.state NOT IN ('loading','planned') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_state','state',v_route.state);
  END IF;
  SELECT COUNT(*) INTO v_pending FROM vehicle_route_manifest
    WHERE route_id=_route_id AND verification_required=true AND verified_at IS NULL;
  IF v_pending > 0 THEN RETURN jsonb_build_object('ok',false,'error','verification_pending','pending',v_pending); END IF;
  UPDATE delivery_routes SET state='in_progress', updated_at=now() WHERE id=_route_id;
  UPDATE delivery_schedules SET status='out_for_delivery', updated_at=now()
   WHERE route_id=_route_id AND status IN ('loaded','scheduled');
  UPDATE delivery_route_orders SET status='in_transit' WHERE route_id=_route_id AND status='loaded';
  PERFORM public._m3_log(NULL,'delivery.route.started',_route_id::text, jsonb_build_object());
  RETURN jsonb_build_object('ok',true);
END $$;

-- RPC: order_deliver
CREATE OR REPLACE FUNCTION public.delivery_order_deliver(_route_order_id uuid, _lines jsonb, _payment jsonb DEFAULT NULL)
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
        UPDATE stock_packages SET status='delivered' WHERE id=v_pkg.id;
        UPDATE vehicle_route_manifest SET qty_delivered=qty_delivered+(l->>'qty_delivered')::numeric,
                                          qty_pending=GREATEST(qty_pending-(l->>'qty_delivered')::numeric,0),
                                          assistance_required=v_man.assistance_required OR COALESCE((l->>'assistance_required')::boolean,false),
                                          updated_at=now()
         WHERE id=v_man.id;
        UPDATE sale_order_lines SET qty_delivered=COALESCE(qty_delivered,0)+(l->>'qty_delivered')::numeric
         WHERE id=(l->>'sale_order_line_id')::uuid;
        v_delivered := v_delivered+1;
      END IF;
      IF COALESCE((l->>'qty_returned')::numeric,0) > 0 THEN
        UPDATE vehicle_route_manifest SET qty_returned=qty_returned+(l->>'qty_returned')::numeric,
                                          return_condition=COALESCE(l->>'return_condition','good'),
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

  IF v_assist THEN
    PERFORM public._m3_log(v_sched.sale_order_id,'delivery.assistance_reported',_route_order_id::text, jsonb_build_object());
  END IF;
  PERFORM public._m3_log(v_sched.sale_order_id,'delivery.order.delivered',_route_order_id::text,
    jsonb_build_object('delivered_pkgs',v_delivered,'returned_pkgs',v_returned,'partial',v_partial));
  RETURN jsonb_build_object('ok',true,'partial',v_partial,'delivered_packages',v_delivered,'returned_packages',v_returned);
END $$;

-- RPC: order_fail
CREATE OR REPLACE FUNCTION public.delivery_order_fail(_route_order_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_dro record;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_dro FROM delivery_route_orders WHERE id=_route_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_order_not_found'); END IF;
  UPDATE delivery_route_orders SET status='failed', failed_reason=_reason WHERE id=_route_order_id;
  UPDATE delivery_schedules SET status='failed', updated_at=now() WHERE id=v_dro.schedule_id;
  PERFORM public._m3_log(NULL,'delivery.order.failed',_route_order_id::text, jsonb_build_object('reason',_reason));
  RETURN jsonb_build_object('ok',true);
END $$;

-- RPC: return_to_warehouse
CREATE OR REPLACE FUNCTION public.delivery_return_to_warehouse(_route_order_id uuid, _lines jsonb, _mode text DEFAULT 'release_reserved')
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
       SET condition = CASE WHEN v_cond IN ('damaged','quarantine') THEN v_cond ELSE condition END,
           status = CASE WHEN v_cond='good' AND _mode='keep_reserved' THEN 'reserved' ELSE 'available' END
     WHERE id=v_pkg.id;

    IF v_cond IN ('damaged','quarantine') THEN
      INSERT INTO package_damage_report(stock_package_id, route_id, route_order_id, condition, reason, reported_by)
      VALUES (v_pkg.id, v_dro.route_id, _route_order_id, v_cond, l->>'reason', auth.uid());
    END IF;

    IF v_man.id IS NOT NULL THEN
      UPDATE vehicle_route_manifest
         SET qty_returned=qty_returned+COALESCE((l->>'qty')::numeric, v_pkg.qty),
             qty_pending=GREATEST(qty_pending-COALESCE((l->>'qty')::numeric, v_pkg.qty),0),
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

-- RPC: route_complete
CREATE OR REPLACE FUNCTION public.delivery_route_complete(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_route record; v_pend int; v_stock int;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  SELECT COUNT(*) INTO v_pend FROM delivery_route_orders
    WHERE route_id=_route_id AND status IN ('planned','loading','loaded','in_transit');
  SELECT COUNT(*) INTO v_stock FROM stock_packages sp
    JOIN vehicles v ON v.stock_location_id=sp.current_location_id
   WHERE v.id=v_route.vehicle_id;
  IF v_pend > 0 OR v_stock > 0 THEN
    UPDATE delivery_routes SET state='return_pending', updated_at=now() WHERE id=_route_id;
    PERFORM public._m3_log(NULL,'delivery.route.return_pending',_route_id::text,
      jsonb_build_object('pending_orders',v_pend,'vehicle_stock',v_stock));
    RETURN jsonb_build_object('ok',true,'state','return_pending');
  END IF;
  UPDATE delivery_routes SET state='awaiting_cash_closure', updated_at=now() WHERE id=_route_id;
  PERFORM public._m3_log(NULL,'delivery.route.completed',_route_id::text,jsonb_build_object());
  RETURN jsonb_build_object('ok',true,'state','awaiting_cash_closure');
END $$;

-- RPC: route_close
CREATE OR REPLACE FUNCTION public.delivery_route_close(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_route record; v_stock int; v_open int; v_unv int;
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
  UPDATE delivery_routes SET state='closed', updated_at=now() WHERE id=_route_id;
  PERFORM public._m3_log(NULL,'delivery.route.closed',_route_id::text,jsonb_build_object());
  RETURN jsonb_build_object('ok',true,'state','closed');
END $$;

-- Health check M4
CREATE OR REPLACE FUNCTION public.erp_m4_health_check()
RETURNS TABLE(severity text, code text, ref text, detail jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'P0','route_closed_with_vehicle_stock', r.id::text,
         jsonb_build_object('vehicle_id',r.vehicle_id)
    FROM delivery_routes r
    JOIN vehicles v ON v.id=r.vehicle_id
   WHERE r.state='closed'
     AND EXISTS (SELECT 1 FROM stock_packages sp WHERE sp.current_location_id=v.stock_location_id)
  UNION ALL
  SELECT 'P0','package_in_vehicle_without_manifest', sp.id::text,
         jsonb_build_object('vehicle_location_id',sp.current_location_id)
    FROM stock_packages sp
    JOIN vehicles v ON v.stock_location_id=sp.current_location_id
   WHERE NOT EXISTS (SELECT 1 FROM vehicle_route_manifest m WHERE m.stock_package_id=sp.id)
  UNION ALL
  SELECT 'P0','damaged_package_available', sp.id::text, jsonb_build_object('status',sp.status,'condition',sp.condition)
    FROM stock_packages sp
   WHERE sp.condition IN ('damaged','quarantine') AND sp.status='available'
     AND sp.current_location_id NOT IN (SELECT id FROM stock_locations WHERE return_kind IN ('damaged','quarantine'))
  UNION ALL
  SELECT 'P1','unverified_load', m.id::text, jsonb_build_object('route_id',m.route_id)
    FROM vehicle_route_manifest m
    JOIN delivery_routes r ON r.id=m.route_id
   WHERE m.verification_required=true AND m.verified_at IS NULL AND r.state IN ('in_progress','return_pending')
  UNION ALL
  SELECT 'P1','route_stuck_return_pending', r.id::text, jsonb_build_object('updated_at',r.updated_at)
    FROM delivery_routes r WHERE r.state='return_pending' AND r.updated_at < now() - interval '2 days';
$$;
