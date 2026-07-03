
CREATE OR REPLACE FUNCTION public._test_supply_canonical_path()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner uuid; v_supplier uuid; v_product uuid;
  v_wh uuid; v_uom uuid;
  v_so uuid; v_sol uuid;
  v_po_direct_count int;
  v_needs_count int;
  v_need_id uuid;
  v_po uuid; v_pol uuid;
  v_plan2 jsonb; v_plan3 jsonb; v_plan4 jsonb;
  v_results jsonb := '[]'::jsonb;
  v_tag text := 'TSC_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_line_status text;
  v_dbg_dedup int; v_dbg_needs jsonb;
BEGIN
  SELECT id INTO v_wh FROM warehouses ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'no warehouse available'; END IF;
  SELECT id INTO v_uom FROM product_uom ORDER BY id LIMIT 1;

  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI', true) RETURNING id INTO v_partner;
  INSERT INTO partners(name, is_supplier) VALUES (v_tag||' SUP', true) RETURNING id INTO v_supplier;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, can_be_manufactured, uom_id, supply_route)
  VALUES (v_tag||' PROD','storable',true,true,false,v_uom,'buy'::product_supply_route)
  RETURNING id INTO v_product;
  INSERT INTO product_suppliers(product_id, partner_id, priority, lead_time_days)
  VALUES (v_product, v_supplier, 1, 5);

  INSERT INTO sale_orders(name, partner_id, warehouse_id, state)
  VALUES (v_tag, v_partner, v_wh, 'draft')
  RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_uom, 3, 10, 30, 'product')
  RETURNING id INTO v_sol;

  -- (a) confirm
  PERFORM confirm_sale_order(v_so);

  SELECT count(*) INTO v_po_direct_count FROM purchase_order_lines WHERE source_sale_order_id = v_so;
  IF v_po_direct_count <> 0 THEN RAISE EXCEPTION 'FAIL (a) PO inline=%', v_po_direct_count; END IF;

  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN RAISE EXCEPTION 'FAIL (a) needs=%', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('a_confirm_ok',true,'needs',v_needs_count);

  -- DIAGNÓSTICO: reproduzir dedupe SELECT antes do replan
  SELECT count(*) INTO v_dbg_dedup FROM public.purchase_needs
   WHERE product_id = v_product
     AND COALESCE(product_variant_id::text,'') = COALESCE(NULL::text,'')
     AND origin_kind = 'sale'::purchase_need_origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(v_so::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(NULL::text,'');
  SELECT jsonb_agg(jsonb_build_object('id',id,'state',state,'origin',origin_kind,'prod',product_id,'var',product_variant_id,'mo',manufacturing_order_id,'sale',sale_order_id))
    INTO v_dbg_needs FROM purchase_needs WHERE sale_order_id = v_so;
  RAISE NOTICE 'DEDUPE would find % rows; needs snapshot: %', v_dbg_dedup, v_dbg_needs;

  -- (b) replan
  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan2 := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN RAISE EXCEPTION 'FAIL (b) replan needs=%', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('b_replan_ok',true,'needs',v_needs_count,'dbg_dedup_before',v_dbg_dedup);

  -- (c) converter need em PO e replanear → guarda evita nova need
  SELECT id INTO v_need_id FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved') LIMIT 1;
  INSERT INTO purchase_orders(name, state, partner_id, warehouse_id, expected_date, origin)
  VALUES (v_tag||'-PO', 'draft', v_supplier, v_wh, CURRENT_DATE + 5, v_tag)
  RETURNING id INTO v_po;
  INSERT INTO purchase_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, source_sale_order_id)
  VALUES (v_po, v_product, v_uom, 3, 10, 30, v_so)
  RETURNING id INTO v_pol;
  UPDATE purchase_needs SET state='po_created', purchase_order_id=v_po WHERE id=v_need_id;
  UPDATE purchase_orders SET state='confirmed' WHERE id=v_po;

  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan3 := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 0 THEN RAISE EXCEPTION 'FAIL (c) guarda: needs pending=%', v_needs_count; END IF;
  v_results := v_results || jsonb_build_object('c_guard_ok',true,'pending_needs',v_needs_count);

  -- (d) receber PO
  UPDATE purchase_orders SET state='done' WHERE id=v_po;
  UPDATE purchase_needs SET state='received' WHERE id=v_need_id;
  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan4 := so_run_operational_plan(v_so, 'replan');
  SELECT operational_status INTO v_line_status FROM sale_order_lines WHERE id = v_sol;
  v_results := v_results || jsonb_build_object('d_after_receipt',true,'line_status',v_line_status);

  -- Cleanup
  DELETE FROM purchase_order_lines WHERE order_id = v_po;
  DELETE FROM purchase_orders WHERE id = v_po;
  DELETE FROM purchase_needs WHERE sale_order_id = v_so;
  DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so;
  DELETE FROM sale_order_timeline WHERE sale_order_id = v_so;
  DELETE FROM sale_order_line_supply_links WHERE sale_order_line_id = v_sol;
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so));
  DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so);
  DELETE FROM sale_order_lines WHERE order_id = v_so;
  DELETE FROM sale_orders WHERE id = v_so;
  DELETE FROM product_suppliers WHERE product_id = v_product;
  DELETE FROM products WHERE id = v_product;
  DELETE FROM partners WHERE id IN (v_partner, v_supplier);

  RETURN jsonb_build_object('ok', true, 'steps', v_results);

EXCEPTION WHEN OTHERS THEN
  BEGIN DELETE FROM purchase_order_lines WHERE source_sale_order_id = v_so OR order_id = v_po; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_orders WHERE id = v_po; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_needs WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_timeline WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_line_supply_links WHERE sale_order_line_id = v_sol; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_lines WHERE order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_orders WHERE id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_suppliers WHERE product_id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM products WHERE id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM partners WHERE id IN (v_partner, v_supplier); EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END $function$;
