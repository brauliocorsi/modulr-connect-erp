ALTER TABLE public.sale_order_lines REPLICA IDENTITY FULL;
ALTER TABLE public.purchase_order_lines REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_order_lines;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_order_lines;