
-- Limpa manifest gerado em modo simples (sem package físico) — será reconstruído ao clicar em Carregar viatura.
DELETE FROM public.vehicle_route_manifest WHERE stock_package_id IS NULL AND stock_move_id IS NULL;

CREATE OR REPLACE FUNCTION public.delivery_load_vehicle(_route_id uuid, _lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_route record; v_veh record; v_veh_loc uuid;
  r record; pkg record; v_move uuid; v_loaded int := 0;
  v_verify_req boolean;
  v_has_docks boolean;
  sol record; pp record;
  v_unit int; v_total int;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.vehicle_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_vehicle'); END IF;
  SELECT * INTO v_veh FROM vehicles WHERE id=v_route.vehicle_id;
  IF v_veh.stock_location_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','vehicle_no_location'); END IF;
  v_veh_loc := v_veh.stock_location_id;
  v_verify_req := COALESCE(v_route.requires_load_verification,false);

  UPDATE delivery_routes SET state='loading' WHERE id=_route_id AND state IN ('planned','draft','assigned','dispatched');

  SELECT EXISTS (SELECT 1 FROM dock_transfers WHERE route_id=_route_id) INTO v_has_docks;

  IF v_has_docks THEN
    -- MODO COMPLETO (sem alteração)
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
        SELECT sp.*, sol2.id AS sale_order_line_id
          FROM stock_packages sp
          JOIN sale_order_lines sol2 ON sol2.order_id=r.sale_order_id AND sol2.product_id=sp.product_id
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
            vehicle_location_id, qty_loaded, qty_delivered, qty_returned,
            stock_package_id, package_ref, package_sequence, package_group, package_total,
            length_cm, width_cm, height_cm, volume_m3, weight_kg, stackable, fragile, requires_flat_transport,
            verification_required, loaded_by, loaded_at
          ) VALUES (
            _route_id, r.route_order_id, r.schedule_id, pkg.sale_order_line_id, pkg.product_id, v_move,
            v_veh_loc, pkg.qty, 0, 0,
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

  ELSE
    -- MODO SIMPLES: 1 linha por (unidade × caixa do produto)
    FOR r IN
      SELECT dro.id AS route_order_id, dro.schedule_id, ds.sale_order_id
        FROM delivery_route_orders dro
        JOIN delivery_schedules ds ON ds.id=dro.schedule_id
       WHERE dro.route_id=_route_id AND dro.status NOT IN ('cancelled','returned')
    LOOP
      FOR sol IN
        SELECT sol2.id AS sale_order_line_id, sol2.product_id,
               GREATEST(COALESCE(sol2.quantity,0) - COALESCE(sol2.qty_delivered,0), 0) AS qty,
               p.depth AS p_length, p.width AS p_width, p.height AS p_height,
               COALESCE(p.weight_kg, p.weight) AS p_weight,
               COALESCE(p.volume_m3, p.volume) AS p_volume,
               p.name AS p_name
          FROM sale_order_lines sol2
          JOIN products p ON p.id=sol2.product_id
         WHERE sol2.order_id = r.sale_order_id
           AND COALESCE(sol2.line_kind,'product') = 'product'
           AND sol2.product_id IS NOT NULL
      LOOP
        IF sol.qty <= 0 THEN CONTINUE; END IF;

        -- nº de caixas/colis por unidade
        SELECT COUNT(*) INTO v_total FROM product_packages WHERE product_id = sol.product_id;
        IF v_total = 0 THEN v_total := 1; END IF;

        FOR v_unit IN 1..sol.qty::int LOOP
          IF v_total = 1 AND NOT EXISTS (SELECT 1 FROM product_packages WHERE product_id=sol.product_id) THEN
            -- produto sem packages: 1 linha por unidade
            INSERT INTO vehicle_route_manifest(
              route_id, route_order_id, schedule_id, sale_order_line_id, product_id, stock_move_id,
              vehicle_location_id, qty_loaded, qty_delivered, qty_returned,
              stock_package_id, package_ref, package_sequence, package_total,
              length_cm, width_cm, height_cm, volume_m3, weight_kg,
              stackable, fragile, requires_flat_transport,
              verification_required, loaded_by, loaded_at
            ) VALUES (
              _route_id, r.route_order_id, r.schedule_id, sol.sale_order_line_id, sol.product_id, NULL,
              v_veh_loc, 1, 0, 0,
              NULL, sol.p_name || ' #' || v_unit::text, 1, 1,
              sol.p_length, sol.p_width, sol.p_height, sol.p_volume, sol.p_weight,
              true, false, false,
              v_verify_req, auth.uid(), now()
            );
            v_loaded := v_loaded + 1;
          ELSE
            FOR pp IN
              SELECT label, barcode, weight_kg, sequence
                FROM product_packages
               WHERE product_id = sol.product_id
               ORDER BY sequence
            LOOP
              INSERT INTO vehicle_route_manifest(
                route_id, route_order_id, schedule_id, sale_order_line_id, product_id, stock_move_id,
                vehicle_location_id, qty_loaded, qty_delivered, qty_returned,
                stock_package_id, package_ref, package_sequence, package_total,
                length_cm, width_cm, height_cm, volume_m3, weight_kg,
                stackable, fragile, requires_flat_transport,
                verification_required, loaded_by, loaded_at
              ) VALUES (
                _route_id, r.route_order_id, r.schedule_id, sol.sale_order_line_id, sol.product_id, NULL,
                v_veh_loc, 1, 0, 0,
                NULL, pp.label || ' (un.' || v_unit::text || ')', pp.sequence, v_total,
                sol.p_length, sol.p_width, sol.p_height,
                CASE WHEN sol.p_volume IS NOT NULL THEN sol.p_volume / v_total ELSE NULL END,
                COALESCE(pp.weight_kg,
                         CASE WHEN sol.p_weight IS NOT NULL THEN sol.p_weight / v_total ELSE NULL END),
                true, false, false,
                v_verify_req, auth.uid(), now()
              );
              v_loaded := v_loaded + 1;
            END LOOP;
          END IF;
        END LOOP;
      END LOOP;

      UPDATE delivery_schedules SET physical_state='in_truck', vehicle_id=v_route.vehicle_id, status='loaded', updated_at=now()
       WHERE id=r.schedule_id;
      UPDATE delivery_route_orders SET status='loaded', loaded_at=now() WHERE id=r.route_order_id AND status='planned';
      PERFORM public._m3_log(r.sale_order_id,'delivery.vehicle.loaded.simple',_route_id::text, jsonb_build_object('lines',v_loaded));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'loaded', v_loaded, 'mode', CASE WHEN v_has_docks THEN 'full' ELSE 'simple' END);
END $function$;
