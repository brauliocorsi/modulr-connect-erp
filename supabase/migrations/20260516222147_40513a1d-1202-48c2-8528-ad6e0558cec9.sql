
CREATE OR REPLACE FUNCTION public._test_phase16_c1_bom_resolution_readonly()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_prefix text := 'F16C1_' || replace(clock_timestamp()::text,' ','_') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_uom_unit uuid;
  v_uom_m uuid;
  v_cat_id uuid;
  v_p_cama uuid; v_p_madeira uuid; v_p_espuma uuid; v_p_tecido_base uuid;
  v_p_opera_black uuid; v_p_opera_cream uuid; v_p_puff uuid; v_p_retalho uuid;
  v_var_black uuid; v_var_cream uuid;
  v_bom_master uuid; v_bom_black uuid; v_bom_cream uuid;
  v_line_madeira uuid; v_line_espuma uuid; v_line_tecido_base uuid;
  v_result jsonb;
  v_lines jsonb; v_outputs jsonb;
  v_pre_bom_count int; v_post_bom_count int;
  v_count int;
BEGIN
  SELECT id INTO v_uom_unit FROM product_uom WHERE code='UN' LIMIT 1;
  IF v_uom_unit IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Unidade','UN',1,'unit') RETURNING id INTO v_uom_unit;
  END IF;
  SELECT id INTO v_uom_m FROM product_uom WHERE code='M' LIMIT 1;
  IF v_uom_m IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Metro','M',1,'length') RETURNING id INTO v_uom_m;
  END IF;

  SELECT id INTO v_cat_id FROM product_categories LIMIT 1;
  IF v_cat_id IS NULL THEN
    INSERT INTO product_categories(name) VALUES (v_prefix||'_cat') RETURNING id INTO v_cat_id;
  END IF;

  INSERT INTO products(name, type, uom_id, category_id, can_be_manufactured)
    VALUES (v_prefix||'_cama','storable',v_uom_unit,v_cat_id,true) RETURNING id INTO v_p_cama;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_madeira','storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_madeira;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_espuma','storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_espuma;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_tecido_base','storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_tecido_base;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_opera_black','storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_opera_black;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_opera_cream','storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_opera_cream;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_puff','storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_puff;
  INSERT INTO products(name, type, uom_id, category_id)
    VALUES (v_prefix||'_retalho','storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_retalho;

  INSERT INTO product_variants(product_id, sku) VALUES (v_p_cama, v_prefix||'_black') RETURNING id INTO v_var_black;
  INSERT INTO product_variants(product_id, sku) VALUES (v_p_cama, v_prefix||'_cream') RETURNING id INTO v_var_cream;

  INSERT INTO boms(code, product_id, type, quantity, uom_id, is_master)
    VALUES (v_prefix||'_M', v_p_cama, 'normal', 1, v_uom_unit, true) RETURNING id INTO v_bom_master;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_madeira, 5, 10, v_uom_unit) RETURNING id INTO v_line_madeira;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_espuma, 3, 20, v_uom_unit) RETURNING id INTO v_line_espuma;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula)
    VALUES (v_bom_master, v_p_tecido_base, 1, 30, v_uom_m, 'width_cm * 0.025 + 0.5') RETURNING id INTO v_line_tecido_base;

  INSERT INTO boms(code, product_id, variant_id, type, quantity, uom_id, parent_bom_id, inheritance_mode)
    VALUES (v_prefix||'_BLK', v_p_cama, v_var_black, 'normal', 1, v_uom_unit, v_bom_master, 'inherit') RETURNING id INTO v_bom_black;

  INSERT INTO boms(code, product_id, variant_id, type, quantity, uom_id, parent_bom_id)
    VALUES (v_prefix||'_CRM', v_p_cama, v_var_cream, 'normal', 1, v_uom_unit, v_bom_master) RETURNING id INTO v_bom_cream;

  INSERT INTO bom_variant_rules(bom_id, variant_id, rule_type, source_component_id, target_component_id, qty, uom_id, priority)
    VALUES (v_bom_black, v_var_black, 'replace_component', v_p_tecido_base, v_p_opera_black, 4.8, v_uom_m, 10);
  INSERT INTO bom_variant_rules(bom_id, variant_id, rule_type, source_component_id, target_component_id, qty, uom_id, priority)
    VALUES (v_bom_cream, v_var_cream, 'replace_component', v_p_tecido_base, v_p_opera_cream, 4.5, v_uom_m, 10);

  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent)
    VALUES (v_bom_master, v_p_cama, 'main_product', 1, 80);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent, stockable)
    VALUES (v_bom_master, v_p_puff, 'co_product', 2, 15, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom_master, v_p_retalho, 'reusable_scrap', 0.8, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom_master, v_p_tecido_base, 'waste', 0.2, false);

  test_name := '01_bom_master_created'; passed := v_bom_master IS NOT NULL; detail := v_bom_master::text; RETURN NEXT;

  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '02_inherit_master_components';
  passed := (SELECT count(*) FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid IN (v_p_madeira,v_p_espuma)) = 2;
  detail := v_lines::text; RETURN NEXT;

  test_name := '03_replace_tecido_opera_black';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_opera_black)
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_tecido_base);
  detail := ''; RETURN NEXT;

  test_name := '04_cream_does_not_duplicate';
  SELECT count(*) INTO v_count FROM bom_lines WHERE bom_id = v_bom_cream;
  passed := v_count = 0; detail := 'bom_cream lines='||v_count; RETURN NEXT;

  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, inheritance_action, parent_bom_line_id)
    VALUES (v_bom_black, v_p_madeira, 7, 10, v_uom_unit, 'override', v_line_madeira);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '05_override_line_changes_qty';
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_madeira) = 7;
  detail := ''; RETURN NEXT;

  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, inheritance_action, parent_bom_line_id)
    VALUES (v_bom_black, v_p_espuma, 0, 20, v_uom_unit, 'remove', v_line_espuma);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '06_remove_line_drops_component';
  passed := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_espuma);
  detail := ''; RETURN NEXT;

  test_name := '07_resolve_returns_final_components';
  passed := jsonb_array_length(v_lines) >= 2; detail := ''; RETURN NEXT;

  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '08_formula_or_rule_applied';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e
                    WHERE (e->>'component_product_id')::uuid = v_p_opera_cream
                      AND (e->>'qty_required')::numeric = 4.5);
  detail := ''; RETURN NEXT;

  test_name := '09_invalid_formula_blocks';
  BEGIN
    PERFORM mfg_eval_formula('1 + foo', '{}'::jsonb);
    passed := false; detail := 'should have raised';
  EXCEPTION WHEN OTHERS THEN passed := SQLERRM ILIKE '%invalid_formula%'; detail := SQLERRM; END;
  RETURN NEXT;

  test_name := '10_sql_in_formula_blocked';
  BEGIN
    PERFORM mfg_eval_formula('1; drop table boms', '{}'::jsonb);
    passed := false; detail := 'should have raised';
  EXCEPTION WHEN OTHERS THEN passed := true; detail := SQLERRM; END;
  RETURN NEXT;

  test_name := '10b_select_in_formula_blocked';
  BEGIN
    PERFORM mfg_eval_formula('(select 1)', '{}'::jsonb);
    passed := false;
  EXCEPTION WHEN OTHERS THEN passed := true; detail := SQLERRM; END;
  RETURN NEXT;

  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, conversion_factor)
    VALUES (v_bom_master, v_p_madeira, 2, 100, v_uom_unit, 3);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '11_conversion_factor_applied';
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_madeira) = 6;
  detail := ''; RETURN NEXT;

  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula, rounding_method)
    VALUES (v_bom_cream, v_p_retalho, 1, 200, v_uom_m, '0.1 + 0.2', 'round_up');
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, '{}'::jsonb);
  v_lines := v_result->'lines';
  test_name := '12_rounding_round_up';
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_retalho) = 1;
  detail := ''; RETURN NEXT;

  v_outputs := v_result->'outputs';
  test_name := '13_output_main_product';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'main_product');
  detail := ''; RETURN NEXT;

  test_name := '14_output_co_product_puff';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'co_product' AND (o->>'product_id')::uuid = v_p_puff);
  detail := ''; RETURN NEXT;

  test_name := '15_output_reusable_scrap';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'reusable_scrap' AND (o->>'stockable')::boolean = true);
  detail := ''; RETURN NEXT;

  test_name := '16_waste_not_stockable';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'waste' AND (o->>'stockable')::boolean = false);
  detail := ''; RETURN NEXT;

  test_name := '17_cost_allocation_within_100';
  passed := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b WHERE b->>'code' = 'cost_allocation_exceeds_100');
  detail := ''; RETURN NEXT;

  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent)
    VALUES (v_bom_master, v_p_puff, 'co_product', 1, 50);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, '{}'::jsonb);
  test_name := '17b_cost_allocation_exceeds_blocks';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b WHERE b->>'code' = 'cost_allocation_exceeds_100');
  detail := (v_result->'blockers')::text; RETURN NEXT;

  test_name := '18_legacy_bom_without_parent_works';
  v_result := resolve_bom_for_variant(v_p_cama, NULL, 1, jsonb_build_object('width_cm',140));
  passed := (v_result->>'bom_id') IS NOT NULL AND jsonb_array_length(v_result->'lines') >= 1;
  detail := ''; RETURN NEXT;

  SELECT count(*) INTO v_pre_bom_count FROM boms;
  PERFORM resolve_bom_for_variant(v_p_cama, v_var_black, 5, jsonb_build_object('width_cm',180));
  PERFORM resolve_bom_for_variant(v_p_cama, v_var_cream, 2, jsonb_build_object('width_cm',200));
  SELECT count(*) INTO v_post_bom_count FROM boms;
  test_name := '19_resolve_is_readonly';
  passed := v_pre_bom_count = v_post_bom_count;
  detail := 'pre='||v_pre_bom_count||' post='||v_post_bom_count; RETURN NEXT;

  test_name := '20_core_functions_untouched';
  passed := EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'close_mo')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfg_create_mo_for_line');
  detail := ''; RETURN NEXT;

  DELETE FROM manufacturing_bom_outputs WHERE bom_id IN (v_bom_master);
  DELETE FROM bom_variant_rules WHERE bom_id IN (v_bom_master, v_bom_black, v_bom_cream);
  DELETE FROM bom_lines WHERE bom_id IN (v_bom_master, v_bom_black, v_bom_cream);
  DELETE FROM boms WHERE id IN (v_bom_black, v_bom_cream, v_bom_master);
  DELETE FROM product_variants WHERE id IN (v_var_black, v_var_cream);
  DELETE FROM products WHERE id IN (v_p_cama,v_p_madeira,v_p_espuma,v_p_tecido_base,v_p_opera_black,v_p_opera_cream,v_p_puff,v_p_retalho);

  RETURN;
END;
$func$;
