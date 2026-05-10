ALTER TABLE public.stock_pickings REPLICA IDENTITY FULL;
ALTER TABLE public.stock_moves REPLICA IDENTITY FULL;
ALTER TABLE public.sale_orders REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_orders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_pickings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_moves;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;