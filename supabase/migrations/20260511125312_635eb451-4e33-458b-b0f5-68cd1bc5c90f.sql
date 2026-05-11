-- Fix validate_picking to track quants per variant (not just per product)
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  m record;
  done_qty numeric;
  src record;
  dst_q record;
BEGIN
  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = _picking AND state <> 'cancelled' LOOP
    done_qty := COALESCE(NULLIF(m.quantity_done,0), m.quantity);

    -- decrement source matching variant
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

    -- increment destination matching variant
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
END $$;

-- Recompute quants from done moves for products that have variants
-- This fixes existing rows where variant qty was lumped under variant_id = NULL
CREATE OR REPLACE FUNCTION public.recompute_variant_quants()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pid uuid;
BEGIN
  FOR pid IN
    SELECT DISTINCT pv.product_id
    FROM public.product_variants pv
    WHERE pv.active
  LOOP
    -- Wipe existing quants for this product, then rebuild from done moves
    DELETE FROM public.stock_quants WHERE product_id = pid;

    INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity, reserved_quantity)
    SELECT pid, variant_id, location_id, lot_id, SUM(qty), 0
    FROM (
      SELECT m.variant_id, m.destination_location_id AS location_id, m.lot_id,
             COALESCE(NULLIF(m.quantity_done,0), m.quantity) AS qty
      FROM public.stock_moves m
      WHERE m.product_id = pid AND m.state = 'done'
      UNION ALL
      SELECT m.variant_id, m.source_location_id AS location_id, m.lot_id,
             -COALESCE(NULLIF(m.quantity_done,0), m.quantity) AS qty
      FROM public.stock_moves m
      WHERE m.product_id = pid AND m.state = 'done'
    ) t
    GROUP BY variant_id, location_id, lot_id
    HAVING SUM(qty) <> 0;
  END LOOP;
END $$;

-- Run it once to fix current data
SELECT public.recompute_variant_quants();