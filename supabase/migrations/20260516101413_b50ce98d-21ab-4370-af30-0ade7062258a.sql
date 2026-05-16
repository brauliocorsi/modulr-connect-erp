
CREATE OR REPLACE FUNCTION public.tg_route_inherit_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vol numeric; v_wt numeric; v_asm int;
BEGIN
  IF NEW.vehicle_id IS NULL THEN
    NEW.cap_deliveries := NULL;
    NEW.cap_assembly_minutes := NULL;
    NEW.cap_volume_m3 := NULL;
    NEW.cap_weight_kg := NULL;
    RETURN NEW;
  END IF;
  SELECT volume_m3, weight_kg, assembly_minutes_capacity
    INTO v_vol, v_wt, v_asm
    FROM vehicles WHERE id = NEW.vehicle_id;
  NEW.cap_deliveries := NEW.max_deliveries;
  NEW.cap_assembly_minutes := COALESCE(v_asm, NEW.max_assembly_minutes);
  NEW.cap_volume_m3 := v_vol;
  NEW.cap_weight_kg := v_wt;
  RETURN NEW;
END $$;
