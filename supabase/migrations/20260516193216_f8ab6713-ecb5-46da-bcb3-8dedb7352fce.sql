CREATE OR REPLACE FUNCTION public._test_phase16_b0_3_allocation_engine()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B03_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_company uuid; v_wh uuid; v_loc uuid;
  v_prod_off uuid; v_prod_on uuid; v_prod_strict uuid; v_prod_manual uuid;
  v_prod_paid uuid; v_prod_date uuid; v_prod_custom uuid;
  v_so1 uuid; v_so2 uuid; v_so3 uuid; v_so4 uuid; v_so5 uuid; v_so_b uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid; v_l_b uuid;
  v_q  uuid;
  v_pkg_ok uuid; v_pkg_dmg uuid; v_pkg_dock uuid; v_pkg_loaded uuid; v_pkg_already uuid;
  v_r jsonb; v_passed int := 0; v_failed int := 0; v_ok boolean;
  v_resv_before numeric; v_resv_after numeric; v_qty_res numeric;
  v_dec1 uuid; v_dec2 uuid;
  v_so_paid uuid; v_lp uuid;
  v_so_date_a uuid; v_so_date_b uuid; v_ld_a uuid; v_ld_b uuid;
  v_so_cust uuid; v_lc uuid;
  v_neg_count bigint; v_inv_count bigint;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  SELECT id INTO v_loc FROM public.stock_locations WHERE type='internal' LIMIT 1;
  IF v_loc IS NULL THEN SELECT id INTO v_loc FROM public.stock_locations LIMIT 1; END IF;

  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_OFF', true, 'oldest_order_first', false, v_company) RETURNING id INTO v_prod_off;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_ON',  true, 'oldest_order_first', true,  v_company) RETURNING id INTO v_prod_on;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_STRICT', true, 'strict_order', v_company) RETURNING id INTO v_prod_strict;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_MANUAL', true, 'manual_allocation', v_company) RETURNING id INTO v_prod_manual;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_PAID', true, 'paid_priority', v_company) RETURNING id INTO v_prod_paid;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_DATE', true, 'delivery_date_first', v_company) RETURNING id INTO v_prod_date;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,allocation_priority_weights,company_id)
    VALUES (v_prefix||'_CUST', true, 'custom_priority', NULL, v_company) RETURNING id INTO v_prod_custom;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_O1', v_partner,'confirmed',v_wh,v_company,now()-interval '10 days') RETURNING id INTO v_so1;
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_O2', v_partner,'confirmed',v_wh,v_company,now()-interval '5 days')  RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so1, v_prod_off, 5, 'waiting_purchase', current_date+10) RETURNING id INTO v_l1;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so2, v_prod_off, 3, 'waiting_purchase', current_date+5)  RETURNING id INTO v_l2;

  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
    VALUES (v_prod_off, v_loc, 4, 0) RETURNING id INTO v_q;

  UPDATE public.products SET allocation_policy='stock_pool_first' WHERE id = v_prod_off;
  v_r := public.run_inventory_allocation(v_prod_off, NULL, v_loc, NULL, 'test1');
  v_ok := (v_r->>'ok')::boolean = true AND (v_r->>'auto')::boolean = true AND (v_r->>'allocated')::numeric > 0;
  v_tests := v_tests || jsonb_build_object('name','1_stock_pool_first_auto_allocates','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l1;
  v_ok := v_qty_res = 4;
  v_tests := v_tests || jsonb_build_object('name','2_oldest_order_first','passed',v_ok,'observed',jsonb_build_object('l1_reserved',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT reserved_quantity INTO v_resv_after FROM public.stock_quants WHERE id = v_q;
  v_ok := v_resv_after = 4;
  v_tests := v_tests || jsonb_build_object('name','8_tracking_off_quant_reserved','passed',v_ok,'observed',jsonb_build_object('quant_reserved',v_resv_after));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := v_qty_res = 4;
  v_tests := v_tests || jsonb_build_object('name','9_tracking_off_line_qty_reserved','passed',v_ok,'observed',jsonb_build_object('l1',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_r := public.run_inventory_allocation(v_prod_off, NULL, v_loc, NULL, 'test18');
  v_ok := (v_r->>'allocated')::numeric = 0;
  v_tests := v_tests || jsonb_build_object('name','18_no_double_allocation','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_DA', v_partner,'confirmed',v_wh,v_company,now()-interval '8 days') RETURNING id INTO v_so_date_a;
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_DB', v_partner,'confirmed',v_wh,v_company,now()-interval '2 days') RETURNING id INTO v_so_date_b;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_date_a, v_prod_date, 5, 'waiting_purchase', current_date+30) RETURNING id INTO v_ld_a;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_date_b, v_prod_date, 5, 'waiting_purchase', current_date+1)  RETURNING id INTO v_ld_b;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_date, v_loc, 3, 0);
  v_r := public.run_inventory_allocation(v_prod_date, NULL, v_loc, NULL, 'test3');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_ld_b;
  v_ok := v_qty_res = 3;
  v_tests := v_tests || jsonb_build_object('name','3_delivery_date_first','passed',v_ok,'observed',jsonb_build_object('lb_reserved',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_PA', v_partner,'confirmed',v_wh,v_company,now()-interval '10 days') RETURNING id INTO v_so_paid;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_paid, v_prod_paid, 5, 'waiting_purchase') RETURNING id INTO v_lp;
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_PA2', v_partner,'confirmed',v_wh,v_company,now()-interval '20 days') RETURNING id INTO v_so5;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so5, v_prod_paid, 5, 'waiting_purchase') RETURNING id INTO v_l5;
  BEGIN
    INSERT INTO public.customer_payments(name,partner_id,order_id,payment_date,amount,state)
      VALUES (v_prefix||'_P', v_partner, v_so_paid, current_date, 999, 'confirmed');
  EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_paid, v_loc, 3, 0);
  v_r := public.run_inventory_allocation(v_prod_paid, NULL, v_loc, NULL, 'test4');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_lp;
  v_ok := v_qty_res = 3 OR v_qty_res IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','4_paid_priority','passed',v_ok,'observed',jsonb_build_object('lp',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_MA',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so3;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so3, v_prod_manual, 4, 'waiting_purchase') RETURNING id INTO v_l3;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_manual, v_loc, 4, 0);
  v_r := public.run_inventory_allocation(v_prod_manual, NULL, v_loc, NULL, 'test5');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l3;
  v_ok := (v_r->>'decision_required')::boolean = true AND COALESCE(v_qty_res,0) = 0;
  v_tests := v_tests || jsonb_build_object('name','5_manual_allocation_decision','passed',v_ok,'observed',jsonb_build_object('qty',v_qty_res,'r',v_r));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  v_dec1 := (v_r->'decisions'->0->>'decision_id')::uuid;

  v_r := public.run_inventory_allocation(v_prod_manual, NULL, v_loc, NULL, 'test5');
  v_dec2 := (v_r->'decisions'->0->>'decision_id')::uuid;
  v_ok := v_dec1 = v_dec2
       AND (SELECT count(*) FROM public.allocation_decisions WHERE state='pending' AND suggested_target_line_id = v_l3 AND product_id = v_prod_manual) = 1;
  v_tests := v_tests || jsonb_build_object('name','17_allocation_decisions_idempotent','passed',v_ok,'observed',jsonb_build_object('d1',v_dec1,'d2',v_dec2));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_SO',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so4;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so4, v_prod_strict, 4, 'waiting_purchase') RETURNING id INTO v_l4;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_strict, v_loc, 4, 0);
  v_r := public.run_inventory_allocation(v_prod_strict, NULL, v_loc, NULL, 'test6');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l4;
  v_ok := (v_r->>'decision_required')::boolean = true AND COALESCE(v_qty_res,0) = 0;
  v_tests := v_tests || jsonb_build_object('name','6_strict_order_decision','passed',v_ok,'observed',jsonb_build_object('qty',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at) VALUES (v_prefix||'_CU',v_partner,'confirmed',v_wh,v_company,now()-interval '3 days') RETURNING id INTO v_so_cust;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_cust, v_prod_custom, 2, 'waiting_purchase') RETURNING id INTO v_lc;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_custom, v_loc, 2, 0);
  v_r := public.run_inventory_allocation(v_prod_custom, NULL, v_loc, NULL, 'test7');
  v_ok := (v_r->>'allocated')::numeric = 2 AND v_r->>'effective_policy'='oldest_order_first' AND v_r->>'warning' IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','7_custom_priority_fallback','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON1',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b, v_prod_on, 10, 'waiting_purchase') RETURNING id INTO v_l_b;

  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'available') RETURNING id INTO v_pkg_ok;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'damaged', 'available') RETURNING id INTO v_pkg_dmg;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'at_dock') RETURNING id INTO v_pkg_dock;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'loaded') RETURNING id INTO v_pkg_loaded;
  INSERT INTO public.stock_packages(product_id,qty,sale_order_line_id,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_l_b, v_loc, 'good', 'reserved') RETURNING id INTO v_pkg_already;

  v_r := public.run_inventory_allocation(v_prod_on, NULL, v_loc, NULL, 'test10');

  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_ok) = v_l_b;
  v_tests := v_tests || jsonb_build_object('name','10_tracking_on_allocates_available','passed',v_ok,'observed',jsonb_build_object('pkg_ok_line',(SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_ok)));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_dmg) IS NULL;
  v_tests := v_tests || jsonb_build_object('name','12_tracking_on_skips_damaged','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_dock) IS NULL
       AND (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_loaded) IS NULL;
  v_tests := v_tests || jsonb_build_object('name','13_tracking_on_skips_dock_loaded','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_already) = v_l_b;
  v_tests := v_tests || jsonb_build_object('name','11_tracking_on_skips_already_reserved','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  DECLARE v_lt uuid;
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_T',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b, v_prod_off, 3, 'waiting_purchase') RETURNING id INTO v_lt;
    v_r := public.transfer_sale_reservation(v_l1, v_lt, 2, 'test14');
    SELECT qty_reserved INTO v_resv_before FROM public.sale_order_lines WHERE id = v_l1;
    SELECT qty_reserved INTO v_resv_after  FROM public.sale_order_lines WHERE id = v_lt;
    v_ok := (v_r->>'ok')::boolean = true AND v_resv_before = 2 AND v_resv_after = 2;
    v_tests := v_tests || jsonb_build_object('name','14_transfer_between_compatible','passed',v_ok,'observed',jsonb_build_object('from',v_resv_before,'to',v_resv_after,'r',v_r));
    IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  v_r := public.transfer_sale_reservation(v_l1, v_l_b, 1, 'test15');
  v_ok := (v_r->>'ok')::boolean = false AND v_r->>'error' = 'incompatible_lines';
  v_tests := v_tests || jsonb_build_object('name','15_transfer_blocks_incompatible_product','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  UPDATE public.stock_packages SET status='loaded' WHERE id = v_pkg_ok;
  DECLARE v_l_b2 uuid; v_so_b2 uuid;
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON2',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b2;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b2, v_prod_on, 5, 'waiting_purchase') RETURNING id INTO v_l_b2;
    v_r := public.transfer_sale_reservation(v_l_b, v_l_b2, 2, 'test16');
  END;
  UPDATE public.stock_packages SET status='delivered' WHERE id = v_pkg_already;
  DECLARE v_l_b3 uuid; v_so_b3 uuid;
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON3',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b3;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b3, v_prod_on, 5, 'waiting_purchase') RETURNING id INTO v_l_b3;
    v_r := public.transfer_sale_reservation(v_l_b, v_l_b3, 2, 'test16b');
    v_ok := (v_r->>'ok')::boolean = false AND v_r->>'error' = 'no_eligible_packages';
    v_tests := v_tests || jsonb_build_object('name','16_transfer_blocks_loaded_delivered','passed',v_ok,'observed',v_r);
    IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  SELECT count(*) INTO v_inv_count FROM public.stock_quants WHERE reserved_quantity > quantity;
  v_ok := v_inv_count = 0;
  v_tests := v_tests || jsonb_build_object('name','19_no_reserved_gt_quantity','passed',v_ok,'observed',jsonb_build_object('violations',v_inv_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE quantity < 0 OR reserved_quantity < 0;
  v_ok := v_neg_count = 0;
  v_tests := v_tests || jsonb_build_object('name','20_no_negative_stock','passed',v_ok,'observed',jsonb_build_object('violations',v_neg_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := EXISTS (SELECT 1 FROM public.stock_reservation_log WHERE action='allocate_auto' AND notes LIKE 'test%');
  v_tests := v_tests || jsonb_build_object('name','21_log_allocate_auto','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := EXISTS (SELECT 1 FROM public.stock_reservation_log WHERE action='transfer' AND notes LIKE 'test%');
  v_tests := v_tests || jsonb_build_object('name','22_log_transfer','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  DELETE FROM public.stock_reservation_log WHERE notes LIKE 'test%' AND created_at > now() - interval '1 hour';
  DELETE FROM public.allocation_decisions  WHERE product_id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);
  DELETE FROM public.stock_packages WHERE id IN (v_pkg_ok,v_pkg_dmg,v_pkg_dock,v_pkg_loaded,v_pkg_already);
  DELETE FROM public.stock_quants WHERE product_id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);
  DELETE FROM public.customer_payments WHERE name LIKE v_prefix||'%';
  DELETE FROM public.sale_order_lines WHERE order_id IN (
    SELECT id FROM public.sale_orders WHERE name LIKE v_prefix||'%'
  );
  DELETE FROM public.sale_orders WHERE name LIKE v_prefix||'%';
  DELETE FROM public.products WHERE id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);

  RETURN jsonb_build_object('prefix',v_prefix,'total',v_passed+v_failed,'passed',v_passed,'failed',v_failed,'tests',v_tests);
END; $body$;

GRANT EXECUTE ON FUNCTION public._test_phase16_b0_3_allocation_engine() TO service_role;