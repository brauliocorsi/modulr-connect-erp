
CREATE OR REPLACE FUNCTION public.erp_health_check_damaged_packages()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_count int;
  r record;
BEGIN
  FOR r IN
    SELECT sp.id AS package_id, sp.package_ref, sp.current_location_id
    FROM stock_packages sp
    LEFT JOIN stock_locations sl ON sl.id = sp.current_location_id
    WHERE sp.condition = 'damaged'
      AND (sl.usage IS NULL OR sl.usage <> 'customer')
      AND NOT EXISTS (
        SELECT 1 FROM service_cases sc
        WHERE sc.stock_package_id = sp.id
          AND sc.status NOT IN ('done','cancelled','rejected')
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_damage_reports pdr
        WHERE pdr.stock_package_id = sp.id
          AND pdr.service_case_id IS NOT NULL
      )
  LOOP
    v_findings := v_findings || jsonb_build_object(
      'type','damaged_package_without_service_case',
      'severity','P1',
      'entity_type','stock_packages',
      'entity_id', r.package_id,
      'reference', r.package_ref,
      'fix','service_case_create_from_damaged_package');
  END LOOP;
  v_count := jsonb_array_length(v_findings);
  RETURN jsonb_build_object('ok', true, 'findings', v_findings,
    'summary', jsonb_build_object('total', v_count, 'p0',0,'p1',v_count,'p2',0,'p3',0));
END $function$;
