CREATE OR REPLACE FUNCTION public.tg_delivery_schedules_protect_logistics()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE is_authorized boolean;
BEGIN
  is_authorized := auth.uid() IS NULL
               OR has_group(auth.uid(),'inventory_manager')
               OR has_group(auth.uid(),'system_admin')
               OR has_group(auth.uid(),'inventory_user')
               OR has_group(auth.uid(),'sales_manager')
               OR has_group(auth.uid(),'sales_user')
               OR has_group(auth.uid(),'delivery_driver');
  IF is_authorized THEN RETURN NEW; END IF;
  IF NEW.route_id IS DISTINCT FROM OLD.route_id
     OR NEW.dock_id IS DISTINCT FROM OLD.dock_id
     OR NEW.lane_id IS DISTINCT FROM OLD.lane_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.carrier_id IS DISTINCT FROM OLD.carrier_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.physical_state IS DISTINCT FROM OLD.physical_state THEN
    RAISE EXCEPTION 'Only logistics or sales roles may change route/status/physical_state on delivery_schedules';
  END IF;
  RETURN NEW;
END
$function$;