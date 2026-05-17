CREATE OR REPLACE FUNCTION public._test_phase16_multilevel_bom_subassembly()
RETURNS TABLE(scenario text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wh uuid; v_loc uuid;
  v_cama uuid; v_estrut uuid; v_ripa uuid; v_trav uuid; v_paraf uuid;
  v_tecido uuid; v_espuma uuid; v_ferrag uuid;
  v_bom_cama uuid; v_bom_estrut uuid;
  v_partner uuid;
  v_so uuid; v_sol uuid;
  v_mo_mae uuid; v_mo_filha uuid;
  v_qty_reserved numeric; v_qty_in_stock numeric;
  v_pn_count int;
  v_total int := 0; v_ok int := 0;
  v_intent_count int;
  v_sol_reserved numeric;
  v_so2 uuid; v_sol2 uuid;
  v_q_qty numeric; v_q_res numeric;
BEGIN
  DELETE FROM stock_reservation_log WHERE notes LIKE '%T16C5%' OR payload::text LIKE '%T16C5%';
  DELETE FROM purchase_needs WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%');
  DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%'));
  DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%'));
  DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%'));
  DELETE FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%');
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE 'T16C5_%');
  DELETE FROM stock_pickings WHERE origin LIKE 'T16C5_%';
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%');
  DELETE FROM sale_order_lines WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'T16C5_%');
  DELETE FROM sale_orders WHERE name LIKE 'T16C5_%';
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE 'T16C5_%');
  DELETE FROM boms WHERE code LIKE 'T16C5_%';
  DELETE FROM products WHERE name LIKE 'T16C5_%';

  SELECT id INTO v_wh FROM warehouses WHERE active=true ORDER BY created_at LIMIT 1;
  v_loc := _wh_main_internal_loc(v_wh);
  SELECT id INTO v_partner FROM partners WHERE is_customer=true AND active=true LIMIT 1;

  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Ripa','storable',true,false,'buy',true) RETURNING id INTO v_ripa;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Travessa','storable',true,false,'buy',true) RETURNING id INTO v_trav;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Parafuso','storable',true,false,'buy',true) RETURNING id INTO v_paraf;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Tecido','storable',true,false,'buy',true) RETURNING id INTO v_tecido;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Espuma','storable',true,false,'buy',true) RETURNING id INTO v_espuma;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Ferragens','storable',true,false,'buy',true) RETURNING id INTO v_ferrag;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active) VALUES ('T16C5_Estrutura','storable',false,true,'manufacture',true) RETURNING id INTO v_estrut;
  INSERT INTO products(name, type, can_be_sold, can_be_manufactured, supply_route, active) VALUES ('T16C5_Cama','storable',true,true,'manufacture',true) RETURNING id INTO v_cama;

  INSERT INTO boms(product_id, code, type, quantity, active, is_master) VALUES (v_cama,'T16C5_BOM_CAMA','normal',1,true,true) RETURNING id INTO v_bom_cama;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES
    (v_bom_cama, v_estrut, 1, 10),(v_bom_cama, v_tecido, 5, 20),(v_bom_cama, v_espuma, 2, 30),(v_bom_cama, v_ferrag, 4, 40);
  INSERT INTO boms(product_id, code, type, quantity, active, is_master) VALUES (v_estrut,'T16C5_BOM_ESTRUT','normal',1,true,true) RETURNING id INTO v_bom_estrut;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES
    (v_bom_estrut, v_ripa, 6, 10),(v_bom_estrut, v_trav, 2, 20),(v_bom_estrut, v_paraf, 20, 30);

  BEGIN
    v_total := v_total + 1;
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_estrut, v_loc, 1);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_tecido, v_loc, 100);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_espuma, v_loc, 100);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_ferrag, v_loc, 100);
    INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
    VALUES ('T16C5_SO_A_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
    VALUES (v_so, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol;
    v_mo_mae := mfg_create_mo_for_line(v_so, v_sol);
    SELECT mc.qty_reserved INTO v_qty_reserved FROM mo_components mc WHERE mc.mo_id=v_mo_mae AND mc.product_id=v_estrut;
    IF v_qty_reserved >= 1
       AND NOT EXISTS (SELECT 1 FROM manufacturing_orders WHERE parent_mo_id=v_mo_mae AND product_id=v_estrut)
       AND NOT EXISTS (SELECT 1 FROM purchase_needs WHERE manufacturing_order_id=v_mo_mae AND product_id=v_estrut)
    THEN v_ok := v_ok + 1; scenario:='A_submontagem_stock'; passed:=true; detail:='reservou Estrutura'; RETURN NEXT;
    ELSE scenario:='A_submontagem_stock'; passed:=false; detail:=format('qty_reserved=%s', v_qty_reserved); RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='A_submontagem_stock'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  BEGIN
    v_total := v_total + 1;
    DELETE FROM stock_quants WHERE product_id=v_estrut;
    INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
    VALUES ('T16C5_SO_B_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
    VALUES (v_so, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol;
    v_mo_mae := mfg_create_mo_for_line(v_so, v_sol);
    SELECT id INTO v_mo_filha FROM manufacturing_orders WHERE parent_mo_id = v_mo_mae AND product_id = v_estrut LIMIT 1;
    IF v_mo_filha IS NOT NULL THEN v_ok := v_ok + 1; scenario:='B_mo_filha_criada'; passed:=true; detail:=format('mo_mae=%s mo_filha=%s', v_mo_mae, v_mo_filha); RETURN NEXT;
    ELSE scenario:='B_mo_filha_criada'; passed:=false; detail:='MO filha não criada'; RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='B_mo_filha_criada'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  BEGIN
    v_total := v_total + 1;
    IF v_mo_filha IS NOT NULL THEN
      SELECT COUNT(*) INTO v_pn_count FROM purchase_needs WHERE manufacturing_order_id = v_mo_filha AND product_id = v_ripa;
      IF v_pn_count >= 1 AND NOT EXISTS (SELECT 1 FROM purchase_needs WHERE product_id IN (v_cama, v_estrut) AND manufacturing_order_id IN (v_mo_mae, v_mo_filha))
      THEN v_ok := v_ok + 1; scenario:='C_pn_ripa_apenas'; passed:=true; detail:=format('PN Ripa=%s', v_pn_count); RETURN NEXT;
      ELSE scenario:='C_pn_ripa_apenas'; passed:=false; detail:=format('pn_ripa=%s', v_pn_count); RETURN NEXT; END IF;
    ELSE scenario:='C_pn_ripa_apenas'; passed:=false; detail:='sem mo_filha'; RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='C_pn_ripa_apenas'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  BEGIN
    v_total := v_total + 1;
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_ripa, v_loc, 6);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_trav, v_loc, 2);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_paraf, v_loc, 20);
    PERFORM close_mo(v_mo_filha, 1);
    SELECT quantity INTO v_qty_in_stock FROM stock_quants WHERE product_id=v_estrut AND location_id=v_loc LIMIT 1;
    SELECT mc.qty_reserved INTO v_qty_reserved FROM mo_components mc WHERE mc.mo_id=v_mo_mae AND mc.product_id=v_estrut;
    IF COALESCE(v_qty_in_stock,0) >= 1 AND COALESCE(v_qty_reserved,0) >= 1 THEN
      v_ok := v_ok + 1; scenario:='D_close_filha_reserva_mae'; passed:=true; detail:=format('stock=%s reserved_mae=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT;
    ELSE scenario:='D_close_filha_reserva_mae'; passed:=false; detail:=format('stock=%s reserved_mae=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='D_close_filha_reserva_mae'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  -- E1
  BEGIN
    v_total := v_total + 1;
    UPDATE sale_orders SET state='confirmed' WHERE id = v_so;
    PERFORM close_mo(v_mo_mae, 1);
    SELECT count(*) INTO v_intent_count FROM stock_reservation_log
     WHERE origin_type='MO' AND origin_id=v_mo_mae AND payload->>'source' = 'close_mo_reserve_finished_for_sale';
    SELECT quantity, reserved_quantity INTO v_qty_in_stock, v_qty_reserved FROM stock_quants WHERE product_id=v_cama AND location_id=v_loc LIMIT 1;
    IF COALESCE(v_qty_in_stock,0) >= 1 AND v_intent_count >= 1 THEN
      v_ok := v_ok + 1; scenario:='E1_close_mae_intent'; passed:=true; detail:=format('qty=%s res=%s intents=%s', v_qty_in_stock, v_qty_reserved, v_intent_count); RETURN NEXT;
    ELSE scenario:='E1_close_mae_intent'; passed:=false; detail:=format('qty=%s res=%s intents=%s', v_qty_in_stock, v_qty_reserved, v_intent_count); RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='E1_close_mae_intent'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  -- E2
  BEGIN
    v_total := v_total + 1;
    BEGIN PERFORM so_run_operational_plan(v_so, 'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM run_inventory_allocation(v_cama, NULL, v_loc, 1, 'test_e2'); EXCEPTION WHEN OTHERS THEN NULL; END;
    SELECT quantity, reserved_quantity INTO v_q_qty, v_q_res FROM stock_quants WHERE product_id=v_cama AND location_id=v_loc LIMIT 1;
    SELECT COALESCE(qty_reserved,0) INTO v_sol_reserved FROM sale_order_lines WHERE id=v_sol;
    IF COALESCE(v_q_qty,0) >= 1 AND COALESCE(v_q_res,0) >= 1 AND COALESCE(v_sol_reserved,0) >= 1 THEN
      v_ok := v_ok + 1; scenario:='E2_allocation_efetivada'; passed:=true; detail:=format('qty=%s res=%s sol_res=%s', v_q_qty, v_q_res, v_sol_reserved); RETURN NEXT;
    ELSE scenario:='E2_allocation_efetivada'; passed:=false; detail:=format('qty=%s res=%s sol_res=%s', v_q_qty, v_q_res, v_sol_reserved); RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='E2_allocation_efetivada'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  -- E3
  BEGIN
    v_total := v_total + 1;
    INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
    VALUES ('T16C5_SO_E3_'||extract(epoch from now())::text, v_partner, v_wh, 'confirmed', 100) RETURNING id INTO v_so2;
    INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
    VALUES (v_so2, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol2;
    BEGIN PERFORM so_run_operational_plan(v_so2, 'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM run_inventory_allocation(v_cama, NULL, v_loc, 1, 'test_e3_anti_theft'); EXCEPTION WHEN OTHERS THEN NULL; END;
    SELECT COALESCE(qty_reserved,0) INTO v_sol_reserved FROM sale_order_lines WHERE id=v_sol2;
    SELECT quantity, reserved_quantity INTO v_q_qty, v_q_res FROM stock_quants WHERE product_id=v_cama AND location_id=v_loc LIMIT 1;
    IF COALESCE(v_sol_reserved,0) = 0 AND COALESCE(v_q_res,0) <= COALESCE(v_q_qty,0) THEN
      v_ok := v_ok + 1; scenario:='E3_no_theft'; passed:=true; detail:=format('sol2_res=%s qty=%s res=%s', v_sol_reserved, v_q_qty, v_q_res); RETURN NEXT;
    ELSE scenario:='E3_no_theft'; passed:=false; detail:=format('sol2_res=%s qty=%s res=%s', v_sol_reserved, v_q_qty, v_q_res); RETURN NEXT; END IF;
  EXCEPTION WHEN OTHERS THEN scenario:='E3_no_theft'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  -- G
  BEGIN
    v_total := v_total + 1;
    DECLARE v_pA uuid; v_pB uuid; v_bA uuid; v_bB uuid; v_mo_cycle uuid;
    BEGIN
      INSERT INTO products(name,type,can_be_manufactured,supply_route,active) VALUES('T16C5_CycleA','storable',true,'manufacture',true) RETURNING id INTO v_pA;
      INSERT INTO products(name,type,can_be_manufactured,supply_route,active) VALUES('T16C5_CycleB','storable',true,'manufacture',true) RETURNING id INTO v_pB;
      INSERT INTO boms(product_id,code,type,quantity,active,is_master) VALUES(v_pA,'T16C5_BCYC_A','normal',1,true,true) RETURNING id INTO v_bA;
      INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence) VALUES (v_bA,v_pB,1,10);
      INSERT INTO boms(product_id,code,type,quantity,active,is_master) VALUES(v_pB,'T16C5_BCYC_B','normal',1,true,true) RETURNING id INTO v_bB;
      INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence) VALUES (v_bB,v_pA,1,10);
      INSERT INTO manufacturing_orders(code,product_id,bom_id,qty,warehouse_id,state,origin,bom_depth)
      VALUES(mfg_next_code(),v_pA,v_bA,1,v_wh,'draft','manual',0) RETURNING id INTO v_mo_cycle;
      UPDATE manufacturing_orders SET root_mo_id=v_mo_cycle WHERE id=v_mo_cycle;
      PERFORM _mfg_materialize_child_components(v_mo_cycle);
      BEGIN
        PERFORM mfg_plan_components(v_mo_cycle, 0);
        scenario:='G_cycle_bloqueia'; passed:=false; detail:='esperado MULTILEVEL_BOM_CYCLE'; RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%MULTILEVEL_BOM_CYCLE%' THEN
          v_ok := v_ok + 1; scenario:='G_cycle_bloqueia'; passed:=true; detail:=SQLERRM; RETURN NEXT;
        ELSE scenario:='G_cycle_bloqueia'; passed:=false; detail:=SQLERRM; RETURN NEXT; END IF;
      END;
    END;
  EXCEPTION WHEN OTHERS THEN scenario:='G_cycle_bloqueia'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  -- H
  BEGIN
    v_total := v_total + 1;
    DECLARE v_so_h uuid; v_sol_h uuid; v_mo_h uuid; v_count1 int;
    BEGIN
      DELETE FROM stock_quants WHERE product_id=v_estrut;
      INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
      VALUES ('T16C5_SO_H_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100) RETURNING id INTO v_so_h;
      INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
      VALUES (v_so_h, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol_h;
      v_mo_h := mfg_create_mo_for_line(v_so_h, v_sol_h);
      PERFORM mfg_create_mo_for_line(v_so_h, v_sol_h);
      PERFORM mfg_plan_components(v_mo_h, 0);
      PERFORM mfg_plan_components(v_mo_h, 0);
      SELECT count(*) INTO v_count1 FROM manufacturing_orders
       WHERE id=v_mo_h OR parent_mo_id=v_mo_h OR parent_mo_id IN (SELECT id FROM manufacturing_orders WHERE parent_mo_id=v_mo_h);
      IF v_count1 = 2 THEN v_ok := v_ok + 1; scenario:='H_idempotencia'; passed:=true; detail:=format('mos=%s', v_count1); RETURN NEXT;
      ELSE scenario:='H_idempotencia'; passed:=false; detail:=format('mos=%s esperado=2', v_count1); RETURN NEXT; END IF;
    END;
  EXCEPTION WHEN OTHERS THEN scenario:='H_idempotencia'; passed:=false; detail:=SQLERRM; RETURN NEXT; END;

  scenario := 'TOTAL';
  passed := (v_ok = v_total);
  detail := format('%s/%s scenarios passed', v_ok, v_total);
  RETURN NEXT;
END $function$;