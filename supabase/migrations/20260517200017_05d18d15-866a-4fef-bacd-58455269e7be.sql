
CREATE OR REPLACE FUNCTION public._test_phase16_component_variant_flow()
 RETURNS TABLE(scenario text, passed boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wh uuid; v_loc uuid;
  v_tecido uuid; v_almof uuid;
  v_var01 uuid; v_var02 uuid;
  v_bom_almof uuid;
  v_mo uuid;
  v_resolved jsonb;
  v_line jsonb;
  v_comp_v01 numeric; v_comp_v02 numeric;
  v_qty_reserved numeric;
  v_pn_count int; v_pn_variant uuid;
  v_q01_qty numeric; v_q02_qty numeric;
  v_partner uuid; v_two_lines_count int;
  v_almof2 uuid; v_bom_almof2 uuid;
BEGIN
  -- cleanup
  DELETE FROM stock_reservation_log WHERE notes LIKE '%T16HVR%' OR payload::text LIKE '%T16HVR%';
  DELETE FROM purchase_needs WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE 'T16HVR_%');
  DELETE FROM boms WHERE code LIKE 'T16HVR_%';
  DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM products WHERE name LIKE 'T16HVR_%';

  SELECT id INTO v_wh FROM warehouses WHERE active=true ORDER BY created_at LIMIT 1;
  v_loc := _wh_main_internal_loc(v_wh);

  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
    VALUES ('T16HVR_Tecido_Opera','storable',true,false,'buy',true) RETURNING id INTO v_tecido;
  INSERT INTO product_variants(product_id, sku, active) VALUES (v_tecido, 'T16HVR_OPERA_01', true) RETURNING id INTO v_var01;
  INSERT INTO product_variants(product_id, sku, active) VALUES (v_tecido, 'T16HVR_OPERA_02', true) RETURNING id INTO v_var02;

  INSERT INTO products(name, type, can_be_sold, can_be_manufactured, supply_route, active)
    VALUES ('T16HVR_Almofada','storable',true,true,'manufacture',true) RETURNING id INTO v_almof;

  INSERT INTO boms(product_id, code, type, quantity, active, is_master)
    VALUES (v_almof,'T16HVR_BOM_ALMOF','normal',1,true,true) RETURNING id INTO v_bom_almof;
  INSERT INTO bom_lines(bom_id, component_product_id, component_variant_id, quantity, sequence)
    VALUES (v_bom_almof, v_tecido, v_var02, 3, 10);

  -- SC1: resolver returns variant
  BEGIN
    v_resolved := resolve_bom_for_variant(v_almof, NULL, 1, '{}'::jsonb);
    SELECT (l->>'component_variant_id')::uuid INTO v_pn_variant
      FROM jsonb_array_elements(v_resolved->'lines') l
     WHERE (l->>'component_product_id')::uuid = v_tecido LIMIT 1;
    scenario := '1_resolver_returns_variant';
    passed := v_pn_variant = v_var02;
    detail := COALESCE(v_pn_variant::text,'NULL');
    RETURN NEXT;
  END;

  -- SC2: resolver keeps two lines (same product, different variants)
  BEGIN
    INSERT INTO products(name, type, can_be_sold, can_be_manufactured, supply_route, active)
      VALUES ('T16HVR_Almofada2','storable',true,true,'manufacture',true) RETURNING id INTO v_almof2;
    INSERT INTO boms(product_id, code, type, quantity, active, is_master)
      VALUES (v_almof2,'T16HVR_BOM_ALMOF2','normal',1,true,true) RETURNING id INTO v_bom_almof2;
    INSERT INTO bom_lines(bom_id, component_product_id, component_variant_id, quantity, sequence)
      VALUES (v_bom_almof2, v_tecido, v_var01, 2, 10),
             (v_bom_almof2, v_tecido, v_var02, 4, 20);
    v_resolved := resolve_bom_for_variant(v_almof2, NULL, 1, '{}'::jsonb);
    SELECT count(*) INTO v_two_lines_count
      FROM jsonb_array_elements(v_resolved->'lines') l
     WHERE (l->>'component_product_id')::uuid = v_tecido;
    scenario := '2_resolver_two_variants_not_collapsed';
    passed := v_two_lines_count = 2;
    detail := 'lines_count='||v_two_lines_count;
    RETURN NEXT;
  END;

  -- SC3: MO materialization preserves variant
  BEGIN
    INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, state, warehouse_id, origin)
      VALUES ('T16HVR-MO1', v_almof, v_bom_almof, 2, 'draft', v_wh, 'manual')
      RETURNING id INTO v_mo;
    PERFORM _mfg_materialize_child_components(v_mo);
    SELECT variant_id INTO v_pn_variant FROM mo_components WHERE mo_id=v_mo AND product_id=v_tecido;
    scenario := '3_mo_components_variant_preserved';
    passed := v_pn_variant = v_var02;
    detail := COALESCE(v_pn_variant::text,'NULL');
    RETURN NEXT;
  END;

  -- SC4: plan_components creates purchase_need with product_variant_id
  BEGIN
    PERFORM mfg_plan_components(v_mo, 0);
    SELECT count(*), max(product_variant_id) INTO v_pn_count, v_pn_variant
      FROM purchase_needs
     WHERE manufacturing_order_id = v_mo AND product_id = v_tecido;
    scenario := '4_purchase_need_has_variant';
    passed := v_pn_count >= 1 AND v_pn_variant = v_var02;
    detail := 'count='||v_pn_count||' variant='||COALESCE(v_pn_variant::text,'NULL');
    RETURN NEXT;
  END;

  -- SC5: stock of wrong variant must NOT be reserved
  BEGIN
    -- create stock of variant 01 only — should NOT satisfy need for variant 02
    INSERT INTO stock_quants(product_id, variant_id, location_id, quantity)
      VALUES (v_tecido, v_var01, v_loc, 100);
    -- reset MO to allow re-plan
    UPDATE mo_components SET qty_reserved=0, qty_to_purchase=0, supply_method=NULL
      WHERE mo_id=v_mo AND product_id=v_tecido;
    DELETE FROM purchase_needs WHERE manufacturing_order_id=v_mo;
    PERFORM mfg_plan_components(v_mo, 0);
    SELECT qty_reserved INTO v_qty_reserved FROM mo_components WHERE mo_id=v_mo AND product_id=v_tecido;
    scenario := '5_wrong_variant_stock_not_used';
    passed := COALESCE(v_qty_reserved,0) = 0;
    detail := 'qty_reserved='||COALESCE(v_qty_reserved::text,'NULL');
    RETURN NEXT;
  END;

  -- SC6: stock of correct variant IS reserved
  BEGIN
    INSERT INTO stock_quants(product_id, variant_id, location_id, quantity)
      VALUES (v_tecido, v_var02, v_loc, 100);
    UPDATE mo_components SET qty_reserved=0, qty_to_purchase=0, supply_method=NULL
      WHERE mo_id=v_mo AND product_id=v_tecido;
    DELETE FROM purchase_needs WHERE manufacturing_order_id=v_mo;
    PERFORM mfg_plan_components(v_mo, 0);
    SELECT qty_reserved INTO v_qty_reserved FROM mo_components WHERE mo_id=v_mo AND product_id=v_tecido;
    scenario := '6_correct_variant_stock_reserved';
    passed := COALESCE(v_qty_reserved,0) >= 6;  -- qty=2 * 3 per BOM
    detail := 'qty_reserved='||COALESCE(v_qty_reserved::text,'NULL');
    RETURN NEXT;
  END;

  -- SC7: close_mo consumes only variant 02 stock
  BEGIN
    -- drop pending operations to allow close (legacy path)
    DELETE FROM mo_operations WHERE mo_id=v_mo;
    PERFORM close_mo(v_mo, 2);
    SELECT quantity INTO v_q01_qty FROM stock_quants WHERE product_id=v_tecido AND variant_id=v_var01 AND location_id=v_loc;
    SELECT quantity INTO v_q02_qty FROM stock_quants WHERE product_id=v_tecido AND variant_id=v_var02 AND location_id=v_loc;
    scenario := '7_close_mo_consumed_correct_variant';
    passed := v_q01_qty = 100 AND v_q02_qty = 94;  -- variant 01 untouched, variant 02 -6
    detail := 'var01='||v_q01_qty||' var02='||v_q02_qty;
    RETURN NEXT;
  END;

  -- SC8: dedup respects variant (two needs for same product, different variants coexist)
  BEGIN
    INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, state)
      VALUES (v_tecido, v_var01, 5, 'manual', 'pending');
    -- second one with different variant should NOT be skipped by create_purchase_need dedup
    v_pn_variant := create_purchase_need(v_tecido, 5, 'manual'::purchase_need_origin,
      NULL, NULL, NULL, 'T16HVR dedup test', v_var02);
    SELECT count(*) INTO v_pn_count FROM purchase_needs
      WHERE product_id=v_tecido AND origin_kind='manual'
        AND product_variant_id IN (v_var01, v_var02);
    scenario := '8_create_purchase_need_dedup_per_variant';
    passed := v_pn_count = 2;
    detail := 'count='||v_pn_count;
    RETURN NEXT;
  END;

  -- final cleanup
  DELETE FROM stock_reservation_log WHERE notes LIKE '%T16HVR%' OR payload::text LIKE '%T16HVR%';
  DELETE FROM purchase_needs WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%'));
  DELETE FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE 'T16HVR_%');
  DELETE FROM boms WHERE code LIKE 'T16HVR_%';
  DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16HVR_%');
  DELETE FROM products WHERE name LIKE 'T16HVR_%';
END $function$;
