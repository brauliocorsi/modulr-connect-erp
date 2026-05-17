
CREATE OR REPLACE FUNCTION public._test_phase16_c2_mo_materialization()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_prefix text := 'F16C2_' || replace(clock_timestamp()::text,' ','_') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_uom uuid; v_cat uuid; v_partner uuid;
  v_p_finished uuid; v_p_comp_a uuid; v_p_comp_b uuid;
  v_p_coproduct uuid; v_p_scrap uuid; v_p_waste uuid;
  v_p_variant_parent uuid; v_p_alt_comp uuid;
  v_p_formula uuid; v_p_bad uuid; v_p_cost_bad uuid;
  v_p_buy uuid; v_p_optional uuid;
  v_var_a uuid; v_var_b uuid;
  v_bom uuid; v_bom_master uuid; v_bom_child_a uuid;
  v_bom_formula uuid; v_bom_bad uuid; v_bom_cost_bad uuid;
  v_bom_opt uuid;
  v_so uuid;
  v_sol uuid; v_sol2 uuid; v_sol3 uuid; v_sol4 uuid; v_sol5 uuid; v_sol_buy uuid; v_sol_opt uuid;
  v_mo uuid; v_mo2 uuid; v_mo3 uuid; v_mo_buy uuid; v_mo_opt uuid;
  v_count int;
  v_qty numeric;
  v_err text;
  v_ok boolean;
BEGIN
  SELECT id INTO v_uom FROM product_uom WHERE code='UN' LIMIT 1;
  IF v_uom IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Unidade','UN',1,'unit') RETURNING id INTO v_uom;
  END IF;
  SELECT id INTO v_cat FROM product_categories LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO product_categories(name) VALUES (v_prefix||'_cat') RETURNING id INTO v_cat;
  END IF;
  INSERT INTO partners(name) VALUES (v_prefix||'_partner') RETURNING id INTO v_partner;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_finished','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_finished;
  INSERT INTO products(name, type, uom_id, category_id, can_be_purchased)
    VALUES (v_prefix||'_cA','storable',v_uom,v_cat,true) RETURNING id INTO v_p_comp_a;
  INSERT INTO products(name, type, uom_id, category_id, can_be_purchased)
    VALUES (v_prefix||'_cB','storable',v_uom,v_cat,true) RETURNING id INTO v_p_comp_b;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_co','storable',v_uom,v_cat) RETURNING id INTO v_p_coproduct;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_sc','storable',v_uom,v_cat) RETURNING id INTO v_p_scrap;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_ws','storable',v_uom,v_cat) RETURNING id INTO v_p_waste;

  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_B', v_p_finished, 'normal', 1, v_uom) RETURNING id INTO v_bom;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom, v_p_comp_a, 2, 10, v_uom);
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom, v_p_comp_b, 3, 20, v_uom);

  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent, stockable)
    VALUES (v_bom, v_p_coproduct, 'co_product', 1, 20, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom, v_p_waste, 'waste', 0.5, false);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom, v_p_scrap, 'reusable_scrap', 0.3, true);

  INSERT INTO sale_orders(name, partner_id, state)
    VALUES (v_prefix||'_SO', v_partner, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_finished, 4, v_uom, 100) RETURNING id INTO v_sol;

  v_mo := mfg_create_mo_for_line(v_so, v_sol);
  test_name := '01_legacy_bom_creates_mo'; passed := v_mo IS NOT NULL; detail := COALESCE(v_mo::text,'NULL'); RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo;
  test_name := '02_components_materialized'; passed := v_count = 2; detail := 'count='||v_count; RETURN NEXT;

  SELECT qty_required INTO v_qty FROM mo_components WHERE mo_id = v_mo AND product_id = v_p_comp_a;
  test_name := '03_qty_scaled_by_sol_qty'; passed := v_qty = 8; detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo AND bom_line_id IS NOT NULL;
  test_name := '04_bom_line_id_filled'; passed := v_count = 2; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_order_outputs WHERE manufacturing_order_id = v_mo;
  test_name := '05_outputs_materialized'; passed := v_count = 4; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_order_outputs
   WHERE manufacturing_order_id = v_mo AND output_type='main_product' AND product_id=v_p_finished;
  test_name := '06_main_product_synthesized'; passed := v_count = 1; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_order_outputs WHERE manufacturing_order_id = v_mo AND output_type='waste';
  test_name := '07_waste_output_present'; passed := v_count = 1; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_order_outputs WHERE manufacturing_order_id = v_mo AND output_type='reusable_scrap';
  test_name := '08_reusable_scrap_output'; passed := v_count = 1; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM purchase_needs WHERE manufacturing_order_id = v_mo;
  test_name := '09_purchase_needs_created'; passed := v_count >= 2; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM purchase_needs
   WHERE manufacturing_order_id = v_mo AND product_id = v_p_finished;
  test_name := '10_no_purchase_need_for_finished'; passed := v_count = 0; detail := 'count='||v_count; RETURN NEXT;

  PERFORM mfg_create_mo_for_line(v_so, v_sol);
  PERFORM mfg_create_mo_for_line(v_so, v_sol);
  SELECT count(*) INTO v_count FROM manufacturing_orders WHERE sale_order_line_id = v_sol;
  test_name := '11_idempotency_single_mo'; passed := v_count = 1; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo;
  test_name := '12_idempotency_components'; passed := v_count = 2; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_order_outputs WHERE manufacturing_order_id = v_mo;
  test_name := '13_idempotency_outputs'; passed := v_count = 4; detail := 'count='||v_count; RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_vp','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_variant_parent;
  INSERT INTO products(name, type, uom_id, category_id, can_be_purchased)
    VALUES (v_prefix||'_alt','storable',v_uom,v_cat,true) RETURNING id INTO v_p_alt_comp;
  INSERT INTO product_variants(product_id, sku) VALUES (v_p_variant_parent, v_prefix||'_vA') RETURNING id INTO v_var_a;
  INSERT INTO product_variants(product_id, sku) VALUES (v_p_variant_parent, v_prefix||'_vB') RETURNING id INTO v_var_b;

  INSERT INTO boms(code, product_id, type, quantity, uom_id, is_master)
    VALUES (v_prefix||'_M', v_p_variant_parent, 'normal', 1, v_uom, true) RETURNING id INTO v_bom_master;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_comp_a, 5, 10, v_uom);
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_comp_b, 2, 20, v_uom);
  INSERT INTO boms(code, product_id, variant_id, type, quantity, uom_id, parent_bom_id, inheritance_mode)
    VALUES (v_prefix||'_CA', v_p_variant_parent, v_var_a, 'normal', 1, v_uom, v_bom_master, 'inherit')
    RETURNING id INTO v_bom_child_a;
  INSERT INTO bom_variant_rules(bom_id, variant_id, rule_type, source_component_id, target_component_id, qty, uom_id, priority)
    VALUES (v_bom_child_a, v_var_a, 'replace_component', v_p_comp_a, v_p_alt_comp, 7, v_uom, 10);

  INSERT INTO sale_order_lines(order_id, product_id, variant_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_variant_parent, v_var_a, 1, v_uom, 100) RETURNING id INTO v_sol2;
  v_mo2 := mfg_create_mo_for_line(v_so, v_sol2);
  test_name := '14_variant_mo_created'; passed := v_mo2 IS NOT NULL; detail := COALESCE(v_mo2::text,'NULL'); RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo2 AND product_id = v_p_comp_b;
  test_name := '15_inherits_from_master'; passed := v_count = 1; detail := 'cb='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo2 AND product_id = v_p_alt_comp;
  test_name := '16_variant_rule_replace_added_alt'; passed := v_count = 1; detail := 'alt='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo2 AND product_id = v_p_comp_a;
  test_name := '17_variant_rule_replace_removed_original'; passed := v_count = 0; detail := 'ca='||v_count; RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_ff','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_formula;
  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_FF', v_p_formula, 'normal', 1, v_uom) RETURNING id INTO v_bom_formula;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula)
    VALUES (v_bom_formula, v_p_comp_a, 1, 10, v_uom, '2 + 3');
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_formula, 2, v_uom, 50) RETURNING id INTO v_sol3;
  v_mo3 := mfg_create_mo_for_line(v_so, v_sol3);
  SELECT qty_required INTO v_qty FROM mo_components WHERE mo_id = v_mo3 AND product_id = v_p_comp_a;
  test_name := '18_formula_evaluates'; passed := v_qty = 10; detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_bad','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_bad;
  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_BAD', v_p_bad, 'normal', 1, v_uom) RETURNING id INTO v_bom_bad;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula)
    VALUES (v_bom_bad, v_p_comp_a, 1, 10, v_uom, 'invalid_token + )))');
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_bad, 1, v_uom, 50) RETURNING id INTO v_sol4;
  v_ok := false;
  BEGIN
    PERFORM mfg_create_mo_for_line(v_so, v_sol4);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_err := SQLERRM;
  END;
  test_name := '19_invalid_formula_blocks';
  passed := v_ok AND (v_err ILIKE '%blocker%' OR v_err ILIKE '%formula%' OR v_err ILIKE '%invalid%');
  detail := COALESCE(v_err,''); RETURN NEXT;

  SELECT count(*) INTO v_count FROM manufacturing_orders WHERE sale_order_line_id = v_sol4;
  test_name := '20_blocked_mo_not_created'; passed := v_count = 0; detail := 'count='||v_count; RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_cb','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_cost_bad;
  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_CB', v_p_cost_bad, 'normal', 1, v_uom) RETURNING id INTO v_bom_cost_bad;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_cost_bad, v_p_comp_a, 1, 10, v_uom);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent, stockable)
    VALUES (v_bom_cost_bad, v_p_coproduct, 'co_product', 1, 80, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent, stockable)
    VALUES (v_bom_cost_bad, v_p_scrap, 'co_product', 1, 50, true);
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_cost_bad, 1, v_uom, 10) RETURNING id INTO v_sol5;
  v_ok := false;
  BEGIN
    PERFORM mfg_create_mo_for_line(v_so, v_sol5);
  EXCEPTION WHEN OTHERS THEN
    v_ok := true; v_err := SQLERRM;
  END;
  test_name := '21_cost_allocation_over_100_blocks';
  passed := v_ok AND v_err ILIKE '%cost_allocation%';
  detail := COALESCE(v_err,''); RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, can_be_purchased, supply_route)
    VALUES (v_prefix||'_buy','storable',v_uom,v_cat,true,true,'buy') RETURNING id INTO v_p_buy;
  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_BUY', v_p_buy, 'normal', 1, v_uom);
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_buy, 1, v_uom, 10) RETURNING id INTO v_sol_buy;
  v_mo_buy := mfg_create_mo_for_line(v_so, v_sol_buy);
  test_name := '22_buy_route_no_mo'; passed := v_mo_buy IS NULL; detail := COALESCE(v_mo_buy::text,'NULL'); RETURN NEXT;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured, supply_route)
    VALUES (v_prefix||'_opt','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_p_optional;
  INSERT INTO boms(code, product_id, type, quantity, uom_id)
    VALUES (v_prefix||'_OPT', v_p_optional, 'normal', 1, v_uom) RETURNING id INTO v_bom_opt;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_opt, v_p_comp_a, 1, 10, v_uom);
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, is_optional)
    VALUES (v_bom_opt, v_p_comp_b, 1, 20, v_uom, true);
  INSERT INTO sale_order_lines(order_id, product_id, quantity, uom_id, unit_price)
    VALUES (v_so, v_p_optional, 1, v_uom, 10) RETURNING id INTO v_sol_opt;
  v_mo_opt := mfg_create_mo_for_line(v_so, v_sol_opt);
  SELECT count(*) INTO v_count FROM mo_components WHERE mo_id = v_mo_opt;
  test_name := '23_optional_skipped_by_default'; passed := v_count = 1; detail := 'count='||v_count; RETURN NEXT;

  SELECT count(*) INTO v_count FROM mo_components
   WHERE mo_id IN (v_mo, v_mo2, v_mo3, v_mo_opt) AND qty_reserved > qty_required;
  test_name := '24_reserved_never_exceeds_required'; passed := v_count = 0; detail := 'violations='||v_count; RETURN NEXT;

  -- Stock negativo escopo do teste: nenhum produto criado por este teste deve ter stock negativo
  SELECT count(*) INTO v_count FROM stock_quants sq
   JOIN products p ON p.id = sq.product_id
   WHERE p.name LIKE v_prefix||'%' AND sq.quantity < 0;
  test_name := '25_no_negative_stock_in_test_products'; passed := v_count = 0; detail := 'neg='||v_count; RETURN NEXT;

END
$func$;
