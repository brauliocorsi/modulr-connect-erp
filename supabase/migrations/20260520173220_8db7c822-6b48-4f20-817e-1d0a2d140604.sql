
DROP FUNCTION IF EXISTS public._test_phase25_machines_workcenters_operations();

CREATE OR REPLACE FUNCTION public._test_phase25_machines_workcenters_operations()
RETURNS TABLE(check_name text, ok boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT 'rpc_machine_upsert'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='machine_upsert'), NULL::text;
  RETURN QUERY SELECT 'rpc_machine_archive'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='machine_archive'), NULL::text;
  RETURN QUERY SELECT 'rpc_work_center_upsert'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='work_center_upsert'), NULL::text;
  RETURN QUERY SELECT 'rpc_work_center_archive'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='work_center_archive'), NULL::text;
  RETURN QUERY SELECT 'rpc_operation_upsert'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='manufacturing_operation_upsert'), NULL::text;
  RETURN QUERY SELECT 'rpc_operation_archive'::text,
    EXISTS(SELECT 1 FROM pg_proc WHERE proname='manufacturing_operation_archive'), NULL::text;
  RETURN QUERY SELECT 'machine_extra_cols'::text,
    (SELECT count(*) = 6 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='manufacturing_machines'
        AND column_name IN ('archived_at','archived_by','archive_reason','maintenance_status','last_maintenance_at','next_maintenance_at')),
    NULL::text;
  RETURN QUERY SELECT 'work_center_archive_cols'::text,
    (SELECT count(*) = 3 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='work_centers'
        AND column_name IN ('archived_at','archived_by','archive_reason')),
    NULL::text;
  RETURN QUERY SELECT 'operation_archive_cols'::text,
    (SELECT count(*) = 3 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='manufacturing_operations'
        AND column_name IN ('archived_at','archived_by','archive_reason')),
    NULL::text;
END $$;
