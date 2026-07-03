
CREATE OR REPLACE FUNCTION public._test_supply_canonical_path()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_partner uuid; v_supplier uuid; v_product uuid;
  v_wh uuid; v_uom uuid; v_stock_loc uuid;
  v_so uuid; v_sol uuid;
  v_po_direct_count int; v_needs_count int;
  v_need_id uuid; v_po uuid; v_pol uuid;
  v_plan jsonb; v_reserved numeric; v_line_status text;
  v_results jsonb := '[]'::jsonb;
  v_tag text := 'TSC_' || to_char(now(),'YYYYMMDDHH24MISS');
BEGIN
  SELECT id INTO v_wh FROM warehouses ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'no warehouse available'; END IF;
  SELECT id INTO v_uom FROM product_uom ORDER BY id LIMIT 1;
  v_stock_loc := public.default_location(v_wh,'Stock');
  IF v_stock_loc IS NULL THEN RAISE EXCEPTION 'no Stock location in warehouse %', v_wh; END IF;

  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI', true) RETURNING id INTO v_partner;
  INSERT INTO partners(name, is_supplier) VALUES (v_tag||' SUP', true) RETURNING id INTO v_supplier;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, can_be_manufactured, uom_id, supply_route)
  VALUES (v_tag||' PROD','storable',true,true,false,v_uom,'buy'::product_supply_route)
  RETURNING id INTO v_product;
  INSERT INTO product_suppliers(product_id, partner_id, priority, lead_time_days)
  VALUES (v_product, v_supplier, 1, 5);

  INSERT INTO sale_orders(name, partner_id, warehouse_id, state)
  VALUES (v_tag, v_partner, v_wh, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_uom, 3, 10, 30, 'product') RETURNING id INTO v_sol;

  -- (a) confirm → planner via trigger → 0 POs inline, 1 need
  PERFORM confirm_sale_order(v_so);
  SELECT count(*) INTO v_po_direct_count FROM purchase_order_lines WHERE source_sale_order_id = v_so;
  IF v_po_direct_count <> 0 THEN RAISE EXCEPTION 'FAIL (a): PO inline=%', v_po_direct_count; END IF;
  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN RAISE EXCEPTION 'FAIL (a): needs=% (esperado 1)', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('a_confirm', jsonb_build_object('po_inline',v_po_direct_count,'needs',v_needs_count));

  -- (b) replan idempotente
  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN RAISE EXCEPTION 'FAIL (b): replan needs=% (esperado 1)', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('b_replan_idempotent', jsonb_build_object('needs',v_needs_count));

  -- (c) PO em curso → guarda evita nova need
  SELECT id INTO v_need_id FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved') LIMIT 1;
  INSERT INTO purchase_orders(name, state, partner_id, warehouse_id, expected_date, origin)
  VALUES (v_tag||'-PO', 'draft', v_supplier, v_wh, CURRENT_DATE + 5, v_tag) RETURNING id INTO v_po;
  INSERT INTO purchase_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, source_sale_order_id)
  VALUES (v_po, v_product, v_uom, 3, 10, 30, v_so) RETURNING id INTO v_pol;
  UPDATE purchase_needs SET state='po_created', purchase_order_id=v_po WHERE id=v_need_id;
  UPDATE purchase_orders SET state='confirmed' WHERE id=v_po;

  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 0 THEN RAISE EXCEPTION 'FAIL (c): guarda ignorada, needs pending=%', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('c_guard_po_in_progress', jsonb_build_object('pending_needs',v_needs_count));

  -- (d) receber PO: injeta stock, marca supply_link como consumed, replan → reserva
  UPDATE purchase_orders SET state='done' WHERE id=v_po;
  UPDATE purchase_needs SET state='received' WHERE id=v_need_id;
  UPDATE sale_order_line_supply_links
     SET state='consumed'::supply_link_state
   WHERE sale_order_line_id = v_sol AND link_kind='purchase_need';
  INSERT INTO stock_quants(product_id, location_id, quantity, reserved_quantity)
  VALUES (v_product, v_stock_loc, 3, 0);

  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan := so_run_operational_plan(v_so, 'replan');
  SELECT qty_reserved, operational_status INTO v_reserved, v_line_status
    FROM sale_order_lines WHERE id = v_sol;
  IF COALESCE(v_reserved,0) < 3 THEN
    RAISE EXCEPTION 'FAIL (d): esperado qty_reserved>=3, obtido % (status=%)', v_reserved, v_line_status;
  END IF;
  v_results := v_results || jsonb_build_object('d_after_receipt',
     jsonb_build_object('qty_reserved',v_reserved,'status',v_line_status));

  -- Cleanup
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so));
  DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so);
  DELETE FROM stock_quants WHERE product_id = v_product;
  DELETE FROM purchase_order_lines WHERE order_id = v_po;
  DELETE FROM purchase_orders WHERE id = v_po;
  DELETE FROM purchase_needs WHERE sale_order_id = v_so;
  DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so;
  DELETE FROM sale_order_timeline WHERE sale_order_id = v_so;
  DELETE FROM sale_order_line_supply_links WHERE sale_order_line_id = v_sol;
  DELETE FROM sale_order_lines WHERE order_id = v_so;
  DELETE FROM sale_orders WHERE id = v_so;
  DELETE FROM product_suppliers WHERE product_id = v_product;
  DELETE FROM products WHERE id = v_product;
  DELETE FROM partners WHERE id IN (v_partner, v_supplier);

  RETURN jsonb_build_object('ok', true, 'steps', v_results);

EXCEPTION WHEN OTHERS THEN
  BEGIN DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_quants WHERE product_id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_order_lines WHERE source_sale_order_id = v_so OR order_id = v_po; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_orders WHERE id = v_po; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_needs WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_timeline WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_line_supply_links WHERE sale_order_line_id = v_sol; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_lines WHERE order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_orders WHERE id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_suppliers WHERE product_id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM products WHERE id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM partners WHERE id IN (v_partner, v_supplier); EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END $function$;
