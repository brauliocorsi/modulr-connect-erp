-- 1) Add guard: cannot validate a picking if upstream chain step (same origin, dest = this source) is not done
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  done_qty numeric;
  src record;
  dst_q record;
  cur_picking record;
  upstream_pending int;
BEGIN
  SELECT * INTO cur_picking FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferência não encontrada';
  END IF;

  -- Guard: any earlier picking in same origin chain whose destination = our source and not done?
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

  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = _picking AND state <> 'cancelled' LOOP
    done_qty := COALESCE(NULLIF(m.quantity_done,0), m.quantity);

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

    UPDATE public.stock_moves SET state='done', quantity_done = done_qty WHERE id = m.id;
  END LOOP;

  UPDATE public.stock_pickings SET state='done', done_at=now() WHERE id = _picking;
  PERFORM public.log_record_event('stock_picking', _picking, 'Transferência validada', '{}'::jsonb);
END $function$;

-- 2) Backfill WH/OUT/00005 chain: mark stage 1 done; remove phantom stock at Stock and Cais de Carga
DO $$
DECLARE
  p_id uuid;
  m record;
BEGIN
  SELECT id INTO p_id FROM public.stock_pickings WHERE name='WH/OUT/00005';
  IF p_id IS NULL THEN RETURN; END IF;

  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = p_id AND state <> 'cancelled' LOOP
    -- Decrement Stock (source) by quantity_done (or quantity)
    UPDATE public.stock_quants
       SET quantity = quantity - COALESCE(NULLIF(m.quantity_done,0), m.quantity),
           reserved_quantity = GREATEST(0, reserved_quantity - COALESCE(NULLIF(m.quantity_done,0), m.quantity)),
           updated_at = now()
     WHERE product_id = m.product_id
       AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
       AND location_id = m.source_location_id;

    -- Remove phantom at Cais (destination): the next picking already shipped it out, so net should be 0
    UPDATE public.stock_quants
       SET reserved_quantity = GREATEST(0, reserved_quantity - COALESCE(NULLIF(m.quantity_done,0), m.quantity)),
           updated_at = now()
     WHERE product_id = m.product_id
       AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
       AND location_id = m.destination_location_id;

    UPDATE public.stock_moves SET state='done', quantity_done = COALESCE(NULLIF(m.quantity_done,0), m.quantity) WHERE id = m.id;
  END LOOP;

  UPDATE public.stock_pickings SET state='done', done_at=COALESCE(done_at, now()) WHERE id = p_id;
END $$;