-- ============================================================
-- F16-C.4 — close_mo: processa outputs secundários (co_product,
-- byproduct, reusable_scrap, waste) + embalagens por output
-- ============================================================

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
  -- C.4 vars
  v_out record;
  v_out_qty numeric;
  v_out_loc uuid;
  v_out_type product_type;
  v_out_pkg_tracking boolean;
  v_total_pct numeric;
  v_unit_count_o int; v_per_unit_o numeric;
  v_outputs_created int := 0;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('already', 'done', 'mo_id', _mo); END IF;
  IF mo.state = 'cancelled' THEN RAISE EXCEPTION 'MO cancelada não pode ser fechada'; END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;

  produced := COALESCE(_qty_produced, mo.qty);
  IF produced <= 0 THEN RAISE EXCEPTION 'qty_produced inválido'; END IF;
  ratio := produced / NULLIF(mo.qty, 0);

  IF mo.sale_order_id IS NULL OR mo.sale_order_line_id IS NULL THEN
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
      RAISE EXCEPTION 'Produto % tem rastreio por embalagens activo mas não tem templates activos', mo.product_id;
    END IF;
  END IF;

  -- C.4 PRE-CHECK: cost_allocation_percent dos outputs secundários
  SELECT COALESCE(SUM(cost_allocation_percent),0) INTO v_total_pct
    FROM public.manufacturing_order_outputs
   WHERE manufacturing_order_id = _mo
     AND output_type IN ('co_product','byproduct','reusable_scrap');
  IF v_total_pct > 100 THEN
    RAISE EXCEPTION 'close_mo: soma de cost_allocation_percent dos outputs secundários (%) excede 100', v_total_pct
      USING ERRCODE = '22023';
  END IF;

  -- Consume components
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

  -- Finished good (main_product) — comportamento original
  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(mo.variant_id::text,'')
     AND location_id = loc
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.stock_quants
       SET quantity = quantity + produced, updated_at = now()
     WHERE id = dst_q.id;
    before_res := dst_q.reserved_quantity;
  ELSE
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced);
    before_res := 0;
  END IF;

  IF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id;
    v_sol_id := mo.sale_order_line_id;
    v_payload := jsonb_build_object(
      'source','close_mo_reserve_finished_for_sale',
      'mo_id', _mo,
      'sale_order_id', v_so_id,
      'sale_order_line_id', v_sol_id,
      'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_sale_order_line_id, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo finished_good intent reserve for SO line',
       v_sol_id, v_payload);
  ELSE
    v_payload := jsonb_build_object(
      'source', CASE WHEN v_case = 'manual' THEN 'close_mo_for_stock'
                     ELSE 'close_mo_cancelled_sale_to_stock' END,
      'mo_id', _mo,
      'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, 0, produced,
       'MO', _mo, 'consume', auth.uid(),
       'close_mo finished_good to free stock', v_payload);
  END IF;

  -- Stock packages do produto principal (idempotente)
  IF v_pkg_tracking THEN
    v_unit_count := CASE
      WHEN produced = floor(produced) AND produced >= 1 THEN produced::int
      ELSE 1
    END;
    v_per_unit := produced / v_unit_count;

    v_pkg_status := CASE WHEN v_case = 'sale_active' THEN 'reserved'::package_status
                         ELSE 'available'::package_status END;

    FOR v_unit IN 1..v_unit_count LOOP
      FOR v_tmpl IN
        SELECT * FROM public.product_package_templates
         WHERE product_id = mo.product_id AND active = true
         ORDER BY package_sequence
      LOOP
        v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-T' || v_tmpl.package_sequence::text
                     || '-U' || v_unit::text;
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
           _mo,
           v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
           v_per_unit, loc, 'good'::package_condition, v_pkg_status,
           v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
           v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
           v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
        ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- ============================================================
  -- C.4 — Outputs secundários (co_product / byproduct / reusable_scrap / waste)
  -- ============================================================
  FOR v_out IN
    SELECT * FROM public.manufacturing_order_outputs
     WHERE manufacturing_order_id = _mo
       AND output_type IN ('co_product','byproduct','reusable_scrap','waste')
     ORDER BY created_at
     FOR UPDATE
  LOOP
    v_out_qty := ROUND((COALESCE(v_out.qty_expected,0) * ratio)::numeric, 4);
    IF v_out_qty <= 0 THEN CONTINUE; END IF;

    -- waste: regista log e atualiza qty_done, sem stock
    IF v_out.output_type = 'waste' THEN
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, NULL, NULL, v_out_qty, 0, 0,
         'MO', _mo, 'consume', auth.uid(),
         'close_mo waste (no stock impact)',
         jsonb_build_object(
           'source','close_mo_waste',
           'mo_id', _mo,
           'output_id', v_out.id,
           'output_type','waste',
           'qty', v_out_qty
         ));
      UPDATE public.manufacturing_order_outputs
         SET qty_done = v_out_qty, updated_at = now()
       WHERE id = v_out.id;
      v_outputs_created := v_outputs_created + 1;
      CONTINUE;
    END IF;

    -- resolve location + product type / pkg_tracking
    v_out_loc := COALESCE(v_out.stock_location_id, loc);
    SELECT type, COALESCE(package_tracking_enabled,false)
      INTO v_out_type, v_out_pkg_tracking
      FROM public.products WHERE id = v_out.product_id;

    -- entra em stock apenas se storable
    IF v_out_type = 'storable' THEN
      SELECT * INTO dst_q FROM public.stock_quants
       WHERE product_id = v_out.product_id
         AND location_id = v_out_loc
         AND variant_id IS NULL
       LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_quants
           SET quantity = quantity + v_out_qty, updated_at = now()
         WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, location_id, quantity)
        VALUES (v_out.product_id, v_out_loc, v_out_qty);
      END IF;

      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, v_out_loc, NULL, v_out_qty, 0, v_out_qty,
         'MO', _mo, 'consume', auth.uid(),
         'close_mo secondary output to stock',
         jsonb_build_object(
           'source','close_mo_output_to_stock',
           'mo_id', _mo,
           'output_id', v_out.id,
           'output_type', v_out.output_type,
           'qty', v_out_qty
         ));
    END IF;

    -- embalagens (se rastreio activo e templates existem)
    IF v_out_pkg_tracking THEN
      SELECT count(*) INTO v_tmpl_count
        FROM public.product_package_templates
       WHERE product_id = v_out.product_id AND active = true;
      IF v_tmpl_count > 0 THEN
        v_unit_count_o := CASE
          WHEN v_out_qty = floor(v_out_qty) AND v_out_qty >= 1 THEN v_out_qty::int
          ELSE 1
        END;
        v_per_unit_o := v_out_qty / v_unit_count_o;

        FOR v_unit IN 1..v_unit_count_o LOOP
          FOR v_tmpl IN
            SELECT * FROM public.product_package_templates
             WHERE product_id = v_out.product_id AND active = true
             ORDER BY package_sequence
          LOOP
            v_pkg_ref := 'MO-' || replace(_mo::text,'-','')
                         || '-OUT-' || replace(v_out.id::text,'-','')
                         || '-T' || v_tmpl.package_sequence::text
                         || '-U' || v_unit::text;
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
            ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
          END LOOP;
        END LOOP;

        UPDATE public.manufacturing_order_outputs
           SET created_stock_package_id = (
             SELECT id FROM public.stock_packages
              WHERE manufacturing_order_id = _mo
                AND product_id = v_out.product_id
              ORDER BY created_at LIMIT 1
           )
         WHERE id = v_out.id
           AND created_stock_package_id IS NULL;
      END IF;
    END IF;

    UPDATE public.manufacturing_order_outputs
       SET qty_done = v_out_qty,
           stock_location_id = v_out_loc,
           updated_at = now()
     WHERE id = v_out.id;
    v_outputs_created := v_outputs_created + 1;
  END LOOP;

  -- Mark MO done (fires tg_zz_mo_done_replan → so_run_operational_plan for sale_active)
  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;

  -- Run allocation engine only for free-stock cases
  IF v_case IN ('manual','sale_cancelled') THEN
    BEGIN
      PERFORM public.run_inventory_allocation(
        mo.product_id, mo.variant_id, loc, produced,
        CASE WHEN v_case='manual' THEN 'close_mo_for_stock'
             ELSE 'close_mo_cancelled_sale' END
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'mo_id', _mo,
    'produced', produced,
    'case', v_case,
    'package_tracking', v_pkg_tracking,
    'outputs_processed', v_outputs_created
  );
END $function$;


-- ============================================================
-- _test_phase16_c4_close_mo_outputs
-- ============================================================
CREATE OR REPLACE FUNCTION public._test_phase16_c4_close_mo_outputs()
 RETURNS TABLE(test_name text, passed boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text := 'TESTE_PHASE16_C4_' || replace(gen_random_uuid()::text,'-','');
  v_uom uuid; v_cat uuid; v_wh uuid;
  v_p_main uuid; v_p_co uuid; v_p_by uuid; v_p_scrap uuid; v_p_waste uuid;
  v_p_comp uuid; v_p_pkg_out uuid; v_p_main2 uuid; v_p_main3 uuid;
  v_pkg_tmpl uuid;
  v_mo_manual uuid; v_mo_pkg uuid; v_mo_bad uuid; v_mo_idem uuid; v_mo_legacy uuid;
  v_partner uuid; v_so uuid; v_sol uuid; v_mo_sale uuid;
  v_out_co uuid; v_out_by uuid; v_out_sc uuid; v_out_ws uuid; v_out_pkg uuid;
  v_qty numeric; v_cnt int; v_qty_main numeric; v_res numeric;
  v_err text; v_ok boolean;
  v_loc uuid;
BEGIN
  v_wh := '00000000-0000-0000-0000-000000000010';
  v_loc := public._wh_main_internal_loc(v_wh);

  SELECT id INTO v_uom FROM product_uom WHERE code='UN' LIMIT 1;
  IF v_uom IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Unidade','UN',1,'unit') RETURNING id INTO v_uom;
  END IF;
  SELECT id INTO v_cat FROM product_categories LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO product_categories(name) VALUES (v_prefix||'_cat') RETURNING id INTO v_cat;
  END IF;

  -- Produtos
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_main','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_main;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_main2','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_main2;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_main3','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_main3;
  INSERT INTO products(name,type,uom_id,category_id)
    VALUES (v_prefix||'_co','storable',v_uom,v_cat) RETURNING id INTO v_p_co;
  INSERT INTO products(name,type,uom_id,category_id)
    VALUES (v_prefix||'_by','storable',v_uom,v_cat) RETURNING id INTO v_p_by;
  INSERT INTO products(name,type,uom_id,category_id)
    VALUES (v_prefix||'_sc','storable',v_uom,v_cat) RETURNING id INTO v_p_scrap;
  INSERT INTO products(name,type,uom_id,category_id)
    VALUES (v_prefix||'_ws','consumable',v_uom,v_cat) RETURNING id INTO v_p_waste;
  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased)
    VALUES (v_prefix||'_comp','storable',v_uom,v_cat,true) RETURNING id INTO v_p_comp;
  INSERT INTO products(name,type,uom_id,category_id,package_tracking_enabled)
    VALUES (v_prefix||'_pkgout','storable',v_uom,v_cat,true) RETURNING id INTO v_p_pkg_out;

  INSERT INTO product_package_templates(product_id, package_sequence, package_total, package_group, active)
    VALUES (v_p_pkg_out, 1, 1, v_prefix||'_grp', true) RETURNING id INTO v_pkg_tmpl;

  -- stock inicial componente (suficiente para várias MOs)
  INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_p_comp, v_loc, 1000);

  -- =========================================================
  -- MO MANUAL com outputs: co, by, scrap, waste
  -- =========================================================
  INSERT INTO manufacturing_orders(code, product_id, qty, warehouse_id, state, origin)
    VALUES (v_prefix||'_MO1', v_p_main, 2, v_wh, 'draft', 'manual')
    RETURNING id INTO v_mo_manual;
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence, uom_id)
    VALUES (v_mo_manual, v_p_comp, 1, 10, v_uom);

  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected, cost_allocation_percent)
    VALUES (v_mo_manual, v_p_co, 'co_product', 1, 20) RETURNING id INTO v_out_co;
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected, cost_allocation_percent)
    VALUES (v_mo_manual, v_p_by, 'byproduct', 2, 10) RETURNING id INTO v_out_by;
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected, cost_allocation_percent)
    VALUES (v_mo_manual, v_p_scrap, 'reusable_scrap', 1, 5) RETURNING id INTO v_out_sc;
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected)
    VALUES (v_mo_manual, v_p_waste, 'waste', 3) RETURNING id INTO v_out_ws;

  PERFORM public.close_mo(v_mo_manual, NULL);

  -- 1. main produzido
  SELECT quantity INTO v_qty_main FROM stock_quants WHERE product_id=v_p_main AND location_id=v_loc;
  test_name := '01_main_product_in_stock'; passed := COALESCE(v_qty_main,0) = 2;
  detail := 'qty='||COALESCE(v_qty_main::text,'null'); RETURN NEXT;

  -- 2. co_product em stock (qty_expected=1 * ratio=1 = 1)
  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_co AND location_id=v_loc;
  test_name := '02_co_product_in_stock'; passed := COALESCE(v_qty,0) = 1;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  -- 3. byproduct em stock (2)
  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_by AND location_id=v_loc;
  test_name := '03_byproduct_in_stock'; passed := COALESCE(v_qty,0) = 2;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  -- 4. reusable_scrap em stock (1)
  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_scrap AND location_id=v_loc;
  test_name := '04_reusable_scrap_in_stock'; passed := COALESCE(v_qty,0) = 1;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  -- 5. waste NÃO entra em stock
  SELECT COALESCE(SUM(quantity),0) INTO v_qty FROM stock_quants WHERE product_id=v_p_waste;
  test_name := '05_waste_not_in_stock'; passed := v_qty = 0;
  detail := 'qty='||v_qty::text; RETURN NEXT;

  -- 6. qty_done preenchido nos outputs
  SELECT count(*) INTO v_cnt FROM manufacturing_order_outputs
   WHERE manufacturing_order_id=v_mo_manual AND COALESCE(qty_done,0) > 0;
  test_name := '06_outputs_qty_done_set'; passed := v_cnt = 4;
  detail := 'count='||v_cnt; RETURN NEXT;

  -- 7. waste log existe
  SELECT count(*) INTO v_cnt FROM stock_reservation_log
   WHERE origin_type='MO' AND origin_id=v_mo_manual
     AND payload->>'source'='close_mo_waste';
  test_name := '07_waste_log_recorded'; passed := v_cnt = 1;
  detail := 'count='||v_cnt; RETURN NEXT;

  -- 8. main log do produto principal (case=manual → close_mo_for_stock)
  SELECT count(*) INTO v_cnt FROM stock_reservation_log
   WHERE origin_type='MO' AND origin_id=v_mo_manual
     AND product_id=v_p_main
     AND payload->>'source'='close_mo_for_stock';
  test_name := '08_main_log_for_stock'; passed := v_cnt = 1;
  detail := 'count='||v_cnt; RETURN NEXT;

  -- 9. MO marcada done
  SELECT state::text INTO v_err FROM manufacturing_orders WHERE id=v_mo_manual;
  test_name := '09_mo_done'; passed := v_err = 'done'; detail := v_err; RETURN NEXT;

  -- 10. Idempotência — segunda chamada retorna already
  v_err := (public.close_mo(v_mo_manual, NULL))->>'already';
  test_name := '10_close_mo_idempotent'; passed := v_err = 'done'; detail := COALESCE(v_err,'null'); RETURN NEXT;

  -- 11. Sem duplicação de quants
  SELECT count(*) INTO v_cnt FROM stock_quants WHERE product_id=v_p_co AND location_id=v_loc;
  test_name := '11_no_duplicate_quants_after_rerun'; passed := v_cnt = 1; detail := 'count='||v_cnt; RETURN NEXT;

  -- =========================================================
  -- MO com output de package_tracking
  -- =========================================================
  INSERT INTO manufacturing_orders(code, product_id, qty, warehouse_id, state, origin)
    VALUES (v_prefix||'_MO2', v_p_main2, 1, v_wh, 'draft', 'manual')
    RETURNING id INTO v_mo_pkg;
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence, uom_id)
    VALUES (v_mo_pkg, v_p_comp, 1, 10, v_uom);
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected)
    VALUES (v_mo_pkg, v_p_pkg_out, 'co_product', 2) RETURNING id INTO v_out_pkg;
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected)
    VALUES (v_mo_pkg, v_p_co, 'byproduct', 1);

  PERFORM public.close_mo(v_mo_pkg, NULL);

  -- 12. Output com package_tracking cria stock_packages
  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '12_pkg_output_creates_packages'; passed := v_cnt = 2; detail := 'count='||v_cnt; RETURN NEXT;

  -- 13. Output sem package_tracking NÃO cria packages
  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_co;
  test_name := '13_nopkg_output_no_packages'; passed := v_cnt = 0; detail := 'count='||v_cnt; RETURN NEXT;

  -- 14. created_stock_package_id preenchido no output com pkg
  SELECT created_stock_package_id INTO v_out_pkg FROM manufacturing_order_outputs
   WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '14_created_stock_package_id_set'; passed := v_out_pkg IS NOT NULL;
  detail := COALESCE(v_out_pkg::text,'null'); RETURN NEXT;

  -- 15. Re-fechar não duplica packages (já é no-op via state=done)
  PERFORM public.close_mo(v_mo_pkg, NULL);
  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '15_no_duplicate_packages'; passed := v_cnt = 2; detail := 'count='||v_cnt; RETURN NEXT;

  -- =========================================================
  -- cost_allocation_percent > 100 deve bloquear
  -- =========================================================
  INSERT INTO manufacturing_orders(code, product_id, qty, warehouse_id, state, origin)
    VALUES (v_prefix||'_MO3', v_p_main3, 1, v_wh, 'draft', 'manual')
    RETURNING id INTO v_mo_bad;
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence, uom_id)
    VALUES (v_mo_bad, v_p_comp, 1, 10, v_uom);
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected, cost_allocation_percent)
    VALUES (v_mo_bad, v_p_co, 'co_product', 1, 70);
  INSERT INTO manufacturing_order_outputs(manufacturing_order_id, product_id, output_type, qty_expected, cost_allocation_percent)
    VALUES (v_mo_bad, v_p_by, 'byproduct', 1, 40);

  v_ok := false; v_err := NULL;
  BEGIN
    PERFORM public.close_mo(v_mo_bad, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_err := SQLERRM;
  END;
  test_name := '16_cost_alloc_over_100_blocks'; passed := v_ok AND v_err LIKE '%cost_allocation_percent%';
  detail := COALESCE(v_err,'no error'); RETURN NEXT;

  -- 17. MO bloqueada permanece em draft (não done)
  SELECT state::text INTO v_err FROM manufacturing_orders WHERE id=v_mo_bad;
  test_name := '17_mo_not_done_after_block'; passed := v_err <> 'done'; detail := v_err; RETURN NEXT;

  -- =========================================================
  -- MO legacy SEM manufacturing_order_outputs continua compatível
  -- =========================================================
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_legacy','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_mo_legacy;
  -- reaproveitando var como product_id; criar MO
  INSERT INTO manufacturing_orders(code, product_id, qty, warehouse_id, state, origin)
    VALUES (v_prefix||'_MOL', v_mo_legacy, 1, v_wh, 'draft', 'manual')
    RETURNING id INTO v_mo_idem;
  INSERT INTO mo_components(mo_id, product_id, qty_required, sequence, uom_id)
    VALUES (v_mo_idem, v_p_comp, 1, 10, v_uom);

  v_ok := false;
  BEGIN
    PERFORM public.close_mo(v_mo_idem, NULL);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  test_name := '18_legacy_mo_without_outputs_works'; passed := v_ok; detail := COALESCE(v_err,'ok'); RETURN NEXT;

  -- 19. reserved_quantity dos outputs secundários permanece 0 (regra default)
  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_res FROM stock_quants
   WHERE product_id IN (v_p_co, v_p_by, v_p_scrap);
  test_name := '19_secondary_outputs_reserved_zero'; passed := v_res = 0;
  detail := 'reserved='||v_res::text; RETURN NEXT;

  -- 20. reserved_quantity <= quantity em todos os quants criados pelo run
  SELECT count(*) INTO v_cnt FROM stock_quants
   WHERE product_id IN (v_p_main, v_p_main2, v_p_main3, v_p_co, v_p_by, v_p_scrap, v_p_pkg_out)
     AND reserved_quantity > quantity;
  test_name := '20_invariant_reserved_le_quantity'; passed := v_cnt = 0;
  detail := 'violations='||v_cnt; RETURN NEXT;

  -- CLEANUP
  BEGIN
    DELETE FROM stock_packages WHERE manufacturing_order_id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM stock_reservation_log WHERE origin_type='MO' AND origin_id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM mo_components WHERE mo_id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM mo_operations WHERE mo_id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM manufacturing_orders WHERE id IN (v_mo_manual, v_mo_pkg, v_mo_bad, v_mo_idem);
    DELETE FROM stock_quants WHERE product_id IN (v_p_main, v_p_main2, v_p_main3, v_p_co, v_p_by, v_p_scrap, v_p_waste, v_p_comp, v_p_pkg_out, v_mo_legacy);
    DELETE FROM product_package_templates WHERE product_id = v_p_pkg_out;
    DELETE FROM products WHERE id IN (v_p_main, v_p_main2, v_p_main3, v_p_co, v_p_by, v_p_scrap, v_p_waste, v_p_comp, v_p_pkg_out, v_mo_legacy);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $function$;