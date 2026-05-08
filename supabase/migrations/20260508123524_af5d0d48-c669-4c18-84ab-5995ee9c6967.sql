
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending';

CREATE OR REPLACE VIEW public.sale_order_fulfillment AS
WITH lines AS (
  SELECT order_id, COALESCE(SUM(quantity),0) AS qty_total
  FROM public.sale_order_lines GROUP BY order_id
),
moves AS (
  SELECT so.id AS order_id,
    COALESCE(SUM(CASE WHEN sm.state IN ('ready','waiting') THEN sm.quantity ELSE 0 END),0) AS qty_reserved,
    COALESCE(SUM(CASE WHEN sm.state = 'done' THEN COALESCE(sm.quantity_done, sm.quantity) ELSE 0 END),0) AS qty_done
  FROM public.sale_orders so
  LEFT JOIN public.stock_pickings sp ON sp.origin = so.name AND sp.kind = 'outgoing'
  LEFT JOIN public.stock_moves sm ON sm.picking_id = sp.id
  GROUP BY so.id
),
po_inc AS (
  SELECT so.id AS order_id,
    COALESCE(SUM(CASE WHEN po.state IN ('draft','rfq_sent','confirmed') THEN pol.quantity ELSE 0 END),0) AS qty_incoming,
    BOOL_OR(po.state = 'confirmed') AS any_confirmed,
    BOOL_OR(po.state IN ('draft','rfq_sent')) AS any_draft
  FROM public.sale_orders so
  LEFT JOIN public.purchase_orders po ON po.origin = so.name
  LEFT JOIN public.purchase_order_lines pol ON pol.order_id = po.id
  GROUP BY so.id
)
SELECT so.id AS order_id, so.state,
  COALESCE(l.qty_total,0) AS qty_total,
  COALESCE(m.qty_reserved,0) AS qty_reserved,
  COALESCE(m.qty_done,0) AS qty_done,
  COALESCE(p.qty_incoming,0) AS qty_incoming,
  COALESCE(p.any_confirmed,false) AS po_any_confirmed,
  COALESCE(p.any_draft,false) AS po_any_draft
FROM public.sale_orders so
LEFT JOIN lines l ON l.order_id = so.id
LEFT JOIN moves m ON m.order_id = so.id
LEFT JOIN po_inc p ON p.order_id = so.id;

CREATE OR REPLACE FUNCTION public.recalc_so_fulfillment(_so uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; new_status text;
BEGIN
  SELECT * INTO r FROM public.sale_order_fulfillment WHERE order_id = _so;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.state::text = 'cancelled' THEN
    UPDATE public.sale_orders SET fulfillment_status = 'cancelled' WHERE id = _so;
    RETURN;
  END IF;
  IF r.state::text IN ('draft','sent') THEN
    UPDATE public.sale_orders SET fulfillment_status = 'pending' WHERE id = _so;
    RETURN;
  END IF;
  IF r.qty_total = 0 THEN new_status := 'pending';
  ELSIF r.qty_done >= r.qty_total THEN new_status := 'delivered';
  ELSIF r.qty_reserved >= r.qty_total THEN new_status := 'ready';
  ELSIF (r.qty_reserved + r.qty_done) > 0 AND r.qty_incoming > 0 THEN new_status := 'partial';
  ELSIF r.qty_incoming > 0 AND r.po_any_confirmed THEN new_status := 'purchased';
  ELSIF r.qty_incoming > 0 AND r.po_any_draft THEN new_status := 'backordered';
  ELSE new_status := 'pending';
  END IF;
  UPDATE public.sale_orders SET fulfillment_status = new_status
   WHERE id = _so AND fulfillment_status IS DISTINCT FROM new_status;
END $$;

CREATE OR REPLACE FUNCTION public.tg_recalc_from_picking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE so_id uuid;
BEGIN
  IF COALESCE(NEW.origin, OLD.origin) IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO so_id FROM public.sale_orders WHERE name = COALESCE(NEW.origin, OLD.origin);
  IF so_id IS NOT NULL THEN PERFORM public.recalc_so_fulfillment(so_id); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_recalc_from_move()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE so_id uuid; pk_origin text;
BEGIN
  SELECT origin INTO pk_origin FROM public.stock_pickings WHERE id = COALESCE(NEW.picking_id, OLD.picking_id);
  IF pk_origin IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO so_id FROM public.sale_orders WHERE name = pk_origin;
  IF so_id IS NOT NULL THEN PERFORM public.recalc_so_fulfillment(so_id); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_recalc_from_po()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE so_id uuid;
BEGIN
  IF COALESCE(NEW.origin, OLD.origin) IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO so_id FROM public.sale_orders WHERE name = COALESCE(NEW.origin, OLD.origin);
  IF so_id IS NOT NULL THEN PERFORM public.recalc_so_fulfillment(so_id); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recalc_from_picking ON public.stock_pickings;
CREATE TRIGGER trg_recalc_from_picking
AFTER INSERT OR UPDATE OF state ON public.stock_pickings
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_from_picking();

DROP TRIGGER IF EXISTS trg_recalc_from_move ON public.stock_moves;
CREATE TRIGGER trg_recalc_from_move
AFTER INSERT OR UPDATE OF state, quantity_done ON public.stock_moves
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_from_move();

DROP TRIGGER IF EXISTS trg_recalc_from_po ON public.purchase_orders;
CREATE TRIGGER trg_recalc_from_po
AFTER INSERT OR UPDATE OF state ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_from_po();

CREATE INDEX IF NOT EXISTS idx_pickings_scheduled_at ON public.stock_pickings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_pickings_state ON public.stock_pickings(state);
CREATE INDEX IF NOT EXISTS idx_moves_state ON public.stock_moves(state);
CREATE INDEX IF NOT EXISTS idx_moves_created_at ON public.stock_moves(created_at);
CREATE INDEX IF NOT EXISTS idx_po_origin ON public.purchase_orders(origin);
CREATE INDEX IF NOT EXISTS idx_pickings_origin ON public.stock_pickings(origin);
CREATE INDEX IF NOT EXISTS idx_so_fulfillment_status ON public.sale_orders(fulfillment_status);

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.sale_orders LOOP
    PERFORM public.recalc_so_fulfillment(r.id);
  END LOOP;
END $$;
