
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  street text,
  city text,
  zip text,
  country text DEFAULT 'PT',
  phone text,
  email text,
  tax_id text,
  warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_view ON public.stores FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_insert ON public.stores FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'core'::app_module, 'stores', 'create'::permission_action) OR has_group(auth.uid(), 'system_admin'));
CREATE POLICY stores_update ON public.stores FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'core'::app_module, 'stores', 'edit'::permission_action) OR has_group(auth.uid(), 'system_admin'));
CREATE POLICY stores_delete ON public.stores FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'core'::app_module, 'stores', 'delete'::permission_action) OR has_group(auth.uid(), 'system_admin'));

CREATE OR REPLACE FUNCTION public.stores_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_touch_updated_at();

CREATE TABLE public.store_members (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);

ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_members_view ON public.store_members FOR SELECT TO authenticated USING (true);
CREATE POLICY store_members_manage ON public.store_members FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'core'::app_module, 'stores', 'edit'::permission_action) OR has_group(auth.uid(), 'system_admin'))
  WITH CHECK (has_permission(auth.uid(), 'core'::app_module, 'stores', 'edit'::permission_action) OR has_group(auth.uid(), 'system_admin'));

ALTER TABLE public.sale_orders ADD COLUMN store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;
ALTER TABLE public.cash_registers ADD COLUMN store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX idx_sale_orders_store ON public.sale_orders(store_id);
CREATE INDEX idx_cash_registers_store ON public.cash_registers(store_id);
