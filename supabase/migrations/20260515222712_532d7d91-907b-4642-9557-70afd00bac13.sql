
-- Use rm.quantity (planned) instead of quantity_done so that a created (ready) return immediately reserves the qty
CREATE OR REPLACE FUNCTION public.picking_return_status(_picking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_pick record; v_lines jsonb;
BEGIN
  SELECT * INTO v_pick FROM public.stock_pickings WHERE id=_picking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', sm.product_id,
    'variant_id', sm.variant_id,
    'delivered', sm.quantity_done,
    'returned', COALESCE(ret.qty,0),
    'returnable', GREATEST(sm.quantity_done - COALESCE(ret.qty,0), 0)
  )), '[]'::jsonb)
  INTO v_lines
  FROM public.stock_moves sm
  LEFT JOIN LATERAL (
    SELECT SUM(rm.quantity) AS qty
    FROM public.stock_moves rm
    JOIN public.stock_pickings rp ON rp.id=rm.picking_id
    WHERE rp.kind='return' AND rp.previous_picking_id=_picking_id AND rp.state<>'cancelled'
      AND rm.product_id=sm.product_id
      AND rm.variant_id IS NOT DISTINCT FROM sm.variant_id
  ) ret ON true
  WHERE sm.picking_id=_picking_id AND sm.state='done';

  RETURN jsonb_build_object('picking_id',_picking_id,'picking_name',v_pick.name,'kind',v_pick.kind,'state',v_pick.state,'lines',v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_prevent_over_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_pick record; v_delivered numeric; v_returned numeric; v_qty numeric;
BEGIN
  v_qty := COALESCE(NEW.quantity,0);
  IF TG_OP='UPDATE' AND v_qty = COALESCE(OLD.quantity,0) AND COALESCE(NEW.quantity_done,0)=COALESCE(OLD.quantity_done,0) THEN
    RETURN NEW;
  END IF;
  IF NEW.picking_id IS NULL THEN RETURN NEW; END IF;
  SELECT kind, previous_picking_id INTO v_pick FROM public.stock_pickings WHERE id=NEW.picking_id;
  IF v_pick.kind<>'return' OR v_pick.previous_picking_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity_done),0) INTO v_delivered
  FROM public.stock_moves
  WHERE picking_id=v_pick.previous_picking_id AND state='done'
    AND product_id=NEW.product_id
    AND variant_id IS NOT DISTINCT FROM NEW.variant_id;

  SELECT COALESCE(SUM(rm.quantity),0) INTO v_returned
  FROM public.stock_moves rm
  JOIN public.stock_pickings rp ON rp.id=rm.picking_id
  WHERE rp.kind='return' AND rp.previous_picking_id=v_pick.previous_picking_id
    AND rp.state<>'cancelled'
    AND rm.product_id=NEW.product_id
    AND rm.variant_id IS NOT DISTINCT FROM NEW.variant_id
    AND rm.id<>NEW.id;

  IF v_returned + v_qty > v_delivered + 0.0001 THEN
    RAISE EXCEPTION 'Devolução em excesso para %: entregue %, já devolvido %, tentativa %',
      NEW.product_id, v_delivered, v_returned, v_qty
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_return_from_picking(_picking_id uuid, _lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_src record; v_ret_id uuid; v_ret_name text; v_line jsonb;
  v_returnable numeric; v_qty numeric;
BEGIN
  SELECT * INTO v_src FROM public.stock_pickings WHERE id=_picking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source picking not found'; END IF;
  IF v_src.state<>'done' THEN RAISE EXCEPTION 'Apenas pickings concluídos podem ser devolvidos' USING ERRCODE='check_violation'; END IF;
  IF v_src.kind='return' THEN RAISE EXCEPTION 'Não é possível devolver um picking de devolução' USING ERRCODE='check_violation'; END IF;
  IF jsonb_typeof(_lines)<>'array' OR jsonb_array_length(_lines)=0 THEN RAISE EXCEPTION 'Linhas obrigatórias'; END IF;

  v_ret_name := COALESCE(v_src.name,'PICK')||'/RET-'||substr(gen_random_uuid()::text,1,6);
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id,
    partner_id, origin, previous_picking_id, scheduled_at, created_by, step_label)
  VALUES (v_ret_name,'return'::picking_kind,'ready'::picking_state, v_src.warehouse_id,
    v_src.destination_location_id, v_src.source_location_id, v_src.partner_id,
    v_src.name, _picking_id, now(), auth.uid(), 'Devolução')
  RETURNING id INTO v_ret_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_qty := COALESCE((v_line->>'quantity')::numeric,0);
    IF v_qty<=0 THEN CONTINUE; END IF;

    SELECT GREATEST(sm.quantity_done - COALESCE((
      SELECT SUM(rm.quantity) FROM public.stock_moves rm
      JOIN public.stock_pickings rp ON rp.id=rm.picking_id
      WHERE rp.kind='return' AND rp.previous_picking_id=_picking_id AND rp.state<>'cancelled'
        AND rm.product_id=sm.product_id
        AND rm.variant_id IS NOT DISTINCT FROM sm.variant_id
    ),0), 0)
    INTO v_returnable
    FROM public.stock_moves sm
    WHERE sm.picking_id=_picking_id AND sm.state='done'
      AND sm.product_id=(v_line->>'product_id')::uuid
      AND sm.variant_id IS NOT DISTINCT FROM NULLIF(v_line->>'variant_id','')::uuid
    LIMIT 1;

    IF v_returnable IS NULL THEN
      RAISE EXCEPTION 'Produto % não pertence ao picking origem', v_line->>'product_id';
    END IF;
    IF v_qty > v_returnable + 0.0001 THEN
      RAISE EXCEPTION 'Quantidade % excede devolvível % para produto %', v_qty, v_returnable, v_line->>'product_id'
        USING ERRCODE='check_violation';
    END IF;

    INSERT INTO public.stock_moves(picking_id, product_id, variant_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, reference)
    VALUES (v_ret_id, (v_line->>'product_id')::uuid, NULLIF(v_line->>'variant_id','')::uuid,
      v_src.destination_location_id, v_src.source_location_id, v_qty, 0, 'ready'::picking_state, v_src.name);
  END LOOP;

  PERFORM public.log_record_event('stock_picking', v_ret_id, format('Devolução criada a partir de %s', v_src.name),'{}'::jsonb);
  RETURN v_ret_id;
END;
$$;
