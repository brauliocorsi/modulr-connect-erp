
DROP INDEX IF EXISTS public.uq_delivery_schedules_active_per_so;
CREATE UNIQUE INDEX uq_delivery_schedules_active_per_so
  ON public.delivery_schedules(sale_order_id)
  WHERE status NOT IN ('cancelled','delivered','rescheduled');
