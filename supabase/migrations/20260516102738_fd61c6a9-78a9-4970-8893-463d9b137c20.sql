
-- =========================================================
-- Fase 15.2 — M2.5 Migration 1: Package Layer schema
-- =========================================================

-- ---------- ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.package_condition AS ENUM ('good','damaged','quarantine','missing','repaired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.package_status AS ENUM (
    'expected','received','produced','available','reserved',
    'picked','at_dock','loaded','delivered','returned','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pallet_status AS ENUM ('active','moved','closed','damaged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.package_damage_status AS ENUM (
    'reported','in_quarantine','in_repair','repaired','scrapped','replaced'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- APP SETTINGS (feature flags) ----------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read ON public.app_settings;
CREATE POLICY app_settings_read ON public.app_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS app_settings_write ON public.app_settings;
CREATE POLICY app_settings_write ON public.app_settings FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

INSERT INTO public.app_settings(key,value,description)
VALUES ('package_tracking_enabled','false'::jsonb,
        'Fase 15.2: quando true, ready_delivery passa a exigir stock_packages obrigatórios. OFF por defeito.')
ON CONFLICT (key) DO NOTHING;

-- ---------- product_package_templates ----------
CREATE TABLE IF NOT EXISTS public.product_package_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  package_sequence int NOT NULL CHECK (package_sequence >= 1),
  package_total int NOT NULL CHECK (package_total >= 1),
  package_group text,
  default_weight_kg numeric(10,3),
  default_volume_m3 numeric(10,4),
  default_assembly_minutes int,
  requires_assembly boolean NOT NULL DEFAULT false,
  is_required boolean NOT NULL DEFAULT true,
  barcode_pattern text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_package_templates_seq_le_total CHECK (package_sequence <= package_total),
  CONSTRAINT product_package_templates_unique UNIQUE (product_id, package_sequence)
);
CREATE INDEX IF NOT EXISTS idx_ppt_product ON public.product_package_templates(product_id) WHERE active;

ALTER TABLE public.product_package_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppt_read ON public.product_package_templates;
CREATE POLICY ppt_read ON public.product_package_templates FOR SELECT USING (true);
DROP POLICY IF EXISTS ppt_write ON public.product_package_templates;
CREATE POLICY ppt_write ON public.product_package_templates FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

-- ---------- warehouse_bins ----------
CREATE TABLE IF NOT EXISTS public.warehouse_bins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.stock_locations(id) ON DELETE CASCADE,
  code text NOT NULL,
  rack text,
  level text,
  position text,
  barcode text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_bins_code_unique UNIQUE (location_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wbins_barcode ON public.warehouse_bins(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wbins_loc ON public.warehouse_bins(location_id);

ALTER TABLE public.warehouse_bins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wbins_read ON public.warehouse_bins;
CREATE POLICY wbins_read ON public.warehouse_bins FOR SELECT USING (true);
DROP POLICY IF EXISTS wbins_write ON public.warehouse_bins;
CREATE POLICY wbins_write ON public.warehouse_bins FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

-- ---------- warehouse_pallets ----------
CREATE TABLE IF NOT EXISTS public.warehouse_pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  current_location_id uuid NOT NULL REFERENCES public.stock_locations(id),
  current_bin_id uuid REFERENCES public.warehouse_bins(id),
  code text NOT NULL,
  barcode text,
  status public.pallet_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_pallets_code_unique UNIQUE (warehouse_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wpallets_barcode ON public.warehouse_pallets(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wpallets_loc ON public.warehouse_pallets(current_location_id);

ALTER TABLE public.warehouse_pallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wpallets_read ON public.warehouse_pallets;
CREATE POLICY wpallets_read ON public.warehouse_pallets FOR SELECT USING (true);
DROP POLICY IF EXISTS wpallets_write ON public.warehouse_pallets;
CREATE POLICY wpallets_write ON public.warehouse_pallets FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

-- ---------- stock_packages ----------
CREATE TABLE IF NOT EXISTS public.stock_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  package_template_id uuid REFERENCES public.product_package_templates(id),

  sale_order_id uuid REFERENCES public.sale_orders(id),
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id),
  purchase_order_id uuid REFERENCES public.purchase_orders(id),
  purchase_order_line_id uuid REFERENCES public.purchase_order_lines(id),
  manufacturing_order_id uuid REFERENCES public.manufacturing_orders(id),

  package_ref text,
  package_sequence int,
  package_total int,
  package_group text,

  qty numeric(14,3) NOT NULL DEFAULT 1,
  barcode text,

  current_location_id uuid NOT NULL REFERENCES public.stock_locations(id),
  current_bin_id uuid REFERENCES public.warehouse_bins(id),
  current_pallet_id uuid REFERENCES public.warehouse_pallets(id),

  condition public.package_condition NOT NULL DEFAULT 'good',
  status public.package_status NOT NULL DEFAULT 'available',

  is_virtual boolean NOT NULL DEFAULT false,
  generated_virtual_package boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_packages_barcode ON public.stock_packages(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_product ON public.stock_packages(product_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_packages_so_line ON public.stock_packages(sale_order_line_id) WHERE sale_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_po_line ON public.stock_packages(purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_mo ON public.stock_packages(manufacturing_order_id) WHERE manufacturing_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_loc ON public.stock_packages(current_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_packages_bin ON public.stock_packages(current_bin_id) WHERE current_bin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_pallet ON public.stock_packages(current_pallet_id) WHERE current_pallet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_condition ON public.stock_packages(condition, status);

ALTER TABLE public.stock_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_packages_read ON public.stock_packages;
CREATE POLICY stock_packages_read ON public.stock_packages FOR SELECT USING (true);
DROP POLICY IF EXISTS stock_packages_write ON public.stock_packages;
CREATE POLICY stock_packages_write ON public.stock_packages FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

-- ---------- stock_package_movements (audit, append-only) ----------
CREATE TABLE IF NOT EXISTS public.stock_package_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_package_id uuid NOT NULL REFERENCES public.stock_packages(id) ON DELETE CASCADE,
  stock_move_id uuid REFERENCES public.stock_moves(id),
  from_location_id uuid REFERENCES public.stock_locations(id),
  to_location_id uuid NOT NULL REFERENCES public.stock_locations(id),
  from_bin_id uuid REFERENCES public.warehouse_bins(id),
  to_bin_id uuid REFERENCES public.warehouse_bins(id),
  from_pallet_id uuid REFERENCES public.warehouse_pallets(id),
  to_pallet_id uuid REFERENCES public.warehouse_pallets(id),
  moved_qty numeric(14,3) NOT NULL DEFAULT 1,
  reason text,
  moved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spm_package ON public.stock_package_movements(stock_package_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spm_idempotent
  ON public.stock_package_movements(stock_package_id, stock_move_id)
  WHERE stock_move_id IS NOT NULL;

ALTER TABLE public.stock_package_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spm_read ON public.stock_package_movements;
CREATE POLICY spm_read ON public.stock_package_movements FOR SELECT USING (true);
DROP POLICY IF EXISTS spm_insert ON public.stock_package_movements;
CREATE POLICY spm_insert ON public.stock_package_movements FOR INSERT
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));
-- No UPDATE / DELETE policies → immutable log.

-- ---------- package_damage_reports ----------
CREATE TABLE IF NOT EXISTS public.package_damage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_package_id uuid NOT NULL REFERENCES public.stock_packages(id) ON DELETE CASCADE,
  sale_order_id uuid REFERENCES public.sale_orders(id),
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id),
  route_id uuid,
  delivery_schedule_id uuid,
  reported_by uuid,
  damage_type text,
  description text,
  photos jsonb,
  status public.package_damage_status NOT NULL DEFAULT 'reported',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pdr_package ON public.package_damage_reports(stock_package_id);
CREATE INDEX IF NOT EXISTS idx_pdr_status ON public.package_damage_reports(status);

ALTER TABLE public.package_damage_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdr_read ON public.package_damage_reports;
CREATE POLICY pdr_read ON public.package_damage_reports FOR SELECT USING (true);
DROP POLICY IF EXISTS pdr_write ON public.package_damage_reports;
CREATE POLICY pdr_write ON public.package_damage_reports FOR ALL
  USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

-- ---------- updated_at touch ----------
CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS tg_ppt_touch ON public.product_package_templates;
CREATE TRIGGER tg_ppt_touch BEFORE UPDATE ON public.product_package_templates
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS tg_wbins_touch ON public.warehouse_bins;
CREATE TRIGGER tg_wbins_touch BEFORE UPDATE ON public.warehouse_bins
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS tg_wpallets_touch ON public.warehouse_pallets;
CREATE TRIGGER tg_wpallets_touch BEFORE UPDATE ON public.warehouse_pallets
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS tg_stock_packages_touch ON public.stock_packages;
CREATE TRIGGER tg_stock_packages_touch BEFORE UPDATE ON public.stock_packages
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS tg_pdr_touch ON public.package_damage_reports;
CREATE TRIGGER tg_pdr_touch BEFORE UPDATE ON public.package_damage_reports
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS tg_app_settings_touch ON public.app_settings;
CREATE TRIGGER tg_app_settings_touch BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ---------- Protection trigger: only package_move() may change location ----------
CREATE OR REPLACE FUNCTION public._tg_stock_packages_lock_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_via_move text;
BEGIN
  BEGIN
    v_via_move := current_setting('app.package_move', true);
  EXCEPTION WHEN OTHERS THEN
    v_via_move := NULL;
  END;

  IF v_via_move IS DISTINCT FROM '1' THEN
    IF NEW.current_location_id IS DISTINCT FROM OLD.current_location_id
       OR NEW.current_bin_id IS DISTINCT FROM OLD.current_bin_id
       OR NEW.current_pallet_id IS DISTINCT FROM OLD.current_pallet_id THEN
      RAISE EXCEPTION 'stock_packages location/bin/pallet may only be changed via package_move()';
    END IF;
  END IF;

  IF NEW.current_location_id IS NULL THEN
    RAISE EXCEPTION 'stock_packages.current_location_id cannot be NULL';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_stock_packages_lock_location ON public.stock_packages;
CREATE TRIGGER tg_stock_packages_lock_location
  BEFORE UPDATE ON public.stock_packages
  FOR EACH ROW EXECUTE FUNCTION public._tg_stock_packages_lock_location();

-- ---------- package_move(): the only legitimate way to move a package ----------
CREATE OR REPLACE FUNCTION public.package_move(
  _package_id uuid,
  _to_location_id uuid,
  _to_bin_id uuid DEFAULT NULL,
  _to_pallet_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL,
  _stock_move_id uuid DEFAULT NULL,
  _moved_qty numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.stock_packages%ROWTYPE;
  v_existing uuid;
  v_mov_id uuid;
  v_qty numeric;
BEGIN
  IF _to_location_id IS NULL THEN
    RAISE EXCEPTION 'package_move: _to_location_id cannot be NULL';
  END IF;

  SELECT * INTO v_pkg FROM public.stock_packages WHERE id = _package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_move: package % not found', _package_id;
  END IF;

  -- Idempotency by stock_move_id
  IF _stock_move_id IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.stock_package_movements
      WHERE stock_package_id = _package_id AND stock_move_id = _stock_move_id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_qty := COALESCE(_moved_qty, v_pkg.qty);

  -- Allow UPDATE through protection trigger for this statement
  PERFORM set_config('app.package_move', '1', true);

  UPDATE public.stock_packages
     SET current_location_id = _to_location_id,
         current_bin_id      = _to_bin_id,
         current_pallet_id   = _to_pallet_id
   WHERE id = _package_id;

  PERFORM set_config('app.package_move', '0', true);

  INSERT INTO public.stock_package_movements(
    stock_package_id, stock_move_id,
    from_location_id, to_location_id,
    from_bin_id, to_bin_id,
    from_pallet_id, to_pallet_id,
    moved_qty, reason, moved_by
  ) VALUES (
    _package_id, _stock_move_id,
    v_pkg.current_location_id, _to_location_id,
    v_pkg.current_bin_id, _to_bin_id,
    v_pkg.current_pallet_id, _to_pallet_id,
    v_qty, _reason, auth.uid()
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END $$;

GRANT EXECUTE ON FUNCTION public.package_move(uuid,uuid,uuid,uuid,text,uuid,numeric) TO authenticated;

-- ---------- Helper: read flag ----------
CREATE OR REPLACE FUNCTION public.is_package_tracking_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT (value)::text::boolean FROM public.app_settings WHERE key='package_tracking_enabled'), false);
$$;
GRANT EXECUTE ON FUNCTION public.is_package_tracking_enabled() TO authenticated, anon;
