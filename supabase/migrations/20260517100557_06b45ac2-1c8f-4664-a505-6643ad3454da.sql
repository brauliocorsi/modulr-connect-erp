CREATE OR REPLACE FUNCTION public._test_phase16_c3_component_purchase_reservation()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prefix text := 'TESTE_PHASE16_C3_' || replace(gen_random_uuid()::text,'-','');
  v_uom uuid; v_cat uuid;
  v_supplier uuid; v_customer uuid;
  v_src_loc uuid; v_dst_loc uuid;
  v_comp_A uuid; v_comp_B uuid; v_comp_C uuid; v_comp_D uuid;
  v_finished uuid; v_regular uuid; v_finished2 uuid; v_finished3 uuid;
  v_fin_cd uuid; v_bom_cd uuid;
  v_bom uuid; v_bom2 uuid; v_bom3 uuid;
  v_so uuid; v_sol uuid; v_sol2 uuid; v_so2 uuid; v_sol_amb1 uuid; v_sol_amb2 uuid;
  v_mo uuid; v_mo_amb1 uuid; v_mo_amb2 uuid;
  v_mc_A uuid; v_mc_B uuid; v_mc_amb1 uuid; v_mc_amb2 uuid;
  v_pn_A uuid; v_pn_B uuid; v_pn_amb1 uuid; v_pn_amb2 uuid; v_pn_sol uuid;
  v_po uuid; v_pol_A uuid; v_pol_B uuid; v_pol_amb uuid;
  v_mv uuid; v_mv2 uuid;
  v_res jsonb;
  v_cnt int; v_qty numeric; v_dec numeric;
  v_text text; v_bool boolean;
BEGIN
  SELECT id INTO v_uom FROM product_uom WHERE code='UN' LIMIT 1;
  IF v_uom IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Unidade','UN',1,'unit') RETURNING id INTO v_uom;
  END IF;
  SELECT id INTO v_cat FROM product_categories LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO product_categories(name) VALUES (v_prefix||'_cat') RETURNING id INTO v_cat;
  END IF;
  SELECT id INTO v_src_loc FROM stock_locations WHERE type='supplier' LIMIT 1;
  IF v_src_loc IS NULL THEN
    INSERT INTO stock_locations(name,type) VALUES (v_prefix||'_src','supplier') RETURNING id INTO v_src_loc;
  END IF;
  SELECT id INTO v_dst_loc FROM stock_locations WHERE type='internal' AND name='Stock' LIMIT 1;
  IF v_dst_loc IS NULL THEN
    SELECT id INTO v_dst_loc FROM stock_locations WHERE type='internal' LIMIT 1;
  END IF;
  IF v_dst_loc IS NULL THEN
    INSERT INTO stock_locations(name,type) VALUES (v_prefix||'_dst','internal') RETURNING id INTO v_dst_loc;
  END IF;

  INSERT INTO partners(name, is_supplier) VALUES (v_prefix||'_sup', true) RETURNING id INTO v_supplier;
  INSERT INTO partners(name, is_customer) VALUES (v_prefix||'_cust', true) RETURNING id INTO v_customer;

  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased,component_allocation_policy)
    VALUES (v_prefix||'_compA','storable',v_uom,v_cat,true,'manufacturing_first') RETURNING id INTO v_comp_A;
  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased,component_allocation_policy)
    VALUES (v_prefix||'_compB','storable',v_uom,v_cat,true,'sales_first') RETURNING id INTO v_comp_B;
  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased,component_allocation_policy)
    VALUES (v_prefix||'_compC','storable',v_uom,v_cat,true,'manual') RETURNING id INTO v_comp_C;
  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased,component_allocation_policy)
    VALUES (v_prefix||'_compD','storable',v_uom,v_cat,true,'oldest_need_first') RETURNING id INTO v_comp_D;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_fin','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_finished;
  INSERT INTO products(name,type,uom_id,category_id,can_be_purchased)
    VALUES (v_prefix||'_reg','storable',v_uom,v_cat,true) RETURNING id INTO v_regular;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_fin2','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_finished2;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_fin3','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_finished3;
  INSERT INTO products(name,type,uom_id,category_id,can_be_manufactured,supply_route)
    VALUES (v_prefix||'_finCD','storable',v_uom,v_cat,true,'manufacture') RETURNING id INTO v_fin_cd;

  INSERT INTO boms(code,product_id,type,quantity,uom_id) VALUES (v_prefix||'_B',v_finished,'normal',1,v_uom) RETURNING id INTO v_bom;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom,v_comp_A,1,10,v_uom);
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom,v_comp_B,1,20,v_uom);
  INSERT INTO boms(code,product_id,type,quantity,uom_id) VALUES (v_prefix||'_B2',v_finished2,'normal',1,v_uom) RETURNING id INTO v_bom2;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom2,v_comp_A,1,10,v_uom);
  INSERT INTO boms(code,product_id,type,quantity,uom_id) VALUES (v_prefix||'_B3',v_finished3,'normal',1,v_uom) RETURNING id INTO v_bom3;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom3,v_comp_A,1,10,v_uom);
  -- Register comp_C and comp_D as manufacturing components via a dummy BOM
  INSERT INTO boms(code,product_id,type,quantity,uom_id) VALUES (v_prefix||'_BCD',v_fin_cd,'normal',1,v_uom) RETURNING id INTO v_bom_cd;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom_cd,v_comp_C,1,10,v_uom);
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence,uom_id) VALUES (v_bom_cd,v_comp_D,1,20,v_uom);

  INSERT INTO sale_orders(name,partner_id,state) VALUES (v_prefix||'_SO',v_customer,'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_so,v_finished,4,v_uom,100) RETURNING id INTO v_sol;
  v_mo := mfg_create_mo_for_line(v_so, v_sol);

  SELECT id INTO v_mc_A FROM mo_components WHERE mo_id=v_mo AND product_id=v_comp_A;
  SELECT id INTO v_mc_B FROM mo_components WHERE mo_id=v_mo AND product_id=v_comp_B;

  SELECT id INTO v_pn_A FROM purchase_needs WHERE manufacturing_order_id=v_mo AND product_id=v_comp_A LIMIT 1;
  IF v_pn_A IS NULL THEN
    INSERT INTO purchase_needs(product_id, qty_needed, origin_kind, mo_component_id, manufacturing_order_id, state)
    VALUES (v_comp_A, 4, 'manufacturing', v_mc_A, v_mo, 'pending') RETURNING id INTO v_pn_A;
  ELSE
    UPDATE purchase_needs SET mo_component_id = v_mc_A WHERE id = v_pn_A AND mo_component_id IS NULL;
  END IF;
  SELECT id INTO v_pn_B FROM purchase_needs WHERE manufacturing_order_id=v_mo AND product_id=v_comp_B LIMIT 1;
  IF v_pn_B IS NULL THEN
    INSERT INTO purchase_needs(product_id, qty_needed, origin_kind, mo_component_id, manufacturing_order_id, state)
    VALUES (v_comp_B, 4, 'manufacturing', v_mc_B, v_mo, 'pending') RETURNING id INTO v_pn_B;
  ELSE
    UPDATE purchase_needs SET mo_component_id = v_mc_B WHERE id = v_pn_B AND mo_component_id IS NULL;
  END IF;

  INSERT INTO purchase_orders(name,partner_id,state) VALUES (v_prefix||'_PO',v_supplier,'confirmed') RETURNING id INTO v_po;
  INSERT INTO purchase_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_po,v_comp_A,4,v_uom,10) RETURNING id INTO v_pol_A;
  INSERT INTO purchase_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_po,v_comp_B,4,v_uom,10) RETURNING id INTO v_pol_B;
  INSERT INTO purchase_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_po,v_comp_A,2,v_uom,10) RETURNING id INTO v_pol_amb;
  UPDATE purchase_needs SET purchase_order_line_id = v_pol_B, purchase_order_id = v_po WHERE id = v_pn_B;

  -- 1-8
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 1, NULL, v_pn_A, v_prefix||'_A_p');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '01_direct_need_link_ok'; passed := (v_res->>'ok')::bool AND (v_res->>'reserved')::numeric = 1; detail := v_res::text; RETURN NEXT;
  test_name := '02_direct_route_mo_component'; passed := v_res->>'route' = 'mo_component'; detail := COALESCE(v_res->>'route',''); RETURN NEXT;
  SELECT qty_reserved INTO v_qty FROM mo_components WHERE id = v_mc_A;
  test_name := '03_mo_component_qty_reserved_updated'; passed := v_qty = 1; detail := 'qty='||v_qty; RETURN NEXT;
  SELECT count(*) INTO v_cnt FROM stock_reservation_log WHERE origin_type='MO' AND payload->>'mo_component_id' = v_mc_A::text;
  test_name := '04_log_written_for_mo'; passed := v_cnt >= 1; detail := 'logs='||v_cnt; RETURN NEXT;
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '05_idempotency_same_move'; passed := (v_res->>'ok')::bool AND (v_res->>'skipped')::bool AND v_res->>'reason'='already_processed'; detail := v_res::text; RETURN NEXT;
  SELECT qty_reserved INTO v_qty FROM mo_components WHERE id = v_mc_A;
  test_name := '06_idempotency_no_double_reserve'; passed := v_qty = 1; detail := 'qty='||v_qty; RETURN NEXT;
  v_mv2 := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 2, NULL, v_pn_A, v_prefix||'_A_p2');
  v_res := mfg_reserve_components_on_receipt(v_mv2);
  test_name := '07_partial_reserve_increments'; passed := (v_res->>'ok')::bool AND (v_res->>'reserved')::numeric = 2; detail := v_res::text; RETURN NEXT;
  SELECT qty_reserved INTO v_qty FROM mo_components WHERE id = v_mc_A;
  test_name := '08_partial_qty_reserved_3'; passed := v_qty = 3; detail := 'qty='||v_qty; RETURN NEXT;

  -- 9-14
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_B, v_src_loc, v_dst_loc, 2, v_pol_B, NULL, v_prefix||'_B_p');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '09_pol_unique_resolves_need'; passed := (v_res->>'ok')::bool AND (v_res->>'purchase_need_id') = v_pn_B::text; detail := v_res::text; RETURN NEXT;
  test_name := '10_pol_unique_reserves'; passed := (v_res->>'reserved')::numeric = 2; detail := v_res::text; RETURN NEXT;
  SELECT qty_reserved INTO v_qty FROM mo_components WHERE id = v_mc_B;
  test_name := '11_pol_mo_component_updated'; passed := v_qty = 2; detail := 'qty='||v_qty; RETURN NEXT;
  SELECT count(*) INTO v_cnt FROM stock_reservation_log WHERE (payload->>'purchase_need_id') = v_pn_B::text;
  test_name := '12_pol_log_contains_need_id'; passed := v_cnt >= 1; detail := 'cnt='||v_cnt; RETURN NEXT;
  test_name := '13_pol_route_mo_component'; passed := v_res->>'route' = 'mo_component'; detail := COALESCE(v_res->>'route',''); RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_B, v_src_loc, v_dst_loc, 2, v_pol_B, NULL, v_prefix||'_B_p2');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  SELECT satisfied_at IS NOT NULL INTO v_bool FROM purchase_needs WHERE id = v_pn_B;
  test_name := '14_pol_need_satisfied_marked'; passed := COALESCE(v_bool,false); detail := 'sat='||COALESCE(v_bool::text,'null'); RETURN NEXT;

  -- 15-18 ambiguous
  INSERT INTO sale_orders(name,partner_id,state) VALUES (v_prefix||'_SO2',v_customer,'draft') RETURNING id INTO v_so2;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_so2,v_finished2,1,v_uom,100) RETURNING id INTO v_sol_amb1;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_so2,v_finished3,1,v_uom,100) RETURNING id INTO v_sol_amb2;
  v_mo_amb1 := mfg_create_mo_for_line(v_so2, v_sol_amb1);
  v_mo_amb2 := mfg_create_mo_for_line(v_so2, v_sol_amb2);

  SELECT id INTO v_mc_amb1 FROM mo_components WHERE mo_id=v_mo_amb1 AND product_id=v_comp_A LIMIT 1;
  SELECT id INTO v_mc_amb2 FROM mo_components WHERE mo_id=v_mo_amb2 AND product_id=v_comp_A LIMIT 1;

  SELECT id INTO v_pn_amb1 FROM purchase_needs WHERE manufacturing_order_id=v_mo_amb1 AND product_id=v_comp_A LIMIT 1;
  SELECT id INTO v_pn_amb2 FROM purchase_needs WHERE manufacturing_order_id=v_mo_amb2 AND product_id=v_comp_A LIMIT 1;
  IF v_pn_amb1 IS NULL THEN
    INSERT INTO purchase_needs(product_id,qty_needed,origin_kind,mo_component_id,manufacturing_order_id,state,purchase_order_line_id,purchase_order_id)
    VALUES (v_comp_A,1,'manufacturing',v_mc_amb1,v_mo_amb1,'pending',v_pol_amb,v_po) RETURNING id INTO v_pn_amb1;
  ELSE
    UPDATE purchase_needs SET purchase_order_line_id=v_pol_amb, purchase_order_id=v_po, mo_component_id=COALESCE(mo_component_id,v_mc_amb1) WHERE id=v_pn_amb1;
  END IF;
  IF v_pn_amb2 IS NULL THEN
    INSERT INTO purchase_needs(product_id,qty_needed,origin_kind,mo_component_id,manufacturing_order_id,state,purchase_order_line_id,purchase_order_id)
    VALUES (v_comp_A,1,'manufacturing',v_mc_amb2,v_mo_amb2,'pending',v_pol_amb,v_po) RETURNING id INTO v_pn_amb2;
  ELSE
    UPDATE purchase_needs SET purchase_order_line_id=v_pol_amb, purchase_order_id=v_po, mo_component_id=COALESCE(mo_component_id,v_mc_amb2) WHERE id=v_pn_amb2;
  END IF;

  v_mv := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 1, v_pol_amb, NULL, v_prefix||'_amb');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '15_ambiguous_no_specific_need'; passed := (v_res->>'purchase_need_id') IS NULL; detail := v_res::text; RETURN NEXT;
  test_name := '16_ambiguous_reason'; passed := v_res->>'reason' = 'ambiguous_purchase_need_link'; detail := COALESCE(v_res->>'reason',''); RETURN NEXT;
  test_name := '17_ambiguous_route_to_component_engine'; passed := v_res->>'route' = 'component_allocation_engine'; detail := COALESCE(v_res->>'route',''); RETURN NEXT;
  SELECT count(*) INTO v_cnt FROM purchase_needs WHERE id IN (v_pn_amb1,v_pn_amb2) AND satisfied_by='po_receipt';
  test_name := '18_ambiguous_does_not_satisfy_specific_need'; passed := v_cnt = 0; detail := 'sat='||v_cnt; RETURN NEXT;

  -- 19-22 already satisfied (via mo_component qty_reserved >= qty_required, not via satisfied_at)
  UPDATE mo_components SET qty_reserved = qty_required WHERE id = v_mc_amb1;

  v_mv := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 1, NULL, v_pn_amb1, v_prefix||'_sat');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '19_already_satisfied_reserved_zero'; passed := (v_res->>'ok')::bool AND (v_res->>'reserved')::numeric = 0; detail := v_res::text; RETURN NEXT;
  test_name := '20_already_satisfied_reason'; passed := v_res->>'reason' = 'need_already_satisfied_by_other_source'; detail := COALESCE(v_res->>'reason',''); RETURN NEXT;
  SELECT (fulfillment_payload->>'late_receipt_stock_move_id') = v_mv::text INTO v_bool FROM purchase_needs WHERE id=v_pn_amb1;
  test_name := '21_already_satisfied_late_receipt_logged'; passed := COALESCE(v_bool,false); detail := 'b='||COALESCE(v_bool::text,'null'); RETURN NEXT;
  test_name := '22_already_satisfied_routed_to_engine'; passed := v_res->>'route' = 'component_allocation_engine'; detail := COALESCE(v_res->>'route',''); RETURN NEXT;

  -- 23-28 SOL link
  INSERT INTO sale_order_lines(order_id,product_id,quantity,uom_id,unit_price)
    VALUES (v_so,v_regular,3,v_uom,50) RETURNING id INTO v_sol2;
  INSERT INTO purchase_needs(product_id,qty_needed,origin_kind,sale_order_id,sale_order_line_id,state)
    VALUES (v_regular,3,'sale',v_so,v_sol2,'pending') RETURNING id INTO v_pn_sol;
  v_mv := _test_phase16_c3_make_incoming_done(v_regular, v_src_loc, v_dst_loc, 2, NULL, v_pn_sol, v_prefix||'_sol');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '23_sol_link_ok'; passed := (v_res->>'ok')::bool AND (v_res->>'reserved')::numeric = 2; detail := v_res::text; RETURN NEXT;
  test_name := '24_sol_route_sale_order_line'; passed := v_res->>'route' = 'sale_order_line'; detail := COALESCE(v_res->>'route',''); RETURN NEXT;
  SELECT qty_reserved INTO v_qty FROM sale_order_lines WHERE id = v_sol2;
  test_name := '25_sol_qty_reserved_updated'; passed := v_qty = 2; detail := 'qty='||v_qty; RETURN NEXT;
  SELECT count(*) INTO v_cnt FROM stock_reservation_log WHERE to_sale_order_line_id = v_sol2 AND payload->>'source' = 'mfg_reserve_components_on_receipt';
  test_name := '26_sol_log_to_sale_order_line'; passed := v_cnt >= 1; detail := 'cnt='||v_cnt; RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_regular, v_src_loc, v_dst_loc, 3, NULL, v_pn_sol, v_prefix||'_sol_s');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '27_sol_surplus_reserves_only_remaining'; passed := (v_res->>'reserved')::numeric = 1; detail := v_res::text; RETURN NEXT;
  SELECT satisfied_by INTO v_text FROM purchase_needs WHERE id = v_pn_sol;
  test_name := '28_sol_need_satisfied_on_full'; passed := v_text = 'po_receipt'; detail := 'by='||COALESCE(v_text,'null'); RETURN NEXT;

  -- 29 invalid
  v_res := mfg_reserve_components_on_receipt('00000000-0000-0000-0000-000000000000'::uuid);
  test_name := '29_invalid_move_id'; passed := NOT (v_res->>'ok')::bool AND v_res->>'error' = 'stock_move_not_found'; detail := v_res::text; RETURN NEXT;

  -- 30 non-done move
  DECLARE v_p uuid; v_m uuid;
  BEGIN
    INSERT INTO stock_pickings(name,kind,state,source_location_id,destination_location_id)
      VALUES (v_prefix||'_draft','incoming','draft',v_src_loc,v_dst_loc) RETURNING id INTO v_p;
    INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
      VALUES (v_p,v_comp_A,v_src_loc,v_dst_loc,1,0,'draft') RETURNING id INTO v_m;
    v_res := mfg_reserve_components_on_receipt(v_m);
    test_name := '30_non_done_move_skipped'; passed := (v_res->>'skipped')::bool AND v_res->>'reason' = 'stock_move_not_done'; detail := v_res::text; RETURN NEXT;
  END;

  -- 31 outgoing
  DECLARE v_p uuid; v_m uuid;
  BEGIN
    INSERT INTO stock_pickings(name,kind,state,source_location_id,destination_location_id)
      VALUES (v_prefix||'_out','outgoing','done',v_dst_loc,v_src_loc) RETURNING id INTO v_p;
    INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
      VALUES (v_p,v_comp_A,v_dst_loc,v_src_loc,1,1,'done') RETURNING id INTO v_m;
    v_res := mfg_reserve_components_on_receipt(v_m);
    test_name := '31_outgoing_picking_skipped'; passed := (v_res->>'skipped')::bool AND v_res->>'reason' = 'not_incoming_picking'; detail := v_res::text; RETURN NEXT;
  END;

  -- 32 zero qty
  DECLARE v_p uuid; v_m uuid;
  BEGIN
    INSERT INTO stock_pickings(name,kind,state,source_location_id,destination_location_id)
      VALUES (v_prefix||'_zero','incoming','done',v_src_loc,v_dst_loc) RETURNING id INTO v_p;
    INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
      VALUES (v_p,v_comp_A,v_src_loc,v_dst_loc,0,0,'done') RETURNING id INTO v_m;
    v_res := mfg_reserve_components_on_receipt(v_m);
    test_name := '32_zero_qty_skipped'; passed := (v_res->>'skipped')::bool AND v_res->>'reason' = 'no_quantity_received'; detail := v_res::text; RETURN NEXT;
  END;

  -- 33 guard present
  test_name := '33_null_destination_guard_present';
  passed := EXISTS(SELECT 1 FROM pg_proc WHERE proname='mfg_reserve_components_on_receipt' AND pg_get_functiondef(oid) ILIKE '%no_destination_location%');
  detail := 'guard='||passed::text; RETURN NEXT;

  -- 34 no duplicate logs for v_mv2
  SELECT count(*) INTO v_cnt FROM stock_reservation_log
   WHERE (payload->>'stock_move_id') = v_mv2::text AND action='reserve' AND payload->>'source' = 'mfg_reserve_components_on_receipt';
  test_name := '34_no_duplicate_log_entries'; passed := v_cnt = 1; detail := 'cnt='||v_cnt; RETURN NEXT;

  -- 35-39 replenishment
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 1, NULL, NULL, v_prefix||'_repA');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '35_replenish_component_mfg_first_engine'; passed := v_res->>'route' = 'component_allocation_engine'; detail := v_res::text; RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_B, v_src_loc, v_dst_loc, 1, NULL, NULL, v_prefix||'_repB');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '36_replenish_sales_first_routes_to_sales'; passed := v_res->>'route' = 'sales_then_components'; detail := v_res::text; RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_C, v_src_loc, v_dst_loc, 1, NULL, NULL, v_prefix||'_repC');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '37_replenish_manual_policy_no_allocation'; passed := v_res->>'route' = 'stock_free_manual_policy'; detail := v_res::text; RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_comp_D, v_src_loc, v_dst_loc, 1, NULL, NULL, v_prefix||'_repD');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '38_replenish_oldest_first_to_component_engine'; passed := v_res->>'route' = 'component_allocation_engine'; detail := v_res::text; RETURN NEXT;
  v_mv := _test_phase16_c3_make_incoming_done(v_regular, v_src_loc, v_dst_loc, 1, NULL, NULL, v_prefix||'_repR');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  test_name := '39_replenish_non_component_to_sales_engine'; passed := v_res->>'route' = 'sales_allocation_engine'; detail := v_res::text; RETURN NEXT;

  -- 40-44 invariants
  SELECT count(*) INTO v_cnt FROM stock_quants q JOIN products p ON p.id=q.product_id
   WHERE p.name LIKE v_prefix||'%' AND q.reserved_quantity > q.quantity;
  test_name := '40_invariant_quants_reserved_le_qty'; passed := v_cnt = 0; detail := 'v='||v_cnt; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM mo_components mc JOIN manufacturing_orders mo ON mo.id=mc.mo_id JOIN products p ON p.id=mo.product_id
   WHERE p.name LIKE v_prefix||'%' AND mc.qty_reserved > mc.qty_required;
  test_name := '41_invariant_mo_comp_reserved_le_required'; passed := v_cnt = 0; detail := 'v='||v_cnt; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM sale_order_lines sol JOIN products p ON p.id=sol.product_id
   WHERE p.name LIKE v_prefix||'%' AND COALESCE(sol.qty_reserved,0) > sol.quantity;
  test_name := '42_invariant_sol_reserved_le_qty'; passed := v_cnt = 0; detail := 'v='||v_cnt; RETURN NEXT;

  SELECT COALESCE(MAX(c),0) INTO v_cnt FROM (
    SELECT count(*) AS c FROM stock_reservation_log
    WHERE payload->>'source' = 'mfg_reserve_components_on_receipt'
    GROUP BY payload->>'stock_move_id'
  ) t;
  test_name := '43_invariant_no_duplicate_per_move'; passed := v_cnt <= 1; detail := 'max_per_move='||v_cnt; RETURN NEXT;

  SELECT purchase_need_remaining_qty(v_pn_A) INTO v_dec;
  test_name := '44_remaining_qty_consistent'; passed := v_dec >= 0; detail := 'remaining='||v_dec; RETURN NEXT;

  -- 45-50 non-regression / contract
  test_name := '45_close_mo_signature_unchanged';
  passed := EXISTS(SELECT 1 FROM pg_proc WHERE proname='close_mo' AND pronamespace='public'::regnamespace
     AND pg_get_function_arguments(oid) = '_mo uuid, _qty_produced numeric DEFAULT NULL::numeric');
  detail := 'p='||passed::text; RETURN NEXT;

  test_name := '46_cancel_sale_order_signature_unchanged';
  passed := EXISTS(SELECT 1 FROM pg_proc WHERE proname='cancel_sale_order' AND pronamespace='public'::regnamespace
     AND pg_get_function_arguments(oid) = '_order_id uuid, _options jsonb DEFAULT ''{}''::jsonb');
  detail := 'p='||passed::text; RETURN NEXT;

  test_name := '47_run_inventory_allocation_signature_present';
  passed := EXISTS(SELECT 1 FROM pg_proc WHERE proname='run_inventory_allocation' AND pronamespace='public'::regnamespace
     AND pg_get_function_arguments(oid) ILIKE '_product_id uuid%');
  detail := 'p='||passed::text; RETURN NEXT;

  SELECT count(*) INTO v_cnt FROM stock_reservation_log srl
   WHERE srl.payload->>'mo_component_id' IN (v_mc_A::text, v_mc_B::text)
     AND srl.to_sale_order_line_id IS NOT NULL;
  test_name := '48_mo_component_does_not_leak_to_sale'; passed := v_cnt = 0; detail := 'leaks='||v_cnt; RETURN NEXT;

  v_mv := _test_phase16_c3_make_incoming_done(v_comp_A, v_src_loc, v_dst_loc, 100, NULL, v_pn_A, v_prefix||'_over');
  v_res := mfg_reserve_components_on_receipt(v_mv);
  SELECT qty_reserved, qty_required INTO v_qty, v_dec FROM mo_components WHERE id = v_mc_A;
  test_name := '49_remaining_qty_caps_reservation'; passed := v_qty <= v_dec; detail := 'r='||v_qty||' req='||v_dec; RETURN NEXT;
  test_name := '50_no_over_reservation_on_satisfied_need'; passed := v_qty = v_dec; detail := 'r='||v_qty||' req='||v_dec; RETURN NEXT;

  -- CLEANUP
  BEGIN
    DELETE FROM stock_reservation_log WHERE payload->>'source' = 'mfg_reserve_components_on_receipt'
      AND product_id IN (v_comp_A,v_comp_B,v_comp_C,v_comp_D,v_regular,v_finished,v_finished2,v_finished3,v_fin_cd);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE name LIKE v_prefix||'%' OR origin='F16C3');
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM stock_pickings WHERE name LIKE v_prefix||'%' OR origin='F16C3';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM stock_quants WHERE product_id IN (v_comp_A,v_comp_B,v_comp_C,v_comp_D,v_regular,v_finished,v_finished2,v_finished3,v_fin_cd);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM purchase_needs WHERE product_id IN (v_comp_A,v_comp_B,v_comp_C,v_comp_D,v_regular,v_finished,v_finished2,v_finished3,v_fin_cd);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM purchase_order_lines WHERE order_id = v_po;
    DELETE FROM purchase_orders WHERE id = v_po;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM mo_components WHERE mo_id IN (v_mo,v_mo_amb1,v_mo_amb2);
    DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id IN (v_mo,v_mo_amb1,v_mo_amb2);
    DELETE FROM manufacturing_orders WHERE id IN (v_mo,v_mo_amb1,v_mo_amb2);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM sale_order_lines WHERE order_id IN (v_so,v_so2);
    DELETE FROM sale_orders WHERE id IN (v_so,v_so2);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM bom_lines WHERE bom_id IN (v_bom,v_bom2,v_bom3,v_bom_cd);
    DELETE FROM boms WHERE id IN (v_bom,v_bom2,v_bom3,v_bom_cd);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM products WHERE name LIKE v_prefix||'%';
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    DELETE FROM partners WHERE name LIKE v_prefix||'%';
  EXCEPTION WHEN OTHERS THEN NULL; END;
END
$$;