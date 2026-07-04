
-- ============================================================
-- Parte 1: get/set module settings
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_module_setting(_module text, _key text, _default jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM public.app_settings WHERE key = _module || '.' || _key), _default);
$$;

CREATE OR REPLACE FUNCTION public.set_module_setting(_module text, _key text, _value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid; v_bypass boolean;
BEGIN
  v_uid := auth.uid();
  v_bypass := current_user IN ('postgres','service_role','supabase_admin');
  IF NOT v_bypass AND NOT public.has_group(v_uid, 'system_admin') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.app_settings(key, value, updated_at, updated_by)
  VALUES (_module || '.' || _key, _value, now(), v_uid)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = v_uid;
  RETURN _value;
END $$;

GRANT EXECUTE ON FUNCTION public.get_module_setting(text,text,jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_module_setting(text,text,jsonb) TO authenticated;

-- Seed inventory.costing_method (idempotent)
INSERT INTO public.app_settings(key, value, description)
VALUES ('inventory.costing_method', '"last_cost"'::jsonb,
        'Método de custeio do inventário: "last_cost" (último preço recebido) ou "average_cost" (custo médio móvel).')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Parte 2: colunas de custo no produto
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.product_effective_cost(_product uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE method text; p record; chosen numeric;
BEGIN
  method := trim(both '"' FROM public.get_module_setting('inventory','costing_method','"last_cost"'::jsonb)::text);
  SELECT last_cost, average_cost, standard_cost INTO p FROM public.products WHERE id = _product;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF method = 'average_cost' THEN chosen := COALESCE(p.average_cost, 0);
  ELSE chosen := COALESCE(p.last_cost, 0);
  END IF;
  IF chosen > 0 THEN RETURN chosen; END IF;
  RETURN COALESCE(p.standard_cost, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.product_effective_cost(uuid) TO authenticated, anon, service_role;

-- ============================================================
-- Parte 4: trigger de atualização de custos na receção
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_zz_costing_on_po_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m record; v_unit_price numeric; v_qty numeric;
  v_prev_last numeric; v_prev_avg numeric;
  v_onhand_after numeric; v_onhand_before numeric; v_new_avg numeric;
BEGIN
  IF NEW.kind <> 'incoming' OR NEW.state <> 'done'
     OR COALESCE(OLD.state::text,'') = 'done' THEN
    RETURN NEW;
  END IF;

  FOR m IN
    SELECT sm.product_id, sm.purchase_order_line_id,
           COALESCE(sm.quantity_done, sm.quantity, 0) AS qty,
           pol.unit_price
      FROM public.stock_moves sm
      JOIN public.purchase_order_lines pol ON pol.id = sm.purchase_order_line_id
     WHERE sm.picking_id = NEW.id
       AND sm.state = 'done'
       AND sm.product_id IS NOT NULL
  LOOP
    v_unit_price := COALESCE(m.unit_price, 0);
    v_qty := COALESCE(m.qty, 0);
    IF v_unit_price <= 0 OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT last_cost, average_cost INTO v_prev_last, v_prev_avg
      FROM public.products WHERE id = m.product_id FOR UPDATE;

    -- onhand APÓS a entrada (quants já foram incrementados pelo validate_picking)
    SELECT COALESCE(SUM(sq.quantity),0) INTO v_onhand_after
      FROM public.stock_quants sq
      JOIN public.stock_locations sl ON sl.id = sq.location_id
     WHERE sq.product_id = m.product_id AND sl.type = 'internal';
    v_onhand_before := v_onhand_after - v_qty;

    IF v_onhand_before <= 0 THEN
      v_new_avg := v_unit_price;
    ELSE
      v_new_avg := (v_onhand_before * COALESCE(v_prev_avg,0) + v_qty * v_unit_price)
                   / (v_onhand_before + v_qty);
    END IF;

    UPDATE public.products
       SET last_cost = v_unit_price,
           average_cost = v_new_avg,
           cost_updated_at = now()
     WHERE id = m.product_id;

    PERFORM public.log_record_event(
      'product', m.product_id,
      format('Custo atualizado por receção %s: last %s→%s, avg %s→%s',
             NEW.name, COALESCE(v_prev_last,0), v_unit_price, COALESCE(v_prev_avg,0), v_new_avg),
      jsonb_build_object(
        'picking_id', NEW.id, 'picking_name', NEW.name,
        'qty_received', v_qty, 'unit_price', v_unit_price,
        'onhand_before', v_onhand_before, 'onhand_after', v_onhand_after,
        'prev_last_cost', v_prev_last, 'prev_average_cost', v_prev_avg,
        'new_average_cost', v_new_avg
      )
    );
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_zz_costing_on_po_receipt ON public.stock_pickings;
CREATE TRIGGER tg_zz_costing_on_po_receipt
  AFTER UPDATE OF state ON public.stock_pickings
  FOR EACH ROW EXECUTE FUNCTION public.tg_zz_costing_on_po_receipt();

-- ============================================================
-- Parte 5: teste de regressão
-- ============================================================
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
  -- a) get_module_setting fallback
  IF public.get_module_setting('__notexist__','__k__','"D"'::jsonb) = '"D"'::jsonb THEN
    a_ok := true;
  ELSE
    a_ok := false;
  END IF;
  v_results := v_results || jsonb_build_object('a_default_fallback', a_ok);

  -- Setup: fake product + supplier partner + warehouse locations
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

  INSERT INTO public.products(name, sku, type, can_be_purchased, active, standard_cost)
  VALUES ('TEST-COSTING-'||substr(gen_random_uuid()::text,1,8), 'T-COST-'||substr(gen_random_uuid()::text,1,6),
          'product', true, true, 0)
  RETURNING id INTO v_prod;

  INSERT INTO public.partners(name, is_supplier)
  VALUES ('TEST-SUPP-'||substr(gen_random_uuid()::text,1,8), true)
  RETURNING id INTO v_supplier;

  -- b) primeira receção a 50, sem stock prévio → last=50, avg=50
  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TEST-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 10, 50, 1) RETURNING id INTO v_pol;

  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TEST-'||substr(gen_random_uuid()::text,1,6), 'incoming', 'ready', v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;

  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 10, 10, 'ready', v_pol)
  RETURNING id INTO v_move;

  -- Simular done: incrementar quants + atualizar picking (dispara trigger)
  INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
  VALUES (v_prod, v_loc_int, 10, 0)
  ON CONFLICT DO NOTHING;
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  b_ok := (v_p.last_cost = 50 AND v_p.average_cost = 50);
  v_results := v_results || jsonb_build_object('b1_first_receipt', jsonb_build_object(
    'ok', b_ok, 'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost));

  -- Segunda receção a 60 com 10 em stock → last=60, avg=(10*50+10*60)/20=55
  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TEST2-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 10, 60, 1) RETURNING id INTO v_pol;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TEST2-'||substr(gen_random_uuid()::text,1,6),'incoming','ready',v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 10, 10, 'ready', v_pol)
  RETURNING id INTO v_move;
  UPDATE public.stock_quants SET quantity = quantity + 10
    WHERE product_id = v_prod AND location_id = v_loc_int;
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  b_ok := b_ok AND (v_p.last_cost = 60 AND abs(v_p.average_cost - 55) < 0.001);
  v_results := v_results || jsonb_build_object('b2_second_receipt', jsonb_build_object(
    'ok', (v_p.last_cost=60 AND abs(v_p.average_cost-55)<0.001),
    'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost, 'expected_avg', 55));

  -- c) receção com unit_price=0 → sem alteração
  SELECT last_cost, average_cost INTO v_before_last, v_before_avg FROM public.products WHERE id = v_prod;
  INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id)
  VALUES ('PO-TEST3-'||substr(gen_random_uuid()::text,1,6), v_supplier, 'confirmed', v_wh)
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price, sequence)
  VALUES (v_po, v_prod, 5, 0, 1) RETURNING id INTO v_pol;
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id,
      source_location_id, destination_location_id, partner_id, origin, scheduled_at)
  VALUES ('IN-TEST3-'||substr(gen_random_uuid()::text,1,6),'incoming','ready',v_wh,
      v_loc_sup, v_loc_int, v_supplier,
      (SELECT name FROM public.purchase_orders WHERE id=v_po), now())
  RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id, product_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, purchase_order_line_id)
  VALUES (v_pick, v_prod, v_loc_sup, v_loc_int, 5, 5, 'ready', v_pol) RETURNING id INTO v_move;
  UPDATE public.stock_quants SET quantity = quantity + 5
    WHERE product_id = v_prod AND location_id = v_loc_int;
  UPDATE public.stock_moves SET state='done' WHERE id = v_move;
  UPDATE public.stock_pickings SET state='done' WHERE id = v_pick;

  SELECT last_cost, average_cost INTO v_p FROM public.products WHERE id = v_prod;
  c_ok := (v_p.last_cost = v_before_last AND v_p.average_cost = v_before_avg);
  v_results := v_results || jsonb_build_object('c_zero_price_noop', jsonb_build_object(
    'ok', c_ok, 'last_cost', v_p.last_cost, 'average_cost', v_p.average_cost));

  -- d) alternar método
  PERFORM public.set_module_setting('inventory','costing_method','"average_cost"'::jsonb);
  v_eff := public.product_effective_cost(v_prod);
  d_ok := (v_eff = v_p.average_cost);
  PERFORM public.set_module_setting('inventory','costing_method','"last_cost"'::jsonb);
  v_eff := public.product_effective_cost(v_prod);
  d_ok := d_ok AND (v_eff = v_p.last_cost);
  v_results := v_results || jsonb_build_object('d_method_toggle', d_ok);

  -- e) fallback para standard_cost
  UPDATE public.products SET last_cost=0, average_cost=0, standard_cost=25 WHERE id = v_prod;
  v_eff := public.product_effective_cost(v_prod);
  e_ok := (v_eff = 25);
  v_results := v_results || jsonb_build_object('e_standard_cost_fallback', jsonb_build_object(
    'ok', e_ok, 'effective_cost', v_eff));

  -- cleanup
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

GRANT EXECUTE ON FUNCTION public._test_costing_purchase() TO authenticated, service_role;
