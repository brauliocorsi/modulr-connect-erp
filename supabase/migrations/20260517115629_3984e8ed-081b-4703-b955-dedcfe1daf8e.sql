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

  INSERT INTO product_package_templates(product_id, name, package_sequence, package_total, package_group, active)
    VALUES (v_p_pkg_out, v_prefix||'_tmpl', 1, 1, v_prefix||'_grp', true) RETURNING id INTO v_pkg_tmpl;

  INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_p_comp, v_loc, 1000);

  -- MO MANUAL
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

  SELECT quantity INTO v_qty_main FROM stock_quants WHERE product_id=v_p_main AND location_id=v_loc;
  test_name := '01_main_product_in_stock'; passed := COALESCE(v_qty_main,0) = 2;
  detail := 'qty='||COALESCE(v_qty_main::text,'null'); RETURN NEXT;

  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_co AND location_id=v_loc;
  test_name := '02_co_product_in_stock'; passed := COALESCE(v_qty,0) = 1;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_by AND location_id=v_loc;
  test_name := '03_byproduct_in_stock'; passed := COALESCE(v_qty,0) = 2;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  SELECT quantity INTO v_qty FROM stock_quants WHERE product_id=v_p_scrap AND location_id=v_loc;
  test_name := '04_reusable_scrap_in_stock'; passed := COALESCE(v_qty,0) = 1;
  detail := 'qty='||COALESCE(v_qty::text,'null'); RETURN NEXT;

  SELECT COALESCE(SUM(quantity),0) INTO v_qty FROM stock_quants WHERE product_id=v_p_waste;
  test_name := '05_waste_not_in_stock'; passed := v_qty = 0;
  detail := 'qty='||v_qty::text; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM manufacturing_order_outputs
   WHERE manufacturing_order_id=v_mo_manual AND COALESCE(qty_done,0) > 0;
  test_name := '06_outputs_qty_done_set'; passed := v_cnt = 4;
  detail := 'count='||v_cnt; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM stock_reservation_log
   WHERE origin_type='MO' AND origin_id=v_mo_manual
     AND payload->>'source'='close_mo_waste';
  test_name := '07_waste_log_recorded'; passed := v_cnt = 1;
  detail := 'count='||v_cnt; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM stock_reservation_log
   WHERE origin_type='MO' AND origin_id=v_mo_manual
     AND product_id=v_p_main
     AND payload->>'source'='close_mo_for_stock';
  test_name := '08_main_log_for_stock'; passed := v_cnt = 1;
  detail := 'count='||v_cnt; RETURN NEXT;

  SELECT state::text INTO v_err FROM manufacturing_orders WHERE id=v_mo_manual;
  test_name := '09_mo_done'; passed := v_err = 'done'; detail := v_err; RETURN NEXT;

  v_err := (public.close_mo(v_mo_manual, NULL))->>'already';
  test_name := '10_close_mo_idempotent'; passed := v_err = 'done'; detail := COALESCE(v_err,'null'); RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM stock_quants WHERE product_id=v_p_co AND location_id=v_loc;
  test_name := '11_no_duplicate_quants_after_rerun'; passed := v_cnt = 1; detail := 'count='||v_cnt; RETURN NEXT;

  -- MO com package_tracking
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

  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '12_pkg_output_creates_packages'; passed := v_cnt = 2; detail := 'count='||v_cnt; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_co;
  test_name := '13_nopkg_output_no_packages'; passed := v_cnt = 0; detail := 'count='||v_cnt; RETURN NEXT;

  SELECT created_stock_package_id INTO v_out_pkg FROM manufacturing_order_outputs
   WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '14_created_stock_package_id_set'; passed := v_out_pkg IS NOT NULL;
  detail := COALESCE(v_out_pkg::text,'null'); RETURN NEXT;

  PERFORM public.close_mo(v_mo_pkg, NULL);
  SELECT count(*) INTO v_cnt FROM stock_packages WHERE manufacturing_order_id=v_mo_pkg AND product_id=v_p_pkg_out;
  test_name := '15_no_duplicate_packages'; passed := v_cnt = 2; detail := 'count='||v_cnt; RETURN NEXT;

  -- cost_allocation_percent > 100
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

  SELECT state::text INTO v_err FROM manufacturing_orders WHERE id=v_mo_bad;
  test_name := '17_mo_not_done_after_block'; passed := v_err <> 'done'; detail := v_err; RETURN NEXT;

  -- MO legacy sem outputs
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_legacy','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_mo_legacy;
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

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_res FROM stock_quants
   WHERE product_id IN (v_p_co, v_p_by, v_p_scrap);
  test_name := '19_secondary_outputs_reserved_zero'; passed := v_res = 0;
  detail := 'reserved='||v_res::text; RETURN NEXT;

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

DO $$
DECLARE r record; v_fail int := 0; v_pass int := 0; v_msg text := '';
BEGIN
  FOR r IN SELECT * FROM public._test_phase16_c4_close_mo_outputs() LOOP
    IF r.passed THEN v_pass := v_pass + 1;
    ELSE v_fail := v_fail + 1;
      v_msg := v_msg || E'\n  FAIL ' || r.test_name || ' :: ' || COALESCE(r.detail,'');
    END IF;
  END LOOP;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'C.4 suite failed: pass=% fail=% details=%', v_pass, v_fail, v_msg;
  END IF;
  RAISE NOTICE 'C.4 OK pass=% fail=%', v_pass, v_fail;
END $$;