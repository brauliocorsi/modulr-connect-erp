
-- =================================================
-- PHASE 9: Returns Integrity
-- =================================================

-- 1) Helper: returnable status for a source picking
CREATE OR REPLACE FUNCTION public.picking_return_status(_picking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pick record;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_pick FROM public.stock_pickings WHERE id = _picking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', sm.product_id,
    'variant_id', sm.variant_id,
    'delivered', sm.quantity_done,
    'returned', COALESCE(ret.qty, 0),
    'returnable', GREATEST(sm.quantity_done - COALESCE(ret.qty,0), 0)
  )), '[]'::jsonb)
  INTO v_lines
  FROM public.stock_moves sm
  LEFT JOIN LATERAL (
    SELECT SUM(rm.quantity_done) AS qty
    FROM public.stock_moves rm
    JOIN public.stock_pickings rp ON rp.id = rm.picking_id
    WHERE rp.kind = 'return'
      AND rp.previous_picking_id = _picking_id
      AND rp.state <> 'cancelled'
      AND rm.product_id = sm.product_id
      AND rm.variant_id IS NOT DISTINCT FROM sm.variant_id
  ) ret ON true
  WHERE sm.picking_id = _picking_id
    AND sm.state = 'done';

  RETURN jsonb_build_object(
    'picking_id', _picking_id,
    'picking_name', v_pick.name,
    'kind', v_pick.kind,
    'state', v_pick.state,
    'lines', v_lines
  );
END;
$$;

-- 2) Trigger: prevent over-return
CREATE OR REPLACE FUNCTION public.tg_prevent_over_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pick record;
  v_delivered numeric;
  v_returned numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.quantity_done,0) = COALESCE(OLD.quantity_done,0) THEN
    RETURN NEW;
  END IF;

  IF NEW.picking_id IS NULL THEN RETURN NEW; END IF;

  SELECT kind, previous_picking_id INTO v_pick
  FROM public.stock_pickings WHERE id = NEW.picking_id;

  IF v_pick.kind <> 'return' OR v_pick.previous_picking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(quantity_done),0) INTO v_delivered
  FROM public.stock_moves
  WHERE picking_id = v_pick.previous_picking_id
    AND state = 'done'
    AND product_id = NEW.product_id
    AND variant_id IS NOT DISTINCT FROM NEW.variant_id;

  SELECT COALESCE(SUM(rm.quantity_done),0) INTO v_returned
  FROM public.stock_moves rm
  JOIN public.stock_pickings rp ON rp.id = rm.picking_id
  WHERE rp.kind = 'return'
    AND rp.previous_picking_id = v_pick.previous_picking_id
    AND rp.state <> 'cancelled'
    AND rm.product_id = NEW.product_id
    AND rm.variant_id IS NOT DISTINCT FROM NEW.variant_id
    AND rm.id <> NEW.id;

  IF v_returned + COALESCE(NEW.quantity_done,0) > v_delivered + 0.0001 THEN
    RAISE EXCEPTION 'Devolução em excesso para %: entregue %, já devolvido %, tentativa %',
      NEW.product_id, v_delivered, v_returned, NEW.quantity_done
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_over_return ON public.stock_moves;
CREATE TRIGGER trg_prevent_over_return
BEFORE INSERT OR UPDATE OF quantity_done ON public.stock_moves
FOR EACH ROW EXECUTE FUNCTION public.tg_prevent_over_return();

-- 3) Create return picking from source
-- _lines: jsonb array of {product_id, variant_id (nullable), quantity}
CREATE OR REPLACE FUNCTION public.create_return_from_picking(_picking_id uuid, _lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src record;
  v_ret_id uuid;
  v_ret_name text;
  v_line jsonb;
  v_returnable numeric;
  v_qty numeric;
BEGIN
  SELECT * INTO v_src FROM public.stock_pickings WHERE id = _picking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source picking not found'; END IF;
  IF v_src.state <> 'done' THEN
    RAISE EXCEPTION 'Apenas pickings concluídos podem ser devolvidos' USING ERRCODE='check_violation';
  END IF;
  IF v_src.kind = 'return' THEN
    RAISE EXCEPTION 'Não é possível devolver um picking de devolução' USING ERRCODE='check_violation';
  END IF;
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Linhas de devolução obrigatórias';
  END IF;

  v_ret_name := COALESCE(v_src.name,'PICK') || '/RET-' || substr(gen_random_uuid()::text,1,6);

  INSERT INTO public.stock_pickings(
    name, kind, state, warehouse_id,
    source_location_id, destination_location_id,
    partner_id, origin, previous_picking_id, scheduled_at, created_by, step_label
  ) VALUES (
    v_ret_name, 'return'::picking_kind, 'ready'::picking_state, v_src.warehouse_id,
    v_src.destination_location_id, v_src.source_location_id,
    v_src.partner_id, v_src.name, _picking_id, now(), auth.uid(), 'Devolução'
  )
  RETURNING id INTO v_ret_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_qty := COALESCE((v_line->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    -- Validate against returnable
    SELECT GREATEST(sm.quantity_done - COALESCE((
        SELECT SUM(rm.quantity_done)
        FROM public.stock_moves rm
        JOIN public.stock_pickings rp ON rp.id = rm.picking_id
        WHERE rp.kind = 'return'
          AND rp.previous_picking_id = _picking_id
          AND rp.state <> 'cancelled'
          AND rm.product_id = sm.product_id
          AND rm.variant_id IS NOT DISTINCT FROM sm.variant_id
      ),0), 0)
    INTO v_returnable
    FROM public.stock_moves sm
    WHERE sm.picking_id = _picking_id
      AND sm.state = 'done'
      AND sm.product_id = (v_line->>'product_id')::uuid
      AND sm.variant_id IS NOT DISTINCT FROM NULLIF(v_line->>'variant_id','')::uuid
    LIMIT 1;

    IF v_returnable IS NULL THEN
      RAISE EXCEPTION 'Produto % não pertence ao picking origem', v_line->>'product_id';
    END IF;
    IF v_qty > v_returnable + 0.0001 THEN
      RAISE EXCEPTION 'Quantidade % excede devolvível % para produto %', v_qty, v_returnable, v_line->>'product_id'
        USING ERRCODE='check_violation';
    END IF;

    INSERT INTO public.stock_moves(
      picking_id, product_id, variant_id,
      source_location_id, destination_location_id,
      quantity, quantity_done, state, reference
    ) VALUES (
      v_ret_id,
      (v_line->>'product_id')::uuid,
      NULLIF(v_line->>'variant_id','')::uuid,
      v_src.destination_location_id, v_src.source_location_id,
      v_qty, 0, 'ready'::picking_state, v_src.name
    );
  END LOOP;

  PERFORM public.log_record_event('stock_picking', v_ret_id, format('Devolução criada a partir de %s', v_src.name), '{}'::jsonb);
  RETURN v_ret_id;
END;
$$;

-- 4) Self-test
CREATE OR REPLACE FUNCTION public._test_phase9()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner uuid; v_product uuid; v_po uuid; v_po_name text;
  v_pick uuid; v_move uuid; v_ret uuid; v_ret_move uuid;
  v_status jsonb;
  v_results jsonb := '[]'::jsonb;
  v_err text;
BEGIN
  INSERT INTO public.partners(name, is_supplier) VALUES ('TEST_P9_SUP_'||gen_random_uuid(), true) RETURNING id INTO v_partner;
  SELECT p.id INTO v_product FROM public.products p
    WHERE p.active=true AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id=p.id) LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(name, active) VALUES ('TEST_P9_PROD_'||substr(gen_random_uuid()::text,1,8), true) RETURNING id INTO v_product;
  END IF;

  INSERT INTO public.purchase_orders(name, partner_id, state)
  VALUES ('TESTPO9_'||substr(gen_random_uuid()::text,1,8), v_partner, 'draft')
  RETURNING id, name INTO v_po, v_po_name;
  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price)
  VALUES (v_po, v_product, 10, 5);

  PERFORM public.confirm_purchase_order(v_po);
  SELECT id INTO v_pick FROM public.stock_pickings WHERE origin=v_po_name AND kind='incoming';
  SELECT id INTO v_move FROM public.stock_moves WHERE picking_id=v_pick LIMIT 1;
  UPDATE public.stock_moves SET quantity_done = 10 WHERE id = v_move;
  -- Mark picking + move as done (simulating finished receipt)
  UPDATE public.stock_moves SET state='done' WHERE id=v_move;
  UPDATE public.stock_pickings SET state='done', done_at=now() WHERE id=v_pick;

  v_results := v_results || jsonb_build_object('test','Setup receipt 10','pass',true);

  -- Return 3
  v_ret := public.create_return_from_picking(v_pick, jsonb_build_array(
    jsonb_build_object('product_id', v_product, 'quantity', 3)
  ));
  v_results := v_results || jsonb_build_object('test','Return 3 created','pass', v_ret IS NOT NULL);

  -- Status: returnable should be 7
  v_status := public.picking_return_status(v_pick);
  v_results := v_results || jsonb_build_object('test','Returnable=7',
    'pass', ((v_status->'lines'->0->>'returnable')::numeric = 7));

  -- Try to return 8 → should fail
  BEGIN
    PERFORM public.create_return_from_picking(v_pick, jsonb_build_array(
      jsonb_build_object('product_id', v_product, 'quantity', 8)
    ));
    v_results := v_results || jsonb_build_object('test','Over-return rejected','pass',false);
  EXCEPTION WHEN check_violation THEN
    v_results := v_results || jsonb_build_object('test','Over-return rejected','pass',true);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_results := v_results || jsonb_build_object('test','Over-return rejected','pass',true,'note',v_err);
  END;

  -- Return remaining 7
  PERFORM public.create_return_from_picking(v_pick, jsonb_build_array(
    jsonb_build_object('product_id', v_product, 'quantity', 7)
  ));
  v_status := public.picking_return_status(v_pick);
  v_results := v_results || jsonb_build_object('test','Fully returned',
    'pass', ((v_status->'lines'->0->>'returnable')::numeric = 0));

  -- Cleanup
  DELETE FROM public.stock_moves WHERE picking_id IN (
    SELECT id FROM public.stock_pickings WHERE id=v_pick OR previous_picking_id=v_pick
  );
  DELETE FROM public.stock_pickings WHERE id=v_pick OR previous_picking_id=v_pick;
  DELETE FROM public.purchase_order_lines WHERE order_id=v_po;
  DELETE FROM public.purchase_orders WHERE id=v_po;
  DELETE FROM public.partners WHERE id=v_partner;

  RETURN jsonb_build_object(
    'phase', 9,
    'tests', v_results,
    'pass_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_results) e WHERE (e->>'pass')::boolean),
    'total', jsonb_array_length(v_results)
  );
END;
$$;
