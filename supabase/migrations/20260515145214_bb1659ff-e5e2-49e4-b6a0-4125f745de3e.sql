
-- 1. Fix mutable search_path on legacy functions
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;
ALTER FUNCTION public.default_location(uuid, text) SET search_path = public;
ALTER FUNCTION public.default_warehouse_id() SET search_path = public;
ALTER FUNCTION public.customer_location_id() SET search_path = public;
ALTER FUNCTION public.supplier_location_id() SET search_path = public;

-- 2. Make legacy views security_invoker (respect querying user's RLS)
ALTER VIEW public.v_product_stock_full SET (security_invoker = true);
ALTER VIEW public.sale_order_fulfillment SET (security_invoker = true);
ALTER VIEW public.product_stock_forecast SET (security_invoker = true);

-- 3. Unique partial indexes on products
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_uniq
  ON public.products (barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_internal_ref_uniq
  ON public.products (internal_ref) WHERE internal_ref IS NOT NULL;

-- 4. Restrict set_product_stock to admins only
CREATE OR REPLACE FUNCTION public.set_product_stock(_product uuid, _warehouse uuid, _qty numeric, _reason text DEFAULT 'Ajuste manual'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  loc uuid;
  current_qty numeric;
  diff numeric;
  q record;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem ajustar stock manualmente' USING ERRCODE = '42501';
  END IF;

  loc := public.default_location(_warehouse, 'Stock');
  IF loc IS NULL THEN RAISE EXCEPTION 'Localização Stock não encontrada para armazém'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO current_qty
    FROM public.stock_quants WHERE product_id = _product AND location_id = loc;
  diff := _qty - current_qty;
  IF diff = 0 THEN RETURN current_qty; END IF;

  IF diff > 0 THEN
    SELECT * INTO q FROM public.stock_quants
      WHERE product_id = _product AND location_id = loc AND lot_id IS NULL LIMIT 1;
    IF FOUND THEN
      UPDATE public.stock_quants SET quantity = quantity + diff, updated_at = now() WHERE id = q.id;
    ELSE
      INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (_product, loc, diff);
    END IF;
  ELSE
    INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (_product, loc, diff);
  END IF;

  PERFORM public.log_record_event('product', _product,
    format('Stock ajustado para %s (Δ %s) — %s', _qty, diff, _reason), '{}'::jsonb);
  RETURN _qty;
END $function$;

-- 5. Helper for purchase managers
CREATE OR REPLACE FUNCTION public.purchase_can_manage(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_group(_uid,'system_admin') OR public.has_group(_uid,'purchase_manager');
$$;

-- 6. Tighten permissive RLS on stores (admin only for write)
DROP POLICY IF EXISTS stores_insert ON public.stores;
DROP POLICY IF EXISTS stores_update ON public.stores;
CREATE POLICY stores_insert ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (public.has_group(auth.uid(),'system_admin'));
CREATE POLICY stores_update ON public.stores
  FOR UPDATE TO authenticated
  USING (public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (public.has_group(auth.uid(),'system_admin'));

-- 7. Tighten permissive RLS on purchase_needs (admin or purchase manager)
DROP POLICY IF EXISTS pn_insert ON public.purchase_needs;
DROP POLICY IF EXISTS pn_update ON public.purchase_needs;
DROP POLICY IF EXISTS pn_delete ON public.purchase_needs;
CREATE POLICY pn_insert ON public.purchase_needs
  FOR INSERT TO authenticated
  WITH CHECK (public.purchase_can_manage(auth.uid()));
CREATE POLICY pn_update ON public.purchase_needs
  FOR UPDATE TO authenticated
  USING (public.purchase_can_manage(auth.uid()))
  WITH CHECK (public.purchase_can_manage(auth.uid()));
CREATE POLICY pn_delete ON public.purchase_needs
  FOR DELETE TO authenticated
  USING (public.purchase_can_manage(auth.uid()));
