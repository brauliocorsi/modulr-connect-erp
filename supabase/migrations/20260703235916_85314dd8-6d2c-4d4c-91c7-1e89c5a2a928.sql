
CREATE OR REPLACE FUNCTION public._test_costing_purchase()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prod uuid; v_supplier uuid; v_wh uuid;
  v_loc_int uuid; v_loc_sup uuid;
  v_po uuid; v_pol uuid; v_pick uuid; v_move uuid;
  v_p record; v_eff numeric;
  v_results jsonb := '{}'::jsonb;
  a_ok boolean; b_ok boolean; c_ok boolean; d_ok boolean; e_ok boolean;
  v_before_last numeric; v_before_avg numeric;
BEGIN
  IF public.get_module_setting('__notexist__','__k__','"D"'::jsonb) = '"D"'::jsonb THEN
    a_ok := true; ELSE a_ok := false;
  END IF;
  v_results := v_results || jsonb_build_object('a_default_fallback', a_ok);

  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  IF v_wh IS NULL THEN
    INSERT INTO public.warehouses(name, code) VALUES ('TEST-WH','TWH') RETURNING id INTO v_wh;
  END IF;
  SELECT id INTO v_loc_int FROM public.stock_locations WHERE type='internal' AND warehouse_id = v_wh LIMIT 1;
  IF v_loc_int IS NULL THEN
    INSERT INTO public.stock_locations(name, type, warehouse_id, usage)
    VALUES ('TEST-INT','internal', v_wh, 'internal') RETURNING id INTO v_loc_int;
  END IF;
  SELECT id INTO v_loc_sup FROM public.stock_locations WHERE type='supplier' LIMIT 1;
  IF v_loc_sup IS NULL THEN
    INSERT INTO public.stock_locations(name, type, usage) VALUES ('TEST-SUP','supplier','supplier') RETURNING id INTO v_loc_sup;
  END IF;

  INSERT INTO public.products(name, internal_ref, type, can_be_purchased, active, standard_cost)
  VALUES ('TEST-COSTING-'||substr(gen_random_uuid()::text,1,8),
          'T-COST-'||substr(gen_random_uuid()::text,1,6),
          'storable'::product_type, true, true, 0)
  RETURNING id INTO v_prod;

  INSERT INTO public.partners(name, is_supplier)
  VALUES ('TEST-SUPP-'||substr(gen_random_uuid()::text,1,8), true)
  RETURNING id INTO v_supplier;

  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TC-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 10, 50, 1) RETURNING id INTO v_pol;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TC-'||substr(gen_random_uuid()::text,1,6),'incoming','ready',v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 10, 10, 'ready', v_pol) RETURNING id INTO v_move;
  INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
  VALUES (v_prod, v_loc_int, 10, 0);
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  b_ok := (v_p.last_cost = 50 AND v_p.average_cost = 50);
  v_results := v_results || jsonb_build_object('b1_first_receipt', jsonb_build_object(
    'ok', b_ok, 'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost));

  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TC2-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 10, 60, 1) RETURNING id INTO v_pol;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TC2-'||substr(gen_random_uuid()::text,1,6),'incoming','ready',v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 10, 10, 'ready', v_pol) RETURNING id INTO v_move;
  UPDATE public.stock_quants SET quantity = quantity + 10 WHERE product_id = v_prod AND location_id = v_loc_int;
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  b_ok := b_ok AND (v_p.last_cost = 60 AND abs(v_p.average_cost - 55) < 0.001);
  v_results := v_results || jsonb_build_object('b2_second_receipt', jsonb_build_object(
    'ok', (v_p.last_cost=60 AND abs(v_p.average_cost-55)<0.001),
    'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost, 'expected_avg', 55));

  SELECT last_cost, average_cost INTO v_before_last, v_before_avg FROM public.products WHERE id = v_prod;
  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TC3-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 5, 0, 1) RETURNING id INTO v_pol;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TC3-'||substr(gen_random_uuid()::text,1,6),'incoming','ready',v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 5, 5, 'ready', v_pol) RETURNING id INTO v_move;
  UPDATE public.stock_quants SET quantity = quantity + 5 WHERE product_id = v_prod AND location_id = v_loc_int;
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  c_ok := (v_p.last_cost = v_before_last AND v_p.average_cost = v_before_avg);
  v_results := v_results || jsonb_build_object('c_zero_price_noop', jsonb_build_object(
    'ok', c_ok, 'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost));

  PERFORM public.set_module_setting('inventory','costing_method','"average_cost"'::jsonb);
  v_eff := public.product_effective_cost(v_prod);
  d_ok := (v_eff = v_p.average_cost);
  PERFORM public.set_module_setting('inventory','costing_method','"last_cost"'::jsonb);
  v_eff := public.product_effective_cost(v_prod);
  d_ok := d_ok AND (v_eff = v_p.last_cost);
  v_results := v_results || jsonb_build_object('d_method_toggle', d_ok);

  UPDATE public.products SET last_cost=0, average_cost=0, standard_cost=25 WHERE id = v_prod;
  v_eff := public.product_effective_cost(v_prod);
  e_ok := (v_eff = 25);
  v_results := v_results || jsonb_build_object('e_standard_cost_fallback', jsonb_build_object(
    'ok', e_ok, 'effective_cost', v_eff));

  DELETE FROM public.stock_moves WHERE product_id = v_prod;
  DELETE FROM public.stock_quants WHERE product_id = v_prod;
  DELETE FROM public.stock_pickings WHERE partner_id = v_supplier;
  DELETE FROM public.purchase_order_lines WHERE product_id = v_prod;
  DELETE FROM public.purchase_orders WHERE partner_id = v_supplier;
  DELETE FROM public.products WHERE id = v_prod;
  DELETE FROM public.partners WHERE id = v_supplier;

  v_results := v_results || jsonb_build_object('ok', a_ok AND b_ok AND c_ok AND d_ok AND e_ok);
  RETURN v_results;
END $$;
