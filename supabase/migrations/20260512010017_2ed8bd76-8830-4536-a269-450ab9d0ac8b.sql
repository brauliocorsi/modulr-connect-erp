-- Multi-package (colis) per product
CREATE TABLE IF NOT EXISTS public.product_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1,
  label text NOT NULL,
  barcode text UNIQUE,
  weight_kg numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_packages_product_idx ON public.product_packages(product_id);

ALTER TABLE public.product_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_packages_view ON public.product_packages FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'view'::permission_action));
CREATE POLICY product_packages_insert ON public.product_packages FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'create'::permission_action));
CREATE POLICY product_packages_update ON public.product_packages FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'edit'::permission_action));
CREATE POLICY product_packages_delete ON public.product_packages FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'delete'::permission_action));

-- Track stock and moves per colis
ALTER TABLE public.stock_quants ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.product_packages(id) ON DELETE SET NULL;
ALTER TABLE public.stock_moves  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.product_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stock_quants_package_idx ON public.stock_quants(package_id);
CREATE INDEX IF NOT EXISTS stock_moves_package_idx  ON public.stock_moves(package_id);