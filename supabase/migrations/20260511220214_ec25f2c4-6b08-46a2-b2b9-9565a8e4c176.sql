
-- ============ TABLES ============
CREATE TABLE public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  zip_from text NOT NULL,
  zip_to text NOT NULL,
  color text,
  active boolean NOT NULL DEFAULT true,
  default_driver_id uuid REFERENCES public.profiles(id),
  default_vehicle_id uuid REFERENCES public.vehicles(id),
  max_deliveries_per_day integer NOT NULL DEFAULT 10,
  max_assembly_minutes_per_day integer NOT NULL DEFAULT 240,
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_zones_active_idx ON public.delivery_zones(active);
CREATE INDEX delivery_zones_zip_idx ON public.delivery_zones(zip_from, zip_to);

CREATE TABLE public.delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
  route_date date NOT NULL,
  driver_id uuid REFERENCES public.profiles(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  max_deliveries integer NOT NULL DEFAULT 10,
  max_assembly_minutes integer NOT NULL DEFAULT 240,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','in_progress','done','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(zone_id, route_date)
);
CREATE INDEX delivery_routes_date_idx ON public.delivery_routes(route_date);
CREATE INDEX delivery_routes_driver_idx ON public.delivery_routes(driver_id);

ALTER TABLE public.stock_pickings
  ADD COLUMN route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL;
CREATE INDEX stock_pickings_route_idx ON public.stock_pickings(route_id);

ALTER TABLE public.products
  ADD COLUMN assembly_minutes numeric NOT NULL DEFAULT 0;

-- updated_at triggers
CREATE TRIGGER tg_zones_updated BEFORE UPDATE ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_routes_updated BEFORE UPDATE ON public.delivery_routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ RLS ============
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zones_read" ON public.delivery_zones FOR SELECT TO authenticated
  USING (
    public.has_group(auth.uid(),'inventory_user')
    OR public.has_group(auth.uid(),'inventory_manager')
    OR public.has_group(auth.uid(),'sales_user')
    OR public.has_group(auth.uid(),'delivery_driver')
    OR public.has_group(auth.uid(),'system_admin')
  );
CREATE POLICY "zones_write" ON public.delivery_zones FOR ALL TO authenticated
  USING (public.has_group(auth.uid(),'inventory_manager') OR public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (public.has_group(auth.uid(),'inventory_manager') OR public.has_group(auth.uid(),'system_admin'));

CREATE POLICY "routes_read" ON public.delivery_routes FOR SELECT TO authenticated
  USING (
    public.has_group(auth.uid(),'inventory_user')
    OR public.has_group(auth.uid(),'inventory_manager')
    OR public.has_group(auth.uid(),'sales_user')
    OR public.has_group(auth.uid(),'system_admin')
    OR (public.has_group(auth.uid(),'delivery_driver') AND driver_id = auth.uid())
  );
CREATE POLICY "routes_write" ON public.delivery_routes FOR ALL TO authenticated
  USING (public.has_group(auth.uid(),'inventory_manager') OR public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (public.has_group(auth.uid(),'inventory_manager') OR public.has_group(auth.uid(),'system_admin'));

-- ============ FUNCTIONS ============

CREATE OR REPLACE FUNCTION public.find_zone_for_zip(_zip text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.delivery_zones
   WHERE active
     AND _zip IS NOT NULL
     AND regexp_replace(coalesce(_zip,''),'\D','','g') <> ''
     AND regexp_replace(_zip,'\D','','g') BETWEEN regexp_replace(zip_from,'\D','','g') AND regexp_replace(zip_to,'\D','','g')
   ORDER BY length(regexp_replace(zip_to,'\D','','g')) - length(regexp_replace(zip_from,'\D','','g'))
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.generate_routes(_horizon_days integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  z record;
  d date;
  created int := 0;
  dow int;
BEGIN
  FOR z IN SELECT * FROM public.delivery_zones WHERE active LOOP
    FOR i IN 0.._horizon_days-1 LOOP
      d := current_date + i;
      dow := EXTRACT(ISODOW FROM d)::int; -- 1..7 (Mon..Sun)
      IF dow = ANY(z.weekdays) OR (dow = 7 AND 0 = ANY(z.weekdays)) THEN
        BEGIN
          INSERT INTO public.delivery_routes(zone_id, route_date, driver_id, vehicle_id,
            max_deliveries, max_assembly_minutes)
          VALUES (z.id, d, z.default_driver_id, z.default_vehicle_id,
            z.max_deliveries_per_day, z.max_assembly_minutes_per_day);
          created := created + 1;
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END IF;
    END LOOP;
  END LOOP;
  RETURN created;
END $$;

CREATE OR REPLACE FUNCTION public.route_capacity_used(_route uuid)
RETURNS TABLE(deliveries integer, assembly_minutes numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT
    (SELECT count(DISTINCT sp.id)::int FROM public.stock_pickings sp
       WHERE sp.route_id = _route AND sp.kind='outgoing' AND sp.state NOT IN ('cancelled')),
    coalesce((
      SELECT sum( coalesce(p.assembly_minutes,0) * sol.quantity )
      FROM public.stock_pickings sp
      JOIN public.sale_orders so ON so.name = sp.origin
      JOIN public.sale_order_lines sol ON sol.order_id = so.id AND sol.line_kind='product'
      JOIN public.products p ON p.id = sol.product_id
      WHERE sp.route_id = _route AND so.include_assembly = true
    ),0)::numeric;
$$;

CREATE OR REPLACE FUNCTION public.suggest_route(_so uuid, _from_date date DEFAULT current_date)
RETURNS TABLE(
  route_id uuid,
  route_date date,
  zone_id uuid,
  zone_name text,
  driver_id uuid,
  vehicle_id uuid,
  max_deliveries integer,
  max_assembly_minutes integer,
  used_deliveries integer,
  used_assembly_minutes numeric,
  would_exceed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_zip text;
  v_zone uuid;
  v_so_minutes numeric;
BEGIN
  SELECT pa.zip INTO v_zip
    FROM public.sale_orders so
    JOIN public.partners pa ON pa.id = so.partner_id
   WHERE so.id = _so;
  v_zone := public.find_zone_for_zip(v_zip);
  IF v_zone IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum( coalesce(p.assembly_minutes,0) * sol.quantity ),0) INTO v_so_minutes
    FROM public.sale_orders so
    JOIN public.sale_order_lines sol ON sol.order_id = so.id AND sol.line_kind='product'
    JOIN public.products p ON p.id = sol.product_id
   WHERE so.id = _so AND so.include_assembly = true;

  RETURN QUERY
  SELECT r.id, r.route_date, r.zone_id, z.name, r.driver_id, r.vehicle_id,
         r.max_deliveries, r.max_assembly_minutes,
         cap.deliveries, cap.assembly_minutes,
         (cap.deliveries + 1 > r.max_deliveries
           OR cap.assembly_minutes + v_so_minutes > r.max_assembly_minutes) AS would_exceed
    FROM public.delivery_routes r
    JOIN public.delivery_zones z ON z.id = r.zone_id
    CROSS JOIN LATERAL public.route_capacity_used(r.id) cap
   WHERE r.zone_id = v_zone
     AND r.route_date >= _from_date
     AND r.state IN ('planned','in_progress')
   ORDER BY r.route_date
   LIMIT 15;
END $$;

CREATE OR REPLACE FUNCTION public.schedule_picking_to_route(_picking uuid, _route uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.delivery_routes WHERE id = _route;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rota não encontrada'; END IF;
  UPDATE public.stock_pickings
     SET route_id = _route,
         scheduled_at = (r.route_date::timestamp + time '09:00')
   WHERE id = _picking;
  PERFORM public.log_record_event('stock_picking', _picking,
    'Atribuído à rota ' || r.route_date::text, jsonb_build_object('route_id',_route));
END $$;
