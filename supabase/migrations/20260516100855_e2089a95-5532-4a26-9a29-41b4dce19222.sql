
DO $$ BEGIN
  CREATE TYPE return_kind AS ENUM ('good','damaged','quarantine');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.stock_locations
  ADD COLUMN IF NOT EXISTS return_kind return_kind;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS stock_location_id uuid REFERENCES public.stock_locations(id),
  ADD COLUMN IF NOT EXISTS requires_load_verification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS assembly_minutes_capacity integer;

ALTER TABLE public.delivery_carriers
  ADD COLUMN IF NOT EXISTS stock_location_id uuid REFERENCES public.stock_locations(id);

ALTER TABLE public.delivery_routes
  ADD COLUMN IF NOT EXISTS dock_id uuid,
  ADD COLUMN IF NOT EXISTS requires_load_verification boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.loading_docks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name text NOT NULL,
  stock_location_id uuid REFERENCES public.stock_locations(id),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, name)
);
CREATE INDEX IF NOT EXISTS loading_docks_wh_idx ON public.loading_docks(warehouse_id) WHERE active;

DO $$ BEGIN
  ALTER TABLE public.delivery_routes
    ADD CONSTRAINT delivery_routes_dock_fk FOREIGN KEY (dock_id) REFERENCES public.loading_docks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.loading_dock_lanes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dock_id uuid NOT NULL REFERENCES public.loading_docks(id) ON DELETE CASCADE,
  code text NOT NULL,
  stock_location_id uuid REFERENCES public.stock_locations(id),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dock_id, code)
);
CREATE INDEX IF NOT EXISTS loading_dock_lanes_dock_idx ON public.loading_dock_lanes(dock_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.delivery_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.partners(id),
  scheduled_date date NOT NULL,
  slot_start time,
  slot_end time,
  status text NOT NULL DEFAULT 'requested',
  physical_state text NOT NULL DEFAULT 'in_stock',
  route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  dock_id uuid REFERENCES public.loading_docks(id) ON DELETE SET NULL,
  lane_id uuid REFERENCES public.loading_dock_lanes(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  carrier_id uuid REFERENCES public.delivery_carriers(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_schedules_status_chk CHECK (status IN
    ('requested','confirmed','assigned','loading','in_transit','delivered','partial','failed','rescheduled','cancelled')),
  CONSTRAINT delivery_schedules_physical_chk CHECK (physical_state IN
    ('in_stock','reserved','picked','at_dock','in_truck','at_customer','delivered','at_pickup_area','returned'))
);
CREATE INDEX IF NOT EXISTS delivery_schedules_so_idx ON public.delivery_schedules(sale_order_id);
CREATE INDEX IF NOT EXISTS delivery_schedules_date_idx ON public.delivery_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS delivery_schedules_route_idx ON public.delivery_schedules(route_id);
CREATE INDEX IF NOT EXISTS delivery_schedules_status_idx ON public.delivery_schedules(status);

CREATE TABLE IF NOT EXISTS public.delivery_route_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
  name text NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  slot_start time,
  slot_end time,
  default_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  default_driver_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  max_deliveries integer,
  max_assembly_minutes integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_route_templates_zone_idx ON public.delivery_route_templates(zone_id, weekday) WHERE active;

CREATE TABLE IF NOT EXISTS public.delivery_route_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.delivery_schedules(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planned',
  loaded_at timestamptz,
  delivered_at timestamptz,
  returned_at timestamptz,
  failed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, schedule_id),
  CONSTRAINT delivery_route_orders_status_chk CHECK (status IN
    ('planned','loading','loaded','in_transit','delivered','partial','failed','returned','cancelled'))
);
CREATE INDEX IF NOT EXISTS delivery_route_orders_route_idx ON public.delivery_route_orders(route_id);

CREATE TABLE IF NOT EXISTS public.vehicle_route_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  route_order_id uuid REFERENCES public.delivery_route_orders(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.delivery_schedules(id) ON DELETE SET NULL,
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id),
  stock_move_id uuid REFERENCES public.stock_moves(id) ON DELETE SET NULL,
  vehicle_location_id uuid REFERENCES public.stock_locations(id),
  qty_loaded numeric NOT NULL DEFAULT 0,
  qty_delivered numeric NOT NULL DEFAULT 0,
  qty_returned numeric NOT NULL DEFAULT 0,
  qty_pending numeric GENERATED ALWAYS AS (qty_loaded - qty_delivered - qty_returned) STORED,
  stop_sequence integer,
  package_ref text,
  package_sequence integer,
  package_group text,
  package_total integer,
  assistance_required boolean NOT NULL DEFAULT false,
  assistance_case_id uuid,
  damaged boolean NOT NULL DEFAULT false,
  return_condition return_kind,
  return_reason text,
  loaded_by uuid,
  loaded_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  verification_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vrm_route_idx ON public.vehicle_route_manifest(route_id);
CREATE INDEX IF NOT EXISTS vrm_order_idx ON public.vehicle_route_manifest(route_order_id);
CREATE INDEX IF NOT EXISTS vrm_sol_idx ON public.vehicle_route_manifest(sale_order_line_id);
CREATE INDEX IF NOT EXISTS vrm_package_ref_idx ON public.vehicle_route_manifest(package_ref) WHERE package_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vrm_uniq_pkg
  ON public.vehicle_route_manifest(route_id, sale_order_line_id, package_ref)
  WHERE package_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vrm_uniq_nopkg
  ON public.vehicle_route_manifest(route_id, sale_order_line_id)
  WHERE package_ref IS NULL AND sale_order_line_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES public.delivery_schedules(id) ON DELETE SET NULL,
  picking_id uuid REFERENCES public.stock_pickings(id) ON DELETE SET NULL,
  dock_id uuid REFERENCES public.loading_docks(id) ON DELETE SET NULL,
  lane_id uuid REFERENCES public.loading_dock_lanes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned',
  moved_at timestamptz,
  loaded_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dock_transfers_status_chk CHECK (status IN ('planned','moved_to_dock','loaded','cancelled'))
);
CREATE INDEX IF NOT EXISTS dock_transfers_route_idx ON public.dock_transfers(route_id);
CREATE INDEX IF NOT EXISTS dock_transfers_lane_idx ON public.dock_transfers(lane_id);
CREATE UNIQUE INDEX IF NOT EXISTS dock_transfers_active_lane_uniq
  ON public.dock_transfers(lane_id)
  WHERE status = 'moved_to_dock' AND lane_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_pickups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  picking_id uuid REFERENCES public.stock_pickings(id) ON DELETE SET NULL,
  scheduled_date date,
  picked_up_at timestamptz,
  picked_up_by_name text,
  picked_up_by_doc text,
  validated_by uuid,
  notes text,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_pickups_status_chk CHECK (status IN ('scheduled','ready','picked_up','cancelled'))
);
CREATE INDEX IF NOT EXISTS customer_pickups_so_idx ON public.customer_pickups(sale_order_id);

CREATE TABLE IF NOT EXISTS public.delivery_route_cash_closure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL UNIQUE REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  cash_register_id uuid REFERENCES public.cash_registers(id) ON DELETE SET NULL,
  expected_cash numeric NOT NULL DEFAULT 0,
  actual_cash numeric NOT NULL DEFAULT 0,
  expected_mbway numeric NOT NULL DEFAULT 0,
  actual_mbway numeric NOT NULL DEFAULT 0,
  expected_transfer numeric NOT NULL DEFAULT 0,
  actual_transfer numeric NOT NULL DEFAULT 0,
  expected_other numeric NOT NULL DEFAULT 0,
  actual_other numeric NOT NULL DEFAULT 0,
  variance numeric GENERATED ALWAYS AS (
    (actual_cash + actual_mbway + actual_transfer + actual_other) -
    (expected_cash + expected_mbway + expected_transfer + expected_other)
  ) STORED,
  notes text,
  closed_by uuid,
  closed_at timestamptz,
  reconciled_by uuid,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loading_docks','loading_dock_lanes','delivery_schedules',
    'delivery_route_templates','delivery_route_orders','vehicle_route_manifest',
    'dock_transfers','customer_pickups','delivery_route_cash_closure'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS tg_%1$s_updated ON public.%1$s;
       CREATE TRIGGER tg_%1$s_updated BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', t);
  END LOOP;
END $$;

-- ====== Bootstrap helpers (idempotent) ======
CREATE OR REPLACE FUNCTION public.bootstrap_warehouse_logistics_locations(_wh uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dock uuid; v_return uuid;
BEGIN
  SELECT id INTO v_dock FROM stock_locations
    WHERE warehouse_id = _wh AND name = 'DOCK' AND parent_id IS NULL LIMIT 1;
  IF v_dock IS NULL THEN
    INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
    VALUES (_wh, 'DOCK', 'internal', true, true) RETURNING id INTO v_dock;
  END IF;

  SELECT id INTO v_return FROM stock_locations
    WHERE warehouse_id = _wh AND name = 'RETURN' AND parent_id IS NULL LIMIT 1;
  IF v_return IS NULL THEN
    INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
    VALUES (_wh, 'RETURN', 'internal', true, true) RETURNING id INTO v_return;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE warehouse_id = _wh AND parent_id = v_return AND name = 'GOOD') THEN
    INSERT INTO stock_locations(warehouse_id, parent_id, name, type, active, return_kind)
    VALUES (_wh, v_return, 'GOOD', 'internal', true, 'good');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE warehouse_id = _wh AND parent_id = v_return AND name = 'DAMAGED') THEN
    INSERT INTO stock_locations(warehouse_id, parent_id, name, type, active, return_kind)
    VALUES (_wh, v_return, 'DAMAGED', 'internal', true, 'damaged');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE warehouse_id = _wh AND parent_id = v_return AND name = 'QUARANTINE') THEN
    INSERT INTO stock_locations(warehouse_id, parent_id, name, type, active, return_kind)
    VALUES (_wh, v_return, 'QUARANTINE', 'internal', true, 'quarantine');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM stock_locations WHERE warehouse_id = _wh AND name = 'PICKUP_AREA' AND parent_id IS NULL) THEN
    INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
    VALUES (_wh, 'PICKUP_AREA', 'internal', true, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tg_warehouse_bootstrap_logistics_locations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.active THEN
    PERFORM public.bootstrap_warehouse_logistics_locations(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_warehouse_bootstrap_logistics ON public.warehouses;
CREATE TRIGGER tg_warehouse_bootstrap_logistics
  AFTER INSERT OR UPDATE OF active ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.tg_warehouse_bootstrap_logistics_locations();

-- Backfill inline (sem UPDATE no warehouses)
DO $$
DECLARE w record;
BEGIN
  FOR w IN SELECT id FROM warehouses WHERE active LOOP
    PERFORM public.bootstrap_warehouse_logistics_locations(w.id);
  END LOOP;
END $$;

-- Vehicle bootstrap
CREATE OR REPLACE FUNCTION public.bootstrap_vehicle_location(_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid; v_wh uuid; v_existing uuid; v_name text;
BEGIN
  SELECT stock_location_id, COALESCE(license_plate, name, id::text)
    INTO v_existing, v_name FROM vehicles WHERE id = _vehicle;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT id INTO v_wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RETURN NULL; END IF;
  INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
  VALUES (v_wh, 'VEHICLE/'||v_name, 'internal', true, true)
  RETURNING id INTO v_loc;
  UPDATE vehicles SET stock_location_id = v_loc WHERE id = _vehicle;
  RETURN v_loc;
END $$;

CREATE OR REPLACE FUNCTION public.tg_vehicle_bootstrap_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid; v_wh uuid;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF NEW.stock_location_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RETURN NEW; END IF;
  INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
  VALUES (v_wh, 'VEHICLE/'||COALESCE(NEW.license_plate, NEW.name, NEW.id::text), 'internal', true, true)
  RETURNING id INTO v_loc;
  NEW.stock_location_id := v_loc;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_vehicle_bootstrap_location ON public.vehicles;
CREATE TRIGGER tg_vehicle_bootstrap_location
  BEFORE INSERT OR UPDATE OF active ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.tg_vehicle_bootstrap_location();

-- Carrier bootstrap
CREATE OR REPLACE FUNCTION public.bootstrap_carrier_location(_carrier uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid; v_wh uuid; v_existing uuid; v_name text;
BEGIN
  SELECT stock_location_id, COALESCE(name, id::text)
    INTO v_existing, v_name FROM delivery_carriers WHERE id = _carrier;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT id INTO v_wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RETURN NULL; END IF;
  INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
  VALUES (v_wh, 'CARRIER/'||v_name, 'transit', true, true)
  RETURNING id INTO v_loc;
  UPDATE delivery_carriers SET stock_location_id = v_loc WHERE id = _carrier;
  RETURN v_loc;
END $$;

CREATE OR REPLACE FUNCTION public.tg_carrier_bootstrap_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid; v_wh uuid;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF NEW.stock_location_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RETURN NEW; END IF;
  INSERT INTO stock_locations(warehouse_id, name, type, is_zone, active)
  VALUES (v_wh, 'CARRIER/'||COALESCE(NEW.name, NEW.id::text), 'transit', true, true)
  RETURNING id INTO v_loc;
  NEW.stock_location_id := v_loc;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_carrier_bootstrap_location ON public.delivery_carriers;
CREATE TRIGGER tg_carrier_bootstrap_location
  BEFORE INSERT OR UPDATE OF active ON public.delivery_carriers
  FOR EACH ROW EXECUTE FUNCTION public.tg_carrier_bootstrap_location();

-- Backfill vehicles e carriers ativos sem location
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM vehicles WHERE active AND stock_location_id IS NULL LOOP
    PERFORM public.bootstrap_vehicle_location(r.id);
  END LOOP;
  FOR r IN SELECT id FROM delivery_carriers WHERE active AND stock_location_id IS NULL LOOP
    PERFORM public.bootstrap_carrier_location(r.id);
  END LOOP;
END $$;

-- Dock + lane bootstrap
CREATE OR REPLACE FUNCTION public.tg_loading_dock_bootstrap_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent uuid; v_loc uuid;
BEGIN
  IF NEW.stock_location_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_parent FROM stock_locations
    WHERE warehouse_id = NEW.warehouse_id AND name='DOCK' AND parent_id IS NULL LIMIT 1;
  INSERT INTO stock_locations(warehouse_id, parent_id, name, type, is_zone, active)
  VALUES (NEW.warehouse_id, v_parent, NEW.name, 'internal', true, true)
  RETURNING id INTO v_loc;
  NEW.stock_location_id := v_loc;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_loading_dock_bootstrap ON public.loading_docks;
CREATE TRIGGER tg_loading_dock_bootstrap
  BEFORE INSERT ON public.loading_docks
  FOR EACH ROW EXECUTE FUNCTION public.tg_loading_dock_bootstrap_location();

CREATE OR REPLACE FUNCTION public.tg_lane_bootstrap_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent uuid; v_wh uuid; v_loc uuid;
BEGIN
  IF NEW.stock_location_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT stock_location_id, warehouse_id INTO v_parent, v_wh
    FROM loading_docks WHERE id = NEW.dock_id;
  INSERT INTO stock_locations(warehouse_id, parent_id, name, type, is_bin, active)
  VALUES (v_wh, v_parent, 'LANE_'||NEW.code, 'internal', true, true)
  RETURNING id INTO v_loc;
  NEW.stock_location_id := v_loc;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_lane_bootstrap ON public.loading_dock_lanes;
CREATE TRIGGER tg_lane_bootstrap
  BEFORE INSERT ON public.loading_dock_lanes
  FOR EACH ROW EXECUTE FUNCTION public.tg_lane_bootstrap_location();

-- RLS
ALTER TABLE public.loading_docks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_dock_lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_route_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_cash_closure ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loading_docks','loading_dock_lanes','delivery_route_templates',
                            'delivery_route_orders','dock_transfers','customer_pickups',
                            'delivery_route_cash_closure','vehicle_route_manifest'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$s;', t);
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$s FOR SELECT TO authenticated USING (true);', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$s;', t);
    EXECUTE format($p$CREATE POLICY %1$s_write ON public.%1$s TO authenticated
      USING (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'system_admin'))
      WITH CHECK (has_group(auth.uid(),'inventory_manager') OR has_group(auth.uid(),'system_admin'));$p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS delivery_schedules_read ON public.delivery_schedules;
CREATE POLICY delivery_schedules_read ON public.delivery_schedules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS delivery_schedules_write ON public.delivery_schedules;
CREATE POLICY delivery_schedules_write ON public.delivery_schedules TO authenticated
  USING (
    has_group(auth.uid(),'inventory_manager')
    OR has_group(auth.uid(),'system_admin')
    OR (
      (has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'sales_manager'))
      AND EXISTS (SELECT 1 FROM sale_orders so WHERE so.id = delivery_schedules.sale_order_id
                  AND (so.salesperson_id = auth.uid() OR has_group(auth.uid(),'sales_manager')))
    )
  )
  WITH CHECK (
    has_group(auth.uid(),'inventory_manager')
    OR has_group(auth.uid(),'system_admin')
    OR (
      (has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'sales_manager'))
      AND EXISTS (SELECT 1 FROM sale_orders so WHERE so.id = delivery_schedules.sale_order_id
                  AND (so.salesperson_id = auth.uid() OR has_group(auth.uid(),'sales_manager')))
    )
  );
