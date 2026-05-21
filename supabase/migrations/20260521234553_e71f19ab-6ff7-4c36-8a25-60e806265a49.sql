
ALTER TABLE public.delivery_routes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS delivery_routes_created_by_idx ON public.delivery_routes(created_by);

-- Replace generate_routes to accept zone filter + record creator
CREATE OR REPLACE FUNCTION public.generate_routes(
  _horizon_days integer DEFAULT 15,
  _zone_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  z record;
  d date;
  created int := 0;
  dow int;
  _uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_group(_uid,'inventory_manager') OR public.has_group(_uid,'system_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR z IN
    SELECT * FROM public.delivery_zones
     WHERE active
       AND (_zone_ids IS NULL OR id = ANY(_zone_ids))
  LOOP
    FOR i IN 0.._horizon_days-1 LOOP
      d := current_date + i;
      dow := EXTRACT(ISODOW FROM d)::int;
      IF dow = ANY(z.weekdays) OR (dow = 7 AND 0 = ANY(z.weekdays)) THEN
        BEGIN
          INSERT INTO public.delivery_routes(zone_id, route_date, driver_id, vehicle_id,
            max_deliveries, max_assembly_minutes, created_by)
          VALUES (z.id, d, z.default_driver_id, z.default_vehicle_id,
            z.max_deliveries_per_day, z.max_assembly_minutes_per_day, _uid);
          created := created + 1;
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END IF;
    END LOOP;
  END LOOP;
  RETURN created;
END $function$;

-- Create a single route on a specific date (manual)
CREATE OR REPLACE FUNCTION public.create_route_manual(
  _zone_id uuid,
  _route_date date,
  _delivery_only boolean DEFAULT false,
  _driver_id uuid DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL,
  _max_deliveries integer DEFAULT NULL,
  _max_assembly_minutes integer DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  z public.delivery_zones%ROWTYPE;
  _id uuid;
  _max_d integer;
  _max_a integer;
BEGIN
  IF NOT (public.has_group(_uid,'inventory_manager') OR public.has_group(_uid,'system_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _route_date IS NULL OR _zone_id IS NULL THEN
    RAISE EXCEPTION 'invalid_params';
  END IF;
  SELECT * INTO z FROM public.delivery_zones WHERE id = _zone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zone_not_found';
  END IF;
  _max_d := COALESCE(_max_deliveries, z.max_deliveries_per_day);
  IF _delivery_only THEN
    _max_a := 0;
  ELSE
    _max_a := COALESCE(_max_assembly_minutes, z.max_assembly_minutes_per_day);
  END IF;
  INSERT INTO public.delivery_routes(zone_id, route_date, driver_id, vehicle_id,
    max_deliveries, max_assembly_minutes, notes, created_by, route_type)
  VALUES (_zone_id, _route_date,
    COALESCE(_driver_id, z.default_driver_id),
    COALESCE(_vehicle_id, z.default_vehicle_id),
    _max_d, _max_a, _notes, _uid, 'manual')
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'route_already_exists';
END $function$;
