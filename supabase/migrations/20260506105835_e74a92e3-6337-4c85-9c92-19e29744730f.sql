-- Tracking enum
DO $$ BEGIN
  CREATE TYPE product_tracking AS ENUM ('none','lot','serial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tracking product_tracking NOT NULL DEFAULT 'none';

-- Replace validate_picking to enforce lot when tracking != 'none'
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  prod record;
BEGIN
  FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking LOOP
    SELECT tracking INTO prod FROM products WHERE id = m.product_id;
    IF prod.tracking IS DISTINCT FROM 'none' AND m.lot_id IS NULL AND COALESCE(m.quantity_done,0) > 0 THEN
      RAISE EXCEPTION 'Produto rastreado por % requer lote/série no movimento', prod.tracking;
    END IF;

    IF COALESCE(m.quantity_done,0) > 0 THEN
      -- decrement source
      UPDATE stock_quants
        SET quantity = quantity - m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.source_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -m.quantity_done);
      END IF;

      -- increment destination
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

    UPDATE stock_moves SET state = 'done' WHERE id = m.id;
  END LOOP;

  UPDATE stock_pickings SET state = 'done', done_at = now() WHERE id = _picking;
END;
$$;