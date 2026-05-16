
ALTER TABLE public.sale_order_line_supply_links DROP CONSTRAINT IF EXISTS sale_order_line_supply_links_purchase_need_id_fkey;
ALTER TABLE public.sale_order_line_supply_links ADD CONSTRAINT sale_order_line_supply_links_purchase_need_id_fkey
  FOREIGN KEY (purchase_need_id) REFERENCES public.purchase_needs(id) ON DELETE CASCADE;

ALTER TABLE public.sale_order_line_supply_links DROP CONSTRAINT IF EXISTS sale_order_line_supply_links_manufacturing_order_id_fkey;
ALTER TABLE public.sale_order_line_supply_links ADD CONSTRAINT sale_order_line_supply_links_manufacturing_order_id_fkey
  FOREIGN KEY (manufacturing_order_id) REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE;

ALTER TABLE public.sale_order_line_supply_links DROP CONSTRAINT IF EXISTS sale_order_line_supply_links_origin_line_id_fkey;
ALTER TABLE public.sale_order_line_supply_links ADD CONSTRAINT sale_order_line_supply_links_origin_line_id_fkey
  FOREIGN KEY (origin_line_id) REFERENCES public.sale_order_lines(id) ON DELETE CASCADE;

ALTER TABLE public.sale_order_line_supply_links DROP CONSTRAINT IF EXISTS sale_order_line_supply_links_inherited_from_line_id_fkey;
ALTER TABLE public.sale_order_line_supply_links ADD CONSTRAINT sale_order_line_supply_links_inherited_from_line_id_fkey
  FOREIGN KEY (inherited_from_line_id) REFERENCES public.sale_order_lines(id) ON DELETE SET NULL;
