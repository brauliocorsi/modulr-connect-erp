CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  done_qty numeric;
  leftover numeric;
  src record;
  dst_q record;
  cur_picking record;
  upstream_pending int;
  bo_id uuid;
  bo_name text;
  bo_suffix int := 1;
  has_leftover boolean := false;
BEGIN
  SELECT * INTO cur_picking FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferência não encontrada';
  END IF;

  IF cur_picking.origin IS NOT NULL AND cur_picking.source_location_id IS NOT NULL THEN
    SELECT count(*) INTO upstream_pending
    FROM public.stock_pickings p
    WHERE p.origin = cur_picking.origin
      AND p.id <> _picking
      AND p.destination_location_id = cur_picking.source_location_id
      AND p.state NOT IN ('done','cancelled');
    IF upstream_pending > 0 THEN
      RAISE EXCEPTION 'Não é possível validar: a etapa anterior da cadeia ainda não foi concluída.';
    END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.stock_moves
    WHERE picking_id = _picking
      AND state <> 'cancelled'
      AND quantity_done < quantity
  ) INTO has_leftover;

  IF has_leftover THEN
    bo_name := cur_picking.name || '-BO';
    WHILE EXISTS(SELECT 1 FROM public.stock_pickings WHERE name = bo_name) LOOP
      bo_suffix := bo_suffix + 1;
      bo_name := cur_picking.name || '-BO' || bo_suffix;
    END LOOP;

    INSERT INTO public.stock_pickings(
      name, kind, state, warehouse_id, source_location_id, destination_location_id,
      partner_id, origin, scheduled_at, backorder_id, previous_picking_id, step_label
    ) VALUES (
      bo_name, cur_picking.kind, 'ready', cur_picking.warehouse_id,
      cur_picking.source_location_id, cur_picking.destination_location_id,
      cur_picking.partner_id, cur_picking.origin, now(), _picking,
      cur_picking.previous_picking_id, cur_picking.step_label
    ) RETURNING id INTO bo_id;
  END IF;

  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = _picking AND state <> 'cancelled' LOOP
    done_qty := COALESCE(m.quantity_done, m.quantity);
    leftover := GREATEST(0, m.quantity - done_qty);

    IF done_qty > 0 THEN
      DECLARE remaining numeric := done_qty;
      BEGIN
        FOR src IN
          SELECT * FROM public.stock_quants
          WHERE product_id = m.product_id
            AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
            AND location_id = m.source_location_id
          ORDER BY updated_at
        LOOP
          EXIT WHEN remaining <= 0;
          IF src.quantity <= 0 AND src.reserved_quantity <= 0 THEN CONTINUE; END IF;
          DECLARE take numeric := LEAST(remaining, src.quantity);
          BEGIN
            UPDATE public.stock_quants
               SET quantity = quantity - take,
                   reserved_quantity = GREATEST(0, reserved_quantity - take),
                   updated_at = now()
             WHERE id = src.id;
            remaining := remaining - take;
          END;
        END LOOP;
        IF remaining > 0 THEN
          INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
          VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -remaining);
        END IF;
      END;

      SELECT * INTO dst_q FROM public.stock_quants
        WHERE product_id = m.product_id
          AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
          AND location_id = m.destination_location_id
          AND COALESCE(lot_id::text,'') = COALESCE(m.lot_id::text,'')
        LIMIT 1;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity = quantity + done_qty, updated_at=now() WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, done_qty);
      END IF;

      -- Update the original line to reflect what was actually received
      UPDATE public.stock_moves SET state='done', quantity = done_qty, quantity_done = done_qty WHERE id = m.id;
    END IF;

    IF leftover > 0 AND bo_id IS NOT NULL THEN
      INSERT INTO public.stock_moves(
        picking_id, product_id, variant_id, lot_id, uom_id,
        source_location_id, destination_location_id, quantity, quantity_done, state, reference
      ) VALUES (
        bo_id, m.product_id, m.variant_id, NULL, m.uom_id,
        m.source_location_id, m.destination_location_id, leftover, 0, 'ready', m.reference
      );

      -- If the original had nothing received, remove it from the source picking
      IF done_qty = 0 THEN
        DELETE FROM public.stock_moves WHERE id = m.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.stock_pickings SET state='done', done_at=now() WHERE id = _picking;
  PERFORM public.log_record_event('stock_picking', _picking, 'Transferência validada', '{}'::jsonb);
  IF bo_id IS NOT NULL THEN
    PERFORM public.log_record_event('stock_picking', bo_id, 'Backorder criado', jsonb_build_object('from', _picking));
  END IF;
END $function$;