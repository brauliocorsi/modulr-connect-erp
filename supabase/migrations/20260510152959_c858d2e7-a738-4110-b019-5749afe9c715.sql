
CREATE OR REPLACE VIEW public.sale_order_fulfillment AS
WITH lines AS (
  SELECT order_id, COALESCE(SUM(quantity),0) AS qty_total
  FROM public.sale_order_lines
  WHERE line_kind = 'product'
  GROUP BY order_id
),
moves AS (
  SELECT so.id AS order_id,
    COALESCE(SUM(CASE WHEN sm.state = 'ready' THEN sm.quantity ELSE 0 END),0) AS qty_reserved,
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

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sale_orders WHERE state IN ('confirmed','done') LOOP
    PERFORM public.recalc_so_fulfillment(r.id);
  END LOOP;
END $$;
