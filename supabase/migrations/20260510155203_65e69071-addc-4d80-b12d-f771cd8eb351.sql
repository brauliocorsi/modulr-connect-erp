CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  prod record;
  pk record;
  bo_id uuid;
  bo_name text;
  seq_code text;
  has_shortage boolean := false;
  total_done numeric := 0;
  total_requested numeric := 0;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking not found'; END IF;

  -- Pre-check: prevent divergences when nothing has been moved
  SELECT COALESCE(SUM(COALESCE(quantity_done,0)),0), COALESCE(SUM(COALESCE(quantity,0)),0)
    INTO total_done, total_requested
    FROM stock_moves WHERE picking_id = _picking;

  IF total_requested > 0 AND total_done = 0 THEN
    RAISE EXCEPTION 'Não é possível validar: todas as quantidades movimentadas estão a 0. Informe a quantidade efetivamente movimentada antes de validar.'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking LOOP
    SELECT tracking INTO prod FROM products WHERE id = m.product_id;
    IF prod.tracking IS DISTINCT FROM 'none' AND m.lot_id IS NULL AND COALESCE(m.quantity_done,0) > 0 THEN
      RAISE EXCEPTION 'Produto rastreado por % requer lote/série no movimento', prod.tracking;
    END IF;

    IF COALESCE(m.quantity_done,0) > 0 THEN
      UPDATE stock_quants
        SET quantity = quantity - m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.source_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -m.quantity_done);
      END IF;

      UPDATE stock_quants
        SET quantity = quantity + m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.destination_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, m.quantity_done);
      END IF;
    END IF;

    IF COALESCE(m.quantity_done,0) < m.quantity THEN
      has_shortage := true;
    END IF;

    UPDATE stock_moves SET state = 'done' WHERE id = m.id;
  END LOOP;

  IF has_shortage THEN
    seq_code := CASE pk.kind
      WHEN 'incoming' THEN 'picking_in'
      WHEN 'outgoing' THEN 'picking_out'
      ELSE 'picking_int'
    END;
    bo_name := public.next_sequence(seq_code);
    INSERT INTO public.stock_pickings(
      name, kind, state, warehouse_id, source_location_id, destination_location_id,
      partner_id, origin, scheduled_at, backorder_id, created_by
    ) VALUES (
      bo_name, pk.kind, 'ready'::picking_state, pk.warehouse_id,
      pk.source_location_id, pk.destination_location_id,
      pk.partner_id, pk.origin, now(), pk.id, pk.created_by
    ) RETURNING id INTO bo_id;

    INSERT INTO public.stock_moves(
      picking_id, product_id, variant_id, source_location_id, destination_location_id,
      quantity, quantity_done, state
    )
    SELECT bo_id, product_id, variant_id, source_location_id, destination_location_id,
           (quantity - COALESCE(quantity_done,0)), 0, 'ready'::stock_move_state
    FROM stock_moves
    WHERE picking_id = _picking AND COALESCE(quantity_done,0) < quantity;
  END IF;

  UPDATE stock_pickings SET state = 'done', done_at = now() WHERE id = _picking;
END;
$function$;