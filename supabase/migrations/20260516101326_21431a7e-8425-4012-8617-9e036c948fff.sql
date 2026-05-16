
-- ============================================================
-- M2.1 - delivery_routes: colunas de capacidade snapshot + consumo
-- ============================================================
ALTER TABLE public.delivery_routes
  ADD COLUMN IF NOT EXISTS cap_deliveries integer,
  ADD COLUMN IF NOT EXISTS cap_assembly_minutes integer,
  ADD COLUMN IF NOT EXISTS cap_volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS cap_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS current_deliveries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_assembly_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_volume_m3 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_weight_kg numeric NOT NULL DEFAULT 0;

-- ============================================================
-- M2.2 - products: garantir colunas opcionais de logística
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS assembly_minutes integer;

-- ============================================================
-- M2.3 - Trigger: capacidade herdada da viatura
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_route_inherit_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  IF NEW.vehicle_id IS NULL THEN
    NEW.cap_deliveries := NULL;
    NEW.cap_assembly_minutes := NULL;
    NEW.cap_volume_m3 := NULL;
    NEW.cap_weight_kg := NULL;
    RETURN NEW;
  END IF;
  SELECT max_deliveries, max_assembly_minutes, volume_m3, weight_kg, assembly_minutes_capacity
    INTO v FROM vehicles WHERE id = NEW.vehicle_id;
  -- Mantém os max_* da rota se já vierem do template; usa veículo como default
  NEW.cap_deliveries := COALESCE(v.assembly_minutes_capacity, NULL); -- placeholder
  NEW.cap_deliveries := NULL; -- delivery count vem de max_deliveries existente
  NEW.cap_assembly_minutes := COALESCE(v.assembly_minutes_capacity, NEW.max_assembly_minutes);
  NEW.cap_volume_m3 := v.volume_m3;
  NEW.cap_weight_kg := v.weight_kg;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_route_inherit_capacity ON public.delivery_routes;
CREATE TRIGGER tg_route_inherit_capacity
  BEFORE INSERT OR UPDATE OF vehicle_id ON public.delivery_routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_route_inherit_capacity();

-- ============================================================
-- M2.4 - Função: recalcular current_* da rota
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_route_current(_route uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deliveries int;
  v_volume numeric;
  v_weight numeric;
  v_assembly int;
BEGIN
  SELECT count(DISTINCT dro.schedule_id)
    INTO v_deliveries
    FROM delivery_route_orders dro
    WHERE dro.route_id = _route AND dro.status NOT IN ('cancelled');

  SELECT
    COALESCE(SUM(COALESCE(p.volume_m3,0) * sol.quantity), 0),
    COALESCE(SUM(COALESCE(p.weight_kg,0) * sol.quantity), 0),
    COALESCE(SUM(COALESCE(p.assembly_minutes,0) * sol.quantity), 0)::int
    INTO v_volume, v_weight, v_assembly
    FROM delivery_route_orders dro
    JOIN delivery_schedules ds ON ds.id = dro.schedule_id
    JOIN sale_order_lines sol ON sol.order_id = ds.sale_order_id
    JOIN products p ON p.id = sol.product_id
    WHERE dro.route_id = _route AND dro.status NOT IN ('cancelled');

  UPDATE delivery_routes
     SET current_deliveries = v_deliveries,
         current_volume_m3 = v_volume,
         current_weight_kg = v_weight,
         current_assembly_minutes = v_assembly,
         updated_at = now()
   WHERE id = _route;
END $$;

CREATE OR REPLACE FUNCTION public.tg_route_orders_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_route_current(OLD.route_id);
    RETURN OLD;
  ELSE
    PERFORM public.recalc_route_current(NEW.route_id);
    IF TG_OP = 'UPDATE' AND OLD.route_id IS DISTINCT FROM NEW.route_id THEN
      PERFORM public.recalc_route_current(OLD.route_id);
    END IF;
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tg_route_orders_recalc ON public.delivery_route_orders;
CREATE TRIGGER tg_route_orders_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_route_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_route_orders_recalc();

-- ============================================================
-- M2.5 - View v_manifest_by_line
-- ============================================================
CREATE OR REPLACE VIEW public.v_manifest_by_line AS
SELECT
  m.route_id,
  m.route_order_id,
  m.schedule_id,
  m.sale_order_line_id,
  m.product_id,
  COUNT(*) AS package_count,
  SUM(m.qty_loaded) AS qty_loaded,
  SUM(m.qty_delivered) AS qty_delivered,
  SUM(m.qty_returned) AS qty_returned,
  SUM(m.qty_pending) AS qty_pending,
  BOOL_OR(m.assistance_required) AS any_assistance,
  BOOL_OR(m.damaged) AS any_damaged,
  BOOL_OR(m.verification_required AND m.verified_at IS NULL) AS pending_verification
FROM public.vehicle_route_manifest m
GROUP BY m.route_id, m.route_order_id, m.schedule_id, m.sale_order_line_id, m.product_id;

-- ============================================================
-- M2.6 - Excluir damaged/quarantine de stock disponível
-- ============================================================
CREATE OR REPLACE VIEW public.product_stock_forecast AS
WITH on_hand AS (
  SELECT q.product_id,
         l.warehouse_id,
         sum(q.quantity) AS on_hand,
         sum(q.reserved_quantity) AS reserved
    FROM stock_quants q
    JOIN stock_locations l ON l.id = q.location_id
   WHERE l.type = 'internal'::location_type
     AND (l.return_kind IS NULL OR l.return_kind = 'good')
   GROUP BY q.product_id, l.warehouse_id
), incoming AS (
  SELECT pol.product_id, po.warehouse_id, sum(pol.quantity) AS qty
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.order_id
   WHERE po.state = ANY (ARRAY['confirmed'::purchase_state,'rfq_sent'::purchase_state,'draft'::purchase_state])
   GROUP BY pol.product_id, po.warehouse_id
), outgoing AS (
  SELECT sol.product_id, so.warehouse_id, sum(sol.quantity) AS qty
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
   WHERE so.state = ANY (ARRAY['confirmed'::sale_state,'sent'::sale_state])
   GROUP BY sol.product_id, so.warehouse_id
), sold_30 AS (
  SELECT sol.product_id, sum(sol.quantity) AS qty
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
   WHERE so.state = ANY (ARRAY['confirmed'::sale_state,'done'::sale_state])
     AND so.date_order >= now() - interval '30 days'
   GROUP BY sol.product_id
), sold_90 AS (
  SELECT sol.product_id, sum(sol.quantity) AS qty
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
   WHERE so.state = ANY (ARRAY['confirmed'::sale_state,'done'::sale_state])
     AND so.date_order >= now() - interval '90 days'
   GROUP BY sol.product_id
)
SELECT p.id AS product_id,
       w.id AS warehouse_id,
       COALESCE(oh.on_hand,0)  AS on_hand,
       COALESCE(oh.reserved,0) AS reserved,
       COALESCE(oh.on_hand,0) - COALESCE(oh.reserved,0) AS available,
       COALESCE(i.qty,0)  AS incoming,
       COALESCE(o.qty,0)  AS outgoing,
       COALESCE(oh.on_hand,0) - COALESCE(oh.reserved,0) + COALESCE(i.qty,0) - COALESCE(o.qty,0) AS forecasted,
       COALESCE(s30.qty,0) AS sold_30d,
       COALESCE(s90.qty,0) AS sold_90d
  FROM products p
  CROSS JOIN warehouses w
  LEFT JOIN on_hand  oh  ON oh.product_id  = p.id AND oh.warehouse_id = w.id
  LEFT JOIN incoming i   ON i.product_id   = p.id AND i.warehouse_id  = w.id
  LEFT JOIN outgoing o   ON o.product_id   = p.id AND o.warehouse_id  = w.id
  LEFT JOIN sold_30  s30 ON s30.product_id = p.id
  LEFT JOIN sold_90  s90 ON s90.product_id = p.id;

-- v_product_stock_full mantém forma anterior (depende de product_stock_forecast)
-- Recriar para refletir nova forma
CREATE OR REPLACE VIEW public.v_product_stock_full AS
SELECT p.id AS product_id,
       p.name,
       COALESCE(sum(psf.on_hand),0)    AS on_hand,
       COALESCE(sum(psf.reserved),0)   AS reserved,
       COALESCE(sum(psf.available),0)  AS available,
       COALESCE(sum(psf.incoming),0)   AS incoming,
       COALESCE(sum(psf.outgoing),0)   AS outgoing,
       COALESCE(sum(psf.forecasted),0) AS forecasted,
       COALESCE((SELECT sum(mo.qty) FROM manufacturing_orders mo
                  WHERE mo.product_id = p.id
                    AND mo.state = ANY (ARRAY['draft'::mo_state,'waiting_material'::mo_state,'ready'::mo_state,'in_progress'::mo_state,'paused'::mo_state,'qc'::mo_state])),0) AS in_production,
       p.min_stock,
       p.max_stock
  FROM products p
  LEFT JOIN product_stock_forecast psf ON psf.product_id = p.id
 GROUP BY p.id;

-- ============================================================
-- M2.7 - Invariante manifest ↔ vehicle
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_manifest_validate_vehicle_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid;
BEGIN
  IF NEW.vehicle_location_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT v.stock_location_id INTO v_loc
    FROM delivery_routes r
    JOIN vehicles v ON v.id = r.vehicle_id
   WHERE r.id = NEW.route_id;
  IF v_loc IS NOT NULL AND v_loc <> NEW.vehicle_location_id THEN
    RAISE EXCEPTION 'manifest.vehicle_location_id (%) does not match route vehicle stock_location_id (%)',
      NEW.vehicle_location_id, v_loc;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_manifest_validate_vehicle_location ON public.vehicle_route_manifest;
CREATE TRIGGER tg_manifest_validate_vehicle_location
  BEFORE INSERT OR UPDATE OF vehicle_location_id, route_id ON public.vehicle_route_manifest
  FOR EACH ROW EXECUTE FUNCTION public.tg_manifest_validate_vehicle_location();

-- ============================================================
-- M2.8 - Proteção de campos logísticos em delivery_schedules
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_delivery_schedules_protect_logistics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_logistics boolean;
BEGIN
  is_logistics := has_group(auth.uid(),'inventory_manager')
               OR has_group(auth.uid(),'system_admin')
               OR has_group(auth.uid(),'inventory_user');
  IF is_logistics THEN
    RETURN NEW;
  END IF;
  IF NEW.route_id IS DISTINCT FROM OLD.route_id
     OR NEW.dock_id IS DISTINCT FROM OLD.dock_id
     OR NEW.lane_id IS DISTINCT FROM OLD.lane_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.carrier_id IS DISTINCT FROM OLD.carrier_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.physical_state IS DISTINCT FROM OLD.physical_state THEN
    RAISE EXCEPTION 'Only logistics roles may change route_id/dock_id/lane_id/vehicle_id/carrier_id/status/physical_state on delivery_schedules';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_delivery_schedules_protect_logistics ON public.delivery_schedules;
CREATE TRIGGER tg_delivery_schedules_protect_logistics
  BEFORE UPDATE ON public.delivery_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_delivery_schedules_protect_logistics();

-- ============================================================
-- M2.9 - Backfill capacidade de rotas existentes com veículo
-- ============================================================
UPDATE public.delivery_routes r
   SET cap_assembly_minutes = COALESCE(v.assembly_minutes_capacity, r.max_assembly_minutes),
       cap_volume_m3 = v.volume_m3,
       cap_weight_kg = v.weight_kg
  FROM public.vehicles v
 WHERE r.vehicle_id = v.id
   AND r.cap_assembly_minutes IS NULL;
