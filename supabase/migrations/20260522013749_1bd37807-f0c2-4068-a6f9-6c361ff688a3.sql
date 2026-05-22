
-- Garante REPLICA IDENTITY FULL para receber row completa em UPDATE/DELETE.
ALTER TABLE public.delivery_routes REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_schedules REPLICA IDENTITY FULL;
ALTER TABLE public.delivery_route_orders REPLICA IDENTITY FULL;
ALTER TABLE public.dock_transfers REPLICA IDENTITY FULL;
ALTER TABLE public.vehicle_route_manifest REPLICA IDENTITY FULL;
ALTER TABLE public.stock_packages REPLICA IDENTITY FULL;
ALTER TABLE public.customer_payments REPLICA IDENTITY FULL;
ALTER TABLE public.cash_movements REPLICA IDENTITY FULL;

-- Adiciona à publication (idempotente).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'delivery_routes','delivery_schedules','delivery_route_orders','dock_transfers',
    'vehicle_route_manifest','stock_packages','customer_payments','cash_movements'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
