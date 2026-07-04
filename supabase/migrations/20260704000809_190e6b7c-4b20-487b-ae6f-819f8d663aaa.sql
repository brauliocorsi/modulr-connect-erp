
-- Corrigir close_mo: mo.code em vez de mo.name
CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  mo record; produced numeric; loc uuid;
  q record; parent_mo record; before_q numeric; before_res numeric;
  v_parent_mo_id uuid; v_parent_variant_id uuid; v_parent_comp_id uuid;
  v_child_uom uuid; v_parent_uom uuid; v_conv numeric;
  v_check_cnt int; v_pass_cnt int; v_case text;
  total_consumed numeric := 0;
  dst_q record;
  v_so_id uuid; v_sol_id uuid; v_payload jsonb;
  v_material_cost numeric := 0; v_labor_cost numeric := 0;
  v_total_cost numeric := 0; v_unit_cost numeric := 0;
  v_prod_effective numeric;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO % not found', _mo; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('skip','already_done'); END IF;

  SELECT count(*), count(*) FILTER (WHERE result='pass')
    INTO v_check_cnt, v_pass_cnt
    FROM public.mo_quality_checks WHERE mo_id = _mo;
  IF v_check_cnt > 0 AND v_pass_cnt < v_check_cnt THEN
    RAISE EXCEPTION 'MO % tem controles de qualidade pendentes ou reprovados', _mo USING ERRCODE='P0001';
  END IF;

  produced := GREATEST(0, COALESCE(mo.qty_produced, mo.qty, 0));

  FOR q IN
    SELECT sm.id, sm.product_id, sm.quantity, sm.reserved_quantity,
           sq.id AS quant_id, sq.quantity AS q_qty, sq.reserved_quantity AS q_res,
           sq.location_id
      FROM public.mo_components c
      JOIN public.stock_moves sm ON sm.mo_component_id = c.id
      JOIN public.stock_quants sq ON sq.product_id = sm.product_id AND sq.location_id = sm.source_location_id
     WHERE c.mo_id = _mo AND sm.state IN ('draft','ready')
     ORDER BY sm.id FOR UPDATE OF sq, sm
  LOOP
    DECLARE take numeric := LEAST(q.reserved_quantity, q.q_res);
    BEGIN
      IF take <= 0 THEN CONTINUE; END IF;
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = GREATEST(0, quantity - take),
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.quant_id;
      UPDATE public.stock_moves
         SET reserved_quantity = GREATEST(0, reserved_quantity - take),
             state = 'done'
       WHERE id = q.id;
      total_consumed := total_consumed + take;
      v_prod_effective := public.product_effective_cost(q.product_id);
      v_material_cost := v_material_cost + take * COALESCE(v_prod_effective, 0);
    END;
  END LOOP;

  UPDATE public.mo_components c
     SET qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
   WHERE c.mo_id = _mo;

  SELECT COALESCE(SUM(
    COALESCE(op.planned_minutes, op.actual_duration_minutes, 0) / 60.0
    * COALESCE(wc.cost_per_hour, mach.cost_per_hour, 0)
  ), 0) INTO v_labor_cost
    FROM public.mo_operations op
    LEFT JOIN public.work_centers wc ON wc.id = op.work_center_id
    LEFT JOIN public.manufacturing_machines mach ON mach.id = op.machine_id
   WHERE op.mo_id = _mo;

  v_total_cost := COALESCE(v_material_cost,0) + COALESCE(v_labor_cost,0);
  IF produced > 0 THEN v_unit_cost := v_total_cost / produced; ELSE v_unit_cost := 0; END IF;

  UPDATE public.manufacturing_orders
     SET material_cost = v_material_cost,
         labor_cost = v_labor_cost,
         total_cost = v_total_cost,
         unit_cost = v_unit_cost
   WHERE id = _mo;

  PERFORM public.log_record_event('manufacturing_order', _mo,
    format('Custeio MO %s: material=%s labor=%s total=%s unit=%s (produced=%s)',
           mo.code, v_material_cost, v_labor_cost, v_total_cost, v_unit_cost, produced),
    jsonb_build_object('material_cost', v_material_cost, 'labor_cost', v_labor_cost,
      'total_cost', v_total_cost, 'unit_cost', v_unit_cost, 'produced', produced));

  loc := public.default_location(mo.warehouse_id, 'FinishedGoods');
  IF loc IS NULL THEN loc := public.default_location(mo.warehouse_id,'Stock'); END IF;
  IF loc IS NULL THEN RAISE EXCEPTION 'no destination location'; END IF;

  SELECT * INTO parent_mo FROM public.manufacturing_orders WHERE id = mo.parent_mo_id;

  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(mo.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND location_id = loc FOR UPDATE;

  IF dst_q.id IS NULL THEN
    before_res := 0;
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced, 0)
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
  ELSE
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now() WHERE id = dst_q.id;
  END IF;

  IF v_unit_cost > 0 AND produced > 0 THEN
    PERFORM public._apply_cost_update(mo.product_id, mo.variant_id, produced, v_unit_cost,
             'fecho MO', _mo, mo.code);
  ELSIF produced > 0 THEN
    PERFORM public.log_record_event('manufacturing_order', _mo,
      'Custeio MO: unit_cost=0, produto NÃO atualizado (componentes sem custo)',
      jsonb_build_object('produced', produced));
  END IF;

  IF parent_mo.id IS NOT NULL THEN v_case := 'sub_assembly';
  ELSIF mo.sale_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.sale_orders WHERE id=mo.sale_order_id AND state IN ('confirmed','draft')) THEN
    v_case := 'sale_active';
  ELSIF mo.sale_order_id IS NOT NULL THEN v_case := 'cancelled_sale';
  ELSE v_case := 'manual'; END IF;

  IF v_case = 'sub_assembly' THEN
    v_parent_mo_id := parent_mo.id;
    SELECT c.id, c.variant_id, c.uom_id INTO v_parent_comp_id, v_parent_variant_id, v_parent_uom
      FROM public.mo_components c
     WHERE c.mo_id = v_parent_mo_id AND c.product_id = mo.product_id LIMIT 1;
    SELECT uom_id INTO v_child_uom FROM public.manufacturing_orders WHERE id = _mo;
    v_conv := public.get_uom_conversion(v_child_uom, v_parent_uom);
    IF v_conv IS NULL OR v_conv <= 0 THEN v_conv := 1; END IF;
    before_res := dst_q.reserved_quantity;
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (mo.product_id, mo.variant_id, loc, 0, 0)
    ON CONFLICT DO NOTHING;
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + produced, updated_at = now()
     WHERE id = dst_q.id AND reserved_quantity + produced <= quantity;
    UPDATE public.mo_components
       SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + produced),
           updated_at = now()
     WHERE id = v_parent_comp_id;
    v_payload := jsonb_build_object('source','close_mo_subassembly_reserve_for_parent_mo',
      'mo_id', _mo, 'parent_mo_id', v_parent_mo_id, 'parent_component_id', v_parent_comp_id, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', NULL, 'close_mo → parent MO', v_payload);
  ELSIF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id; v_sol_id := mo.sale_order_line_id;
    PERFORM public.reserve_for_sale_order_line(v_sol_id, produced);
  END IF;

  UPDATE public.manufacturing_orders SET state='done', qty_produced = produced, updated_at = now() WHERE id = _mo;

  RETURN jsonb_build_object(
    'ok', true, 'produced', produced,
    'material_cost', v_material_cost, 'labor_cost', v_labor_cost,
    'total_cost', v_total_cost, 'unit_cost', v_unit_cost, 'case', v_case);
END $function$;

-- Corrigir teste: usar 'code' em vez de 'name' para MO
CREATE OR REPLACE FUNCTION public._test_costing_mfg()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wh uuid; v_loc_int uuid; v_loc_cust uuid;
  v_comp1 uuid; v_comp2 uuid; v_finished uuid; v_semi uuid;
  v_wc uuid; v_partner uuid;
  v_mo uuid; v_mo_child uuid; v_mo_parent uuid;
  v_comp1_id uuid; v_comp2_id uuid;
  v_mo_row record; v_prod record; v_margin record;
  v_so uuid; v_pick uuid; v_out_sm uuid;
  a_ok boolean; b_ok boolean; c_ok boolean; d_ok boolean; e_ok boolean;
  v_results jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  IF v_wh IS NULL THEN
    INSERT INTO public.warehouses(name, code) VALUES ('TC-WH','TCWH') RETURNING id INTO v_wh;
  END IF;
  SELECT id INTO v_loc_int FROM public.stock_locations WHERE type='internal' AND warehouse_id=v_wh LIMIT 1;
  IF v_loc_int IS NULL THEN
    INSERT INTO public.stock_locations(name, type, warehouse_id) VALUES ('TC-INT','internal',v_wh) RETURNING id INTO v_loc_int;
  END IF;
  SELECT id INTO v_loc_cust FROM public.stock_locations WHERE type='customer' LIMIT 1;
  IF v_loc_cust IS NULL THEN
    INSERT INTO public.stock_locations(name, type) VALUES ('TC-CUST','customer') RETURNING id INTO v_loc_cust;
  END IF;
  -- garante FinishedGoods location no wh (usado por default_location)
  INSERT INTO public.stock_locations(name, type, warehouse_id)
  SELECT 'FinishedGoods', 'internal', v_wh
   WHERE NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE warehouse_id=v_wh AND name='FinishedGoods');

  INSERT INTO public.work_centers(name, code, type, cost_per_hour, active)
  VALUES ('TC-WC-'||substr(gen_random_uuid()::text,1,6), 'TCWC-'||substr(gen_random_uuid()::text,1,4), 'assembly', 30, true)
  RETURNING id INTO v_wc;

  INSERT INTO public.products(name, internal_ref, type, active, standard_cost, last_cost)
  VALUES ('TC-COMP1-'||substr(gen_random_uuid()::text,1,6), 'C1-'||substr(gen_random_uuid()::text,1,6),
          'storable', true, 0, 10) RETURNING id INTO v_comp1;
  INSERT INTO public.products(name, internal_ref, type, active, standard_cost, last_cost)
  VALUES ('TC-COMP2-'||substr(gen_random_uuid()::text,1,6), 'C2-'||substr(gen_random_uuid()::text,1,6),
          'storable', true, 0, 5) RETURNING id INTO v_comp2;
  INSERT INTO public.products(name, internal_ref, type, active, standard_cost, list_price)
  VALUES ('TC-FIN-'||substr(gen_random_uuid()::text,1,6),  'F-'||substr(gen_random_uuid()::text,1,6),
          'storable', true, 0, 200) RETURNING id INTO v_finished;

  INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
  VALUES (v_comp1, v_loc_int, 100, 0), (v_comp2, v_loc_int, 100, 0);

  INSERT INTO public.manufacturing_orders(code, product_id, qty, qty_produced, warehouse_id, state)
  VALUES ('MO-TC-'||substr(gen_random_uuid()::text,1,6), v_finished, 1, 1, v_wh, 'confirmed')
  RETURNING id INTO v_mo;
  INSERT INTO public.mo_components(mo_id, product_id, qty_required, qty_reserved, sequence)
  VALUES (v_mo, v_comp1, 2, 2, 1) RETURNING id INTO v_comp1_id;
  INSERT INTO public.mo_components(mo_id, product_id, qty_required, qty_reserved, sequence)
  VALUES (v_mo, v_comp2, 3, 3, 2) RETURNING id INTO v_comp2_id;
  UPDATE public.stock_quants SET reserved_quantity = reserved_quantity + 2
    WHERE product_id = v_comp1 AND location_id = v_loc_int;
  UPDATE public.stock_quants SET reserved_quantity = reserved_quantity + 3
    WHERE product_id = v_comp2 AND location_id = v_loc_int;
  INSERT INTO public.stock_moves(product_id, source_location_id, destination_location_id,
    quantity, reserved_quantity, state, mo_component_id)
  VALUES (v_comp1, v_loc_int, v_loc_int, 2, 2, 'ready', v_comp1_id);
  INSERT INTO public.stock_moves(product_id, source_location_id, destination_location_id,
    quantity, reserved_quantity, state, mo_component_id)
  VALUES (v_comp2, v_loc_int, v_loc_int, 3, 3, 'ready', v_comp2_id);
  INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, work_center_id)
  VALUES (v_mo, 1, 'Assembly', 60, 'done', v_wc);

  PERFORM public.close_mo(v_mo);
  SELECT * INTO v_mo_row FROM public.manufacturing_orders WHERE id = v_mo;
  a_ok := (v_mo_row.material_cost = 35 AND v_mo_row.labor_cost = 30
           AND v_mo_row.total_cost = 65 AND v_mo_row.unit_cost = 65);
  v_results := v_results || jsonb_build_object('a_simple_mo', jsonb_build_object(
    'ok', a_ok, 'material', v_mo_row.material_cost, 'labor', v_mo_row.labor_cost,
    'total', v_mo_row.total_cost, 'unit', v_mo_row.unit_cost));

  SELECT last_cost, average_cost INTO v_prod FROM public.products WHERE id = v_finished;
  c_ok := (v_prod.last_cost = 65);
  v_results := v_results || jsonb_build_object('c_product_updated', jsonb_build_object(
    'ok', c_ok, 'last_cost', v_prod.last_cost, 'average_cost', v_prod.average_cost));

  -- b) chain
  INSERT INTO public.products(name, internal_ref, type, active, standard_cost)
  VALUES ('TC-SEMI-'||substr(gen_random_uuid()::text,1,6), 'S-'||substr(gen_random_uuid()::text,1,6),
          'storable', true, 0) RETURNING id INTO v_semi;
  INSERT INTO public.manufacturing_orders(code, product_id, qty, qty_produced, warehouse_id, state)
  VALUES ('MO-CHILD-'||substr(gen_random_uuid()::text,1,6), v_semi, 1, 1, v_wh, 'confirmed')
  RETURNING id INTO v_mo_child;
  INSERT INTO public.mo_components(mo_id, product_id, qty_required, qty_reserved, sequence)
  VALUES (v_mo_child, v_comp1, 1, 1, 1) RETURNING id INTO v_comp1_id;
  UPDATE public.stock_quants SET reserved_quantity = reserved_quantity + 1
    WHERE product_id = v_comp1 AND location_id = v_loc_int;
  INSERT INTO public.stock_moves(product_id, source_location_id, destination_location_id,
    quantity, reserved_quantity, state, mo_component_id)
  VALUES (v_comp1, v_loc_int, v_loc_int, 1, 1, 'ready', v_comp1_id);
  PERFORM public.close_mo(v_mo_child);

  INSERT INTO public.manufacturing_orders(code, product_id, qty, qty_produced, warehouse_id, state)
  VALUES ('MO-PARENT-'||substr(gen_random_uuid()::text,1,6), v_finished, 1, 1, v_wh, 'confirmed')
  RETURNING id INTO v_mo_parent;
  INSERT INTO public.mo_components(mo_id, product_id, qty_required, qty_reserved, sequence)
  VALUES (v_mo_parent, v_semi, 1, 1, 1) RETURNING id INTO v_comp1_id;
  UPDATE public.stock_quants SET reserved_quantity = reserved_quantity + 1
    WHERE product_id = v_semi;
  INSERT INTO public.stock_moves(product_id, source_location_id, destination_location_id,
    quantity, reserved_quantity, state, mo_component_id)
  SELECT v_semi, sq.location_id, sq.location_id, 1, 1, 'ready', v_comp1_id
    FROM public.stock_quants sq WHERE sq.product_id = v_semi LIMIT 1;
  PERFORM public.close_mo(v_mo_parent);
  SELECT * INTO v_mo_row FROM public.manufacturing_orders WHERE id = v_mo_parent;
  b_ok := (v_mo_row.material_cost = 10);
  v_results := v_results || jsonb_build_object('b_chain_semi', jsonb_build_object(
    'ok', b_ok, 'child_unit', (SELECT unit_cost FROM manufacturing_orders WHERE id=v_mo_child),
    'parent_material', v_mo_row.material_cost));

  -- d) delivery + margin
  INSERT INTO public.partners(name, is_customer) VALUES ('TC-CUST-P-'||substr(gen_random_uuid()::text,1,6), true)
    RETURNING id INTO v_partner;
  INSERT INTO public.sale_orders(name, partner_id, state, amount_untaxed)
  VALUES ('SO-TC-'||substr(gen_random_uuid()::text,1,6), v_partner, 'confirmed', 200)
  RETURNING id INTO v_so;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('OUT-TC-'||substr(gen_random_uuid()::text,1,6), 'outgoing', 'ready', v_wh,
      v_loc_int, v_loc_cust, v_partner, (SELECT name FROM sale_orders WHERE id=v_so), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state)
  VALUES (v_pick, v_finished, v_loc_int, v_loc_cust, 1, 1, 'ready')
  RETURNING id INTO v_out_sm;
  UPDATE public.stock_moves SET state='done' WHERE id = v_out_sm;
  UPDATE public.stock_pickings SET state='done', done_at=now() WHERE id = v_pick;

  SELECT unit_cost INTO v_prod.last_cost FROM public.stock_moves WHERE id = v_out_sm;
  SELECT * INTO v_margin FROM public.v_sale_margin WHERE sale_order_id = v_so;
  d_ok := (v_prod.last_cost = 65 AND v_margin.revenue = 200
           AND v_margin.cogs = 65 AND v_margin.margin_value = 135);
  v_results := v_results || jsonb_build_object('d_delivery_margin', jsonb_build_object(
    'ok', d_ok, 'move_unit_cost', v_prod.last_cost,
    'revenue', v_margin.revenue, 'cogs', v_margin.cogs, 'margin', v_margin.margin_value));

  -- e) zero cost
  DECLARE v_zero_prod uuid; v_zero_comp uuid; v_zero_mo uuid; v_zero_last numeric;
  BEGIN
    INSERT INTO public.products(name, internal_ref, type, active, standard_cost)
    VALUES ('TC-ZC-'||substr(gen_random_uuid()::text,1,6),'ZC-'||substr(gen_random_uuid()::text,1,6),
            'storable', true, 0) RETURNING id INTO v_zero_comp;
    INSERT INTO public.products(name, internal_ref, type, active, standard_cost, last_cost)
    VALUES ('TC-ZF-'||substr(gen_random_uuid()::text,1,6),'ZF-'||substr(gen_random_uuid()::text,1,6),
            'storable', true, 0, 99) RETURNING id INTO v_zero_prod;
    INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
    VALUES (v_zero_comp, v_loc_int, 10, 1);
    INSERT INTO public.manufacturing_orders(code, product_id, qty, qty_produced, warehouse_id, state)
    VALUES ('MO-ZERO-'||substr(gen_random_uuid()::text,1,6), v_zero_prod, 1, 1, v_wh, 'confirmed')
    RETURNING id INTO v_zero_mo;
    INSERT INTO public.mo_components(mo_id, product_id, qty_required, qty_reserved, sequence)
    VALUES (v_zero_mo, v_zero_comp, 1, 1, 1) RETURNING id INTO v_comp1_id;
    INSERT INTO public.stock_moves(product_id, source_location_id, destination_location_id,
      quantity, reserved_quantity, state, mo_component_id)
    VALUES (v_zero_comp, v_loc_int, v_loc_int, 1, 1, 'ready', v_comp1_id);
    PERFORM public.close_mo(v_zero_mo);
    SELECT unit_cost INTO v_prod.last_cost FROM public.manufacturing_orders WHERE id = v_zero_mo;
    SELECT last_cost INTO v_zero_last FROM public.products WHERE id = v_zero_prod;
    e_ok := (v_prod.last_cost = 0 AND v_zero_last = 99);
    v_results := v_results || jsonb_build_object('e_zero_cost_noop', jsonb_build_object(
      'ok', e_ok, 'mo_unit_cost', v_prod.last_cost, 'product_last_cost_unchanged', v_zero_last));
  END;

  v_results := v_results || jsonb_build_object('f_reruns', jsonb_build_object(
    'supply', (public._test_supply_canonical_path()->>'ok')::boolean,
    'mfg', (public._test_mfg_fixes()->>'ok')::boolean,
    'delivery', (public._test_delivery_cash_fixes()->>'ok')::boolean,
    'costing_purchase', (public._test_costing_purchase()->>'ok')::boolean));

  v_results := v_results || jsonb_build_object('ok',
    COALESCE(a_ok,false) AND COALESCE(b_ok,false) AND COALESCE(c_ok,false)
    AND COALESCE(d_ok,false) AND COALESCE(e_ok,false));
  RETURN v_results;
END $$;
