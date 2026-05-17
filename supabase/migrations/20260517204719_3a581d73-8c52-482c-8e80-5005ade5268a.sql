
CREATE OR REPLACE FUNCTION public._test_purchase_need_to_po_flow()
RETURNS TABLE(scenario text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_wh uuid; v_prod uuid; v_var01 uuid; v_var02 uuid;
  v_partner_a uuid; v_partner_b uuid;
  v_need1 uuid; v_need2 uuid; v_need3 uuid;
  v_res jsonb; v_po uuid; v_pol uuid;
  v_pol_qty numeric; v_pol_variant uuid; v_err text; v_already int;
BEGIN
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin IN (SELECT name FROM purchase_orders WHERE origin='purchase_needs' AND partner_id IN (SELECT id FROM partners WHERE name LIKE 'PNTOPO_%')));
  DELETE FROM stock_pickings WHERE origin IN (SELECT name FROM purchase_orders WHERE origin='purchase_needs' AND partner_id IN (SELECT id FROM partners WHERE name LIKE 'PNTOPO_%'));
  DELETE FROM purchase_order_lines WHERE order_id IN (SELECT id FROM purchase_orders WHERE origin='purchase_needs' AND partner_id IN (SELECT id FROM partners WHERE name LIKE 'PNTOPO_%'));
  DELETE FROM purchase_orders WHERE origin='purchase_needs' AND partner_id IN (SELECT id FROM partners WHERE name LIKE 'PNTOPO_%');
  DELETE FROM purchase_needs WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'PNTOPO_%');
  DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE code LIKE 'PNTOPO-%');
  DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE code LIKE 'PNTOPO-%');
  DELETE FROM manufacturing_orders WHERE code LIKE 'PNTOPO-%';
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE 'PNTOPO_%');
  DELETE FROM boms WHERE code LIKE 'PNTOPO_%';
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'PNTOPO_%');
  DELETE FROM product_suppliers WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'PNTOPO_%');
  DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'PNTOPO_%');
  DELETE FROM products WHERE name LIKE 'PNTOPO_%';
  DELETE FROM partners WHERE name LIKE 'PNTOPO_%';

  SELECT id INTO v_wh FROM warehouses WHERE active=true ORDER BY created_at LIMIT 1;
  INSERT INTO partners(name, is_supplier) VALUES ('PNTOPO_SupA', true) RETURNING id INTO v_partner_a;
  INSERT INTO partners(name, is_supplier) VALUES ('PNTOPO_SupB', true) RETURNING id INTO v_partner_b;
  INSERT INTO products(name, type, can_be_purchased, supply_route, active) VALUES ('PNTOPO_Tecido','storable',true,'buy',true) RETURNING id INTO v_prod;
  INSERT INTO product_variants(product_id, sku, active) VALUES (v_prod,'PNTOPO_V01',true) RETURNING id INTO v_var01;
  INSERT INTO product_variants(product_id, sku, active) VALUES (v_prod,'PNTOPO_V02',true) RETURNING id INTO v_var02;
  INSERT INTO product_suppliers(product_id, partner_id, price, priority) VALUES (v_prod, v_partner_a, 5.50, 1);

  INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, state, priority)
    VALUES (v_prod, v_var01, 10, 'manual', v_partner_a, 'pending', 5) RETURNING id INTO v_need1;
  v_res := purchase_needs_create_po(ARRAY[v_need1], NULL, NULL);
  SELECT purchase_order_id, purchase_order_line_id INTO v_po, v_pol FROM purchase_needs WHERE id=v_need1;
  scenario:='01_manual_need_creates_po'; passed:= v_po IS NOT NULL AND v_pol IS NOT NULL; detail:='po='||COALESCE(v_po::text,'NULL'); RETURN NEXT;

  SELECT variant_id, quantity INTO v_pol_variant, v_pol_qty FROM purchase_order_lines WHERE id=v_pol;
  scenario:='02_variant_preserved_on_po_line'; passed:= v_pol_variant=v_var01 AND v_pol_qty=10; detail:='var='||COALESCE(v_pol_variant::text,'NULL')||' qty='||v_pol_qty; RETURN NEXT;

  scenario:='03_need_marked_po_created'; passed:= (SELECT state::text FROM purchase_needs WHERE id=v_need1)='po_created';
  detail:=COALESCE((SELECT state::text FROM purchase_needs WHERE id=v_need1),'?'); RETURN NEXT;

  v_res := purchase_needs_create_po(ARRAY[v_need1], NULL, NULL);
  v_already := COALESCE(jsonb_array_length(v_res->'already_linked'),0);
  scenario:='04_idempotent_already_linked'; passed:= v_already>=1; detail:='already='||v_already; RETURN NEXT;

  scenario:='05_no_duplicate_pol';
  passed:=(SELECT count(*) FROM purchase_order_lines WHERE order_id=v_po AND product_id=v_prod AND variant_id=v_var01)=1;
  detail:='lines='||(SELECT count(*) FROM purchase_order_lines WHERE order_id=v_po); RETURN NEXT;

  INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, state, priority)
    VALUES (v_prod, NULL, 4, 'manual', v_partner_a, 'pending', 1) RETURNING id INTO v_need2;
  BEGIN v_res:=purchase_needs_create_po(ARRAY[v_need2], NULL, NULL); v_err:='no_error';
  EXCEPTION WHEN OTHERS THEN v_err:=SQLERRM; END;
  scenario:='06_variant_required'; passed:= v_err LIKE 'NEED_VARIANT_REQUIRED%'; detail:=v_err;
  DELETE FROM purchase_needs WHERE id=v_need2; RETURN NEXT;

  DECLARE v_prod2 uuid;
  BEGIN
    INSERT INTO products(name, type, can_be_purchased, supply_route, active) VALUES ('PNTOPO_NoSupplier','storable',true,'buy',true) RETURNING id INTO v_prod2;
    INSERT INTO purchase_needs(product_id, qty_needed, origin_kind, state, priority) VALUES (v_prod2, 2, 'manual', 'pending', 1) RETURNING id INTO v_need3;
    BEGIN v_res:=purchase_needs_create_po(ARRAY[v_need3], NULL, NULL); v_err:='no_error';
    EXCEPTION WHEN OTHERS THEN v_err:=SQLERRM; END;
    scenario:='07_needs_supplier_selection'; passed:= v_err LIKE 'NEED_SUPPLIER_SELECTION%'; detail:=v_err;
    DELETE FROM purchase_needs WHERE id=v_need3; DELETE FROM products WHERE id=v_prod2; RETURN NEXT;
  END;

  DECLARE v_n_a uuid; v_n_b uuid; v_distinct_po int;
  BEGIN
    INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, state, priority) VALUES (v_prod, v_var02, 7, 'manual', v_partner_a, 'pending', 1) RETURNING id INTO v_n_a;
    INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, state, priority) VALUES (v_prod, v_var02, 9, 'manual', v_partner_b, 'pending', 1) RETURNING id INTO v_n_b;
    v_res:=purchase_needs_create_po(ARRAY[v_n_a,v_n_b], NULL, NULL);
    SELECT COUNT(DISTINCT purchase_order_id) INTO v_distinct_po FROM purchase_needs WHERE id IN (v_n_a,v_n_b);
    scenario:='08_two_suppliers_two_pos'; passed:= v_distinct_po=2; detail:='distinct_po='||v_distinct_po; RETURN NEXT;
  END;

  DECLARE v_n uuid; v_pol_partner uuid;
  BEGIN
    INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, state, priority) VALUES (v_prod, v_var01, 2, 'manual', v_partner_a, 'pending', 1) RETURNING id INTO v_n;
    v_res:=purchase_needs_create_po(ARRAY[v_n], v_partner_b, NULL);
    SELECT po.partner_id INTO v_pol_partner FROM purchase_needs pn JOIN purchase_orders po ON po.id=pn.purchase_order_id WHERE pn.id=v_n;
    scenario:='09_forced_supplier_overrides_suggested'; passed:= v_pol_partner=v_partner_b; detail:='po_partner='||COALESCE(v_pol_partner::text,'NULL'); RETURN NEXT;
  END;

  DECLARE v_mo uuid; v_n uuid; v_keep_link uuid;
  BEGIN
    INSERT INTO manufacturing_orders(code, product_id, qty, state, warehouse_id, origin) VALUES ('PNTOPO-MO1', v_prod, 1, 'draft', v_wh, 'manual') RETURNING id INTO v_mo;
    INSERT INTO purchase_needs(product_id, product_variant_id, qty_needed, origin_kind, suggested_partner_id, manufacturing_order_id, state, priority)
      VALUES (v_prod, v_var02, 5, 'manufacturing', v_partner_a, v_mo, 'pending', 1) RETURNING id INTO v_n;
    v_res:=purchase_needs_create_po(ARRAY[v_n], NULL, NULL);
    SELECT manufacturing_order_id INTO v_keep_link FROM purchase_needs WHERE id=v_n;
    scenario:='10_mo_link_preserved_on_need'; passed:= v_keep_link=v_mo; detail:='mo_link='||COALESCE(v_keep_link::text,'NULL');
    DELETE FROM manufacturing_orders WHERE id=v_mo; RETURN NEXT;
  END;

  DECLARE
    v_final uuid; v_bom uuid; v_mo uuid;
    v_pn_e2e uuid; v_po_e2e uuid; v_pol_e2e uuid;
    v_picking uuid; v_main_loc uuid; v_move record;
    v_qty_v01 numeric:=0; v_qty_v02 numeric:=0; v_qty_reserved numeric:=0;
    v_sm_variant uuid; v_negative_count int; v_pn_count int; v_po_count int;
  BEGIN
    INSERT INTO products(name, type, can_be_sold, can_be_manufactured, supply_route, active) VALUES ('PNTOPO_Almofada','storable',true,true,'manufacture',true) RETURNING id INTO v_final;
    INSERT INTO boms(product_id, code, type, quantity, active, is_master) VALUES (v_final,'PNTOPO_BOM','normal',1,true,true) RETURNING id INTO v_bom;
    INSERT INTO bom_lines(bom_id, component_product_id, component_variant_id, quantity, sequence) VALUES (v_bom, v_prod, v_var02, 3, 10);
    INSERT INTO manufacturing_orders(code, product_id, bom_id, qty, state, warehouse_id, origin) VALUES ('PNTOPO-MO-E2E', v_final, v_bom, 2, 'draft', v_wh, 'manual') RETURNING id INTO v_mo;
    PERFORM _mfg_materialize_child_components(v_mo);

    v_main_loc := _wh_main_internal_loc(v_wh);
    INSERT INTO stock_quants(product_id, variant_id, location_id, quantity) VALUES (v_prod, v_var01, v_main_loc, 50) ON CONFLICT DO NOTHING;
    v_qty_v01 := _tpntpo_internal_qty(v_prod, v_var01);

    PERFORM mfg_plan_components(v_mo, 0);
    SELECT id INTO v_pn_e2e FROM purchase_needs WHERE manufacturing_order_id=v_mo AND product_id=v_prod LIMIT 1;
    scenario:='11_e2e_need_has_variant02';
    passed:= v_pn_e2e IS NOT NULL AND (SELECT product_variant_id FROM purchase_needs WHERE id=v_pn_e2e)=v_var02;
    detail:='pn='||COALESCE(v_pn_e2e::text,'NULL'); RETURN NEXT;

    UPDATE purchase_needs SET suggested_partner_id=v_partner_a WHERE id=v_pn_e2e;
    v_res:=purchase_needs_create_po(ARRAY[v_pn_e2e], v_partner_a, NULL);
    SELECT purchase_order_id, purchase_order_line_id INTO v_po_e2e, v_pol_e2e FROM purchase_needs WHERE id=v_pn_e2e;
    SELECT variant_id INTO v_pol_variant FROM purchase_order_lines WHERE id=v_pol_e2e;
    scenario:='12_e2e_pol_variant02'; passed:= v_pol_variant=v_var02; detail:='pol_var='||COALESCE(v_pol_variant::text,'NULL'); RETURN NEXT;

    PERFORM confirm_purchase_order(v_po_e2e);
    SELECT id INTO v_picking FROM stock_pickings WHERE origin=(SELECT name FROM purchase_orders WHERE id=v_po_e2e) ORDER BY created_at DESC LIMIT 1;
    SELECT variant_id INTO v_sm_variant FROM stock_moves WHERE picking_id=v_picking AND purchase_order_line_id=v_pol_e2e LIMIT 1;
    scenario:='13_e2e_stock_move_variant02'; passed:= v_sm_variant=v_var02; detail:='sm_var='||COALESCE(v_sm_variant::text,'NULL'); RETURN NEXT;

    scenario:='14_e2e_stock_move_links_need';
    passed:= EXISTS(SELECT 1 FROM stock_moves WHERE picking_id=v_picking AND purchase_order_line_id=v_pol_e2e AND purchase_need_id=v_pn_e2e);
    detail:= CASE WHEN passed THEN 'linked' ELSE 'missing' END; RETURN NEXT;

    UPDATE stock_moves SET quantity_done=quantity WHERE picking_id=v_picking AND state<>'cancelled' AND COALESCE(quantity_done,0)=0;
    PERFORM validate_picking(v_picking);

    v_qty_v02 := _tpntpo_internal_qty(v_prod, v_var02);
    scenario:='15_e2e_stock_quant_variant02'; passed:= v_qty_v02 >= 6; detail:='qty_v02_internal='||v_qty_v02; RETURN NEXT;

    scenario:='16_e2e_variant01_untouched';
    passed:= _tpntpo_internal_qty(v_prod, v_var01) = v_qty_v01;
    detail:='qty_v01_now='||_tpntpo_internal_qty(v_prod, v_var01)||' baseline='||v_qty_v01; RETURN NEXT;

    FOR v_move IN SELECT id FROM stock_moves WHERE picking_id=v_picking AND state='done' LOOP
      PERFORM mfg_reserve_components_on_receipt(v_move.id);
    END LOOP;

    SELECT qty_reserved INTO v_qty_reserved FROM mo_components WHERE mo_id=v_mo AND product_id=v_prod AND variant_id=v_var02 LIMIT 1;
    scenario:='17_e2e_mo_component_reserved_var02'; passed:= COALESCE(v_qty_reserved,0)>=6;
    detail:='qty_reserved='||COALESCE(v_qty_reserved::text,'NULL'); RETURN NEXT;

    scenario:='18_e2e_no_variantless_reserve';
    passed:= NOT EXISTS(SELECT 1 FROM mo_components WHERE mo_id=v_mo AND product_id=v_prod AND variant_id IS NULL AND qty_reserved>0);
    detail:= CASE WHEN passed THEN 'ok' ELSE 'FOUND_VARIANTLESS' END; RETURN NEXT;

    SELECT count(*) INTO v_pn_count FROM purchase_needs WHERE manufacturing_order_id=v_mo AND product_id=v_prod AND product_variant_id=v_var02;
    SELECT count(*) INTO v_po_count FROM purchase_order_lines WHERE order_id=v_po_e2e AND product_id=v_prod AND variant_id=v_var02;
    scenario:='19_e2e_no_duplicates'; passed:= v_pn_count=1 AND v_po_count=1; detail:='pn='||v_pn_count||' pol='||v_po_count; RETURN NEXT;

    v_negative_count := _tpntpo_internal_neg(v_prod);
    scenario:='20_e2e_no_negative_stock'; passed:= v_negative_count=0; detail:='negative_internal='||v_negative_count; RETURN NEXT;
  END;
  RETURN;
END $function$;
