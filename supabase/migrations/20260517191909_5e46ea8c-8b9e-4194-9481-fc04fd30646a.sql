CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid, _qty_produced numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mo record; comp record; loc uuid; produced numeric;
  ratio numeric; consume_qty numeric; remaining numeric; take numeric;
  q record; dst_q record; before_q numeric; before_res numeric;
  total_consumed numeric;
  so_state text; v_case text;
  v_pkg_tracking boolean := false;
  v_tmpl record; v_unit int; v_unit_count int; v_per_unit numeric;
  v_pkg_ref text; v_pkg_status package_status;
  v_so_id uuid; v_sol_id uuid;
  v_tmpl_count int;
  v_payload jsonb;
  v_out record;
  v_out_qty numeric;
  v_out_loc uuid;
  v_out_type product_type;
  v_out_pkg_tracking boolean;
  v_total_pct numeric;
  v_unit_count_o int; v_per_unit_o numeric;
  v_outputs_created int := 0;
  v_parent_comp_id uuid;
  v_parent_mo_id uuid;
  v_new_pkg_id uuid;
  v_first_pkg_id uuid;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('already','done','mo_id',_mo); END IF;
  IF mo.state = 'cancelled' THEN RAISE EXCEPTION 'MO cancelada não pode ser fechada'; END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;

  produced := COALESCE(_qty_produced, mo.qty);
  IF produced <= 0 THEN RAISE EXCEPTION 'qty_produced inválido'; END IF;
  ratio := produced / NULLIF(mo.qty, 0);

  v_parent_comp_id := mo.parent_mo_component_id;
  v_parent_mo_id := mo.parent_mo_id;

  IF v_parent_comp_id IS NOT NULL THEN
    v_case := 'sub_assembly';
  ELSIF mo.sale_order_id IS NULL OR mo.sale_order_line_id IS NULL THEN
    v_case := 'manual';
  ELSE
    SELECT state::text INTO so_state FROM public.sale_orders WHERE id = mo.sale_order_id;
    IF so_state IS NULL OR so_state IN ('cancelled','done','completed') THEN
      v_case := 'sale_cancelled';
    ELSE
      v_case := 'sale_active';
    END IF;
  END IF;

  SELECT COALESCE(package_tracking_enabled,false) INTO v_pkg_tracking
    FROM public.products WHERE id = mo.product_id;

  IF v_pkg_tracking THEN
    SELECT count(*) INTO v_tmpl_count
      FROM public.product_package_templates
     WHERE product_id = mo.product_id AND active = true;
    IF v_tmpl_count = 0 THEN
      RAISE EXCEPTION 'Produto % tem rastreio por embalagens activo sem templates', mo.product_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(cost_allocation_percent),0) INTO v_total_pct
    FROM public.manufacturing_order_outputs
   WHERE manufacturing_order_id = _mo
     AND output_type IN ('co_product','byproduct','reusable_scrap');
  IF v_total_pct > 100 THEN
    RAISE EXCEPTION 'close_mo: soma de cost_allocation_percent dos outputs secundários (%) excede 100', v_total_pct
      USING ERRCODE = '22023';
  END IF;

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    consume_qty := GREATEST(0, ROUND((comp.qty_required * ratio)::numeric, 4) - COALESCE(comp.qty_consumed,0));
    IF consume_qty <= 0 THEN CONTINUE; END IF;
    remaining := consume_qty;
    total_consumed := 0;

    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id
                AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.quantity);
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = quantity - take,
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_res, GREATEST(0, before_res - take),
        'MO', _mo, 'consume',
        'close_mo comp='||comp.id::text||' qty_before='||before_q::text
      );
      remaining := remaining - take;
      total_consumed := total_consumed + take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'Stock físico insuficiente para consumir componente % (faltam %)', comp.product_id, remaining;
    END IF;

    UPDATE public.mo_components
       SET qty_consumed = COALESCE(qty_consumed,0) + total_consumed,
           qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
     WHERE id = comp.id;
  END LOOP;

  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(mo.variant_id::text,'')
     AND location_id = loc
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now()
     WHERE id = dst_q.id;
    before_res := dst_q.reserved_quantity;
  ELSE
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced)
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
    before_res := 0;
  END IF;

  IF v_case = 'sub_assembly' THEN
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + produced,
           updated_at = now()
     WHERE id = dst_q.id
       AND reserved_quantity + produced <= quantity;
    UPDATE public.mo_components
       SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + produced),
           supply_method = 'manufacture'
     WHERE id = v_parent_comp_id;
    v_payload := jsonb_build_object(
      'source','close_mo_subassembly_reserve_for_parent_mo',
      'mo_id', _mo, 'parent_mo_id', v_parent_mo_id,
      'parent_mo_component_id', v_parent_comp_id, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_mo_component_id, to_manufacturing_order_id, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo sub_assembly reserve for parent mo_component',
       v_parent_comp_id, v_parent_mo_id, v_payload);
    PERFORM public.mfg_refresh_component(v_parent_comp_id);
    PERFORM public.mfg_refresh_mo_state(v_parent_mo_id);

  ELSIF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id;
    v_sol_id := mo.sale_order_line_id;
    v_payload := jsonb_build_object(
      'source','close_mo_reserve_finished_for_sale',
      'mo_id', _mo, 'sale_order_id', v_so_id,
      'sale_order_line_id', v_sol_id, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_sale_order_line_id, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo finished_good intent reserve for SO line', v_sol_id, v_payload);
  ELSE
    v_payload := jsonb_build_object(
      'source', CASE WHEN v_case = 'manual' THEN 'close_mo_for_stock'
                     ELSE 'close_mo_cancelled_sale_to_stock' END,
      'mo_id', _mo, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, 0, produced,
       'MO', _mo, 'consume', auth.uid(),
       'close_mo finished_good to free stock', v_payload);
  END IF;

  IF v_pkg_tracking THEN
    v_unit_count := CASE WHEN produced = floor(produced) AND produced >= 1 THEN produced::int ELSE 1 END;
    v_per_unit := produced / v_unit_count;
    v_pkg_status := CASE
      WHEN v_case = 'sale_active'  THEN 'reserved'::package_status
      WHEN v_case = 'sub_assembly' THEN 'reserved'::package_status
      ELSE 'available'::package_status
    END;

    FOR v_unit IN 1..v_unit_count LOOP
      FOR v_tmpl IN
        SELECT * FROM public.product_package_templates
         WHERE product_id = mo.product_id AND active = true
         ORDER BY package_sequence
      LOOP
        v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
        INSERT INTO public.stock_packages
          (product_id, package_template_id,
           sale_order_id, sale_order_line_id, manufacturing_order_id,
           package_ref, package_sequence, package_total, package_group,
           qty, current_location_id, condition, status,
           length_cm, width_cm, height_cm, weight_kg, volume_m3,
           stackable, fragile, requires_flat_transport)
        VALUES
          (mo.product_id, v_tmpl.id,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_id ELSE NULL END,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_line_id ELSE NULL END,
           COALESCE(v_parent_mo_id, _mo),
           v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
           v_per_unit, loc, 'good'::package_condition, v_pkg_status,
           v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
           v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
           v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
        ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  FOR v_out IN
    SELECT * FROM public.manufacturing_order_outputs
     WHERE manufacturing_order_id = _mo
       AND output_type IN ('co_product','byproduct','reusable_scrap','waste')
     ORDER BY created_at FOR UPDATE
  LOOP
    v_out_qty := ROUND((COALESCE(v_out.qty_expected,0) * ratio)::numeric, 4);
    IF v_out_qty <= 0 THEN CONTINUE; END IF;

    IF v_out.output_type = 'waste' THEN
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, NULL, NULL, v_out_qty, 0, 0,
         'MO', _mo, 'consume', auth.uid(), 'close_mo waste (no stock impact)',
         jsonb_build_object('source','close_mo_waste','mo_id',_mo,'output_id',v_out.id,
                            'output_type','waste','qty',v_out_qty));
      UPDATE public.manufacturing_order_outputs SET qty_done = v_out_qty, updated_at = now() WHERE id = v_out.id;
      v_outputs_created := v_outputs_created + 1;
      CONTINUE;
    END IF;

    v_out_loc := COALESCE(v_out.stock_location_id, loc);
    SELECT type, COALESCE(package_tracking_enabled,false) INTO v_out_type, v_out_pkg_tracking
      FROM public.products WHERE id = v_out.product_id;

    IF v_out_type = 'storable' THEN
      SELECT * INTO dst_q FROM public.stock_quants
       WHERE product_id = v_out.product_id AND location_id = v_out_loc AND variant_id IS NULL
       LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity = quantity + v_out_qty, updated_at = now() WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (v_out.product_id, v_out_loc, v_out_qty);
      END IF;
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, v_out_loc, NULL, v_out_qty, 0, v_out_qty,
         'MO', _mo, 'consume', auth.uid(), 'close_mo secondary output to stock',
         jsonb_build_object('source','close_mo_output_to_stock','mo_id',_mo,
                            'output_id',v_out.id,'output_type',v_out.output_type,'qty',v_out_qty));
    END IF;

    v_first_pkg_id := NULL;
    IF v_out_pkg_tracking THEN
      SELECT count(*) INTO v_tmpl_count FROM public.product_package_templates
       WHERE product_id = v_out.product_id AND active = true;
      IF v_tmpl_count > 0 THEN
        v_unit_count_o := CASE WHEN v_out_qty = floor(v_out_qty) AND v_out_qty >= 1 THEN v_out_qty::int ELSE 1 END;
        v_per_unit_o := v_out_qty / v_unit_count_o;
        FOR v_unit IN 1..v_unit_count_o LOOP
          FOR v_tmpl IN
            SELECT * FROM public.product_package_templates
             WHERE product_id = v_out.product_id AND active = true ORDER BY package_sequence
          LOOP
            v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-OUT-' || replace(v_out.id::text,'-','')
                         || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
            v_new_pkg_id := NULL;
            INSERT INTO public.stock_packages
              (product_id, package_template_id, manufacturing_order_id,
               package_ref, package_sequence, package_total, package_group,
               qty, current_location_id, condition, status,
               length_cm, width_cm, height_cm, weight_kg, volume_m3,
               stackable, fragile, requires_flat_transport)
            VALUES
              (v_out.product_id, v_tmpl.id, _mo,
               v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
               v_per_unit_o, v_out_loc, 'good'::package_condition, 'available'::package_status,
               v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
               v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
               v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
            ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING
            RETURNING id INTO v_new_pkg_id;
            IF v_first_pkg_id IS NULL THEN
              IF v_new_pkg_id IS NULL THEN
                SELECT id INTO v_new_pkg_id FROM public.stock_packages WHERE package_ref = v_pkg_ref LIMIT 1;
              END IF;
              v_first_pkg_id := v_new_pkg_id;
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    END IF;

    UPDATE public.manufacturing_order_outputs
       SET qty_done = v_out_qty,
           stock_location_id = v_out_loc,
           created_stock_package_id = COALESCE(created_stock_package_id, v_first_pkg_id),
           updated_at = now()
     WHERE id = v_out.id;
    v_outputs_created := v_outputs_created + 1;
  END LOOP;

  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;

  IF v_case IN ('manual','sale_cancelled') THEN
    BEGIN
      PERFORM public.run_inventory_allocation(
        mo.product_id, mo.variant_id, loc, produced,
        CASE WHEN v_case='manual' THEN 'close_mo_for_stock' ELSE 'close_mo_cancelled_sale' END);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object(
    'mo_id', _mo, 'produced', produced, 'case', v_case,
    'package_tracking', v_pkg_tracking, 'outputs_processed', v_outputs_created,
    'parent_mo_id', v_parent_mo_id, 'parent_mo_component_id', v_parent_comp_id
  );
END $function$;