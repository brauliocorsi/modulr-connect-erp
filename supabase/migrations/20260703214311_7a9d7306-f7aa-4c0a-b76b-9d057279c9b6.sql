
CREATE OR REPLACE FUNCTION public._test_mfg_fixes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag text := 'TMF_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_wh uuid; v_uom uuid; v_stock_loc uuid;
  v_partner uuid; v_product uuid; v_variant_a uuid; v_variant_b uuid;
  v_so uuid; v_sol uuid;
  v_mo uuid; v_mo_qty numeric;
  v_move_variant uuid;
  v_op1 uuid; v_op2 uuid; v_op3 uuid;
  v_seq_err text; v_ok_after_override boolean;
  v_finish_err text;
  v_res_a numeric; v_res_b numeric;
  v_trg_def text; v_has_log boolean; v_has_notify boolean;
  v_canonical jsonb;
  v_results jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_wh FROM warehouses ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'no warehouse'; END IF;
  SELECT id INTO v_uom FROM product_uom ORDER BY id LIMIT 1;
  v_stock_loc := public.default_location(v_wh,'Stock');

  -- (a) qty MO = qty em falta
  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI-A', true) RETURNING id INTO v_partner;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, can_be_manufactured, uom_id, supply_route)
  VALUES (v_tag||' PROD-A','storable',true,false,true,v_uom,'manufacture'::product_supply_route) RETURNING id INTO v_product;
  INSERT INTO boms(product_id, code, quantity, uom_id, active) VALUES (v_product, v_tag||'-BOM', 1, v_uom, true);
  INSERT INTO stock_quants(product_id, location_id, quantity, reserved_quantity) VALUES (v_product, v_stock_loc, 2, 0);
  INSERT INTO sale_orders(name, partner_id, warehouse_id, state) VALUES (v_tag||'-A', v_partner, v_wh, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_uom, 3, 10, 30, 'product') RETURNING id INTO v_sol;
  PERFORM confirm_sale_order(v_so);
  SELECT id, qty INTO v_mo, v_mo_qty FROM manufacturing_orders
   WHERE sale_order_line_id = v_sol AND parent_mo_id IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v_mo IS NULL THEN RAISE EXCEPTION 'FAIL (a): MO não criada'; END IF;
  IF v_mo_qty <> 1 THEN RAISE EXCEPTION 'FAIL (a): MO.qty=% (esperado 1)', v_mo_qty; END IF;
  v_results := v_results || jsonb_build_object('a_mo_qty_delta', jsonb_build_object('mo_id',v_mo,'qty',v_mo_qty,'expected',1));

  -- (b) variant
  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI-B', true) RETURNING id INTO v_partner;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, uom_id, supply_route)
  VALUES (v_tag||' PROD-B','storable',true,false,v_uom,'buy'::product_supply_route) RETURNING id INTO v_product;
  INSERT INTO product_variants(product_id, sku) VALUES (v_product, v_tag||'-VA') RETURNING id INTO v_variant_a;
  INSERT INTO product_variants(product_id, sku) VALUES (v_product, v_tag||'-VB') RETURNING id INTO v_variant_b;
  INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity) VALUES (v_product, v_variant_a, v_stock_loc, 5, 0);
  INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity) VALUES (v_product, v_variant_b, v_stock_loc, 5, 0);
  INSERT INTO sale_orders(name, partner_id, warehouse_id, state) VALUES (v_tag||'-B', v_partner, v_wh, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_variant_a, v_uom, 2, 10, 20, 'product') RETURNING id INTO v_sol;
  PERFORM confirm_sale_order(v_so);
  SELECT variant_id INTO v_move_variant FROM stock_moves sm
    JOIN stock_pickings sp ON sp.id = sm.picking_id
   WHERE sp.origin = (SELECT name FROM sale_orders WHERE id=v_so) AND sm.product_id = v_product
   ORDER BY sm.created_at DESC LIMIT 1;
  IF v_move_variant IS DISTINCT FROM v_variant_a THEN RAISE EXCEPTION 'FAIL (b): move variant_id=% expected %', v_move_variant, v_variant_a; END IF;
  SELECT reserved_quantity INTO v_res_a FROM stock_quants WHERE product_id=v_product AND variant_id=v_variant_a;
  SELECT reserved_quantity INTO v_res_b FROM stock_quants WHERE product_id=v_product AND variant_id=v_variant_b;
  IF v_res_a < 2 THEN RAISE EXCEPTION 'FAIL (b): variante A não reservou (res=%)', v_res_a; END IF;
  IF v_res_b <> 0 THEN RAISE EXCEPTION 'FAIL (b): variante B tocada (res=%)', v_res_b; END IF;
  v_results := v_results || jsonb_build_object('b_variant_isolation', jsonb_build_object('move_variant',v_move_variant,'res_a',v_res_a,'res_b',v_res_b));

  -- (c) verificação estrutural: o trigger tg_zz_mo_done_replan tem os blocos de log+notify
  --     (o teste dinâmico E2E requer reproduzir uma falha real do planner sem tocar em outras
  --      funções, o que não é seguro num transação de teste — mantemos verificação estática)
  v_trg_def := pg_get_functiondef('public.tg_zz_mo_done_replan'::regproc);
  v_has_log := v_trg_def LIKE '%sale_operational_plan_log%mo_done_failed%';
  v_has_notify := v_trg_def LIKE '%notify_user%Replaneamento falhou%';
  IF NOT v_has_log THEN RAISE EXCEPTION 'FAIL (c): trigger sem bloco de log mo_done_failed'; END IF;
  IF NOT v_has_notify THEN RAISE EXCEPTION 'FAIL (c): trigger sem bloco de notify_user'; END IF;
  v_results := v_results || jsonb_build_object('c_mo_done_error_path', jsonb_build_object('log_block',v_has_log,'notify_block',v_has_notify,'note','verificação estática — reprodução E2E requer stub de so_run_operational_plan (não seguro em teste)'));

  -- (d) gating
  INSERT INTO manufacturing_orders(code, product_id, qty, uom_id, warehouse_id, state, origin)
  VALUES (public.mfg_next_code(), v_product, 1, v_uom, v_wh, 'ready'::mo_state, 'manual') RETURNING id INTO v_mo;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state) VALUES (v_mo, 10, 'Op1', 30, 'ready'::mo_op_state) RETURNING id INTO v_op1;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state) VALUES (v_mo, 20, 'Op2', 30, 'ready'::mo_op_state) RETURNING id INTO v_op2;

  v_seq_err := NULL;
  BEGIN PERFORM public.work_order_start(v_op2, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_seq_err := SQLERRM; END;
  IF v_seq_err IS NULL OR v_seq_err NOT LIKE 'PREVIOUS_OPERATIONS_PENDING%' THEN
    RAISE EXCEPTION 'FAIL (d): esperava PREVIOUS_OPERATIONS_PENDING, obteve: %', COALESCE(v_seq_err,'(sem erro)');
  END IF;

  BEGIN PERFORM public.work_order_start(v_op2, NULL, NULL, 'urgência cliente teste');
    v_ok_after_override := true;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL (d): override devia passar: %', SQLERRM; END;

  IF NOT EXISTS(SELECT 1 FROM mo_workorder_logs WHERE mo_operation_id=v_op2 AND notes LIKE 'override sequência%') THEN
    RAISE EXCEPTION 'FAIL (d): log de override não registado';
  END IF;
  v_results := v_results || jsonb_build_object('d_sequence_gating', jsonb_build_object('blocked_without_reason',true,'passed_with_reason',v_ok_after_override));

  v_finish_err := NULL;
  BEGIN
    INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (v_mo, 30, 'Op3', 15, 'ready'::mo_op_state) RETURNING id INTO v_op3;
    PERFORM public.mfg_finish_operation(v_op3, 1, 0, NULL);
  EXCEPTION WHEN OTHERS THEN v_finish_err := SQLERRM; END;
  IF v_finish_err IS NULL OR v_finish_err NOT LIKE '%nunca foi iniciada%' THEN
    RAISE EXCEPTION 'FAIL (d.finish): esperava proteção, obteve: %', COALESCE(v_finish_err,'(sem erro)');
  END IF;
  v_results := v_results || jsonb_build_object('d_finish_guard', jsonb_build_object('protected', true));

  -- (e) rerun canonical
  v_canonical := public._test_supply_canonical_path();
  v_results := v_results || jsonb_build_object('e_supply_canonical', v_canonical);

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END $function$;
