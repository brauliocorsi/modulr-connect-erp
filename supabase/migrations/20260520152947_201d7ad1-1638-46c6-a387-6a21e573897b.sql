DROP VIEW IF EXISTS public.sale_orders_with_schedule_summary;
CREATE VIEW public.sale_orders_with_schedule_summary AS
SELECT
  so.id AS id,
  so.id AS sale_order_id,
  so.name,
  so.partner_id,
  so.state,
  so.fulfillment_status,
  so.payment_status,
  so.invoice_status,
  so.operational_status,
  so.commitment_date,
  so.amount_total,
  so.date_order,
  so.store_id,
  so.delivery_mode,
  so.include_delivery,
  so.include_assembly,
  so.delivery_zone_label,
  ds.id AS schedule_id,
  ds.scheduled_date,
  ds.slot_start,
  ds.slot_end,
  ds.status AS schedule_status,
  (ds.id IS NOT NULL AND ds.status NOT IN ('requested') AND ds.cancelled_at IS NULL) AS schedule_confirmed,
  ds.route_id,
  dr.route_date AS route_date,
  dr.route_type AS route_type
FROM public.sale_orders so
LEFT JOIN LATERAL (
  SELECT * FROM public.delivery_schedules d
  WHERE d.sale_order_id = so.id AND d.cancelled_at IS NULL
  ORDER BY d.scheduled_date DESC NULLS LAST, d.created_at DESC
  LIMIT 1
) ds ON true
LEFT JOIN public.delivery_routes dr ON dr.id = ds.route_id;

ALTER VIEW public.sale_orders_with_schedule_summary SET (security_invoker = on);
GRANT SELECT ON public.sale_orders_with_schedule_summary TO authenticated;