
CREATE OR REPLACE FUNCTION public._test_phase15_m5_safe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r jsonb; v_ctx text;
BEGIN
  r := public._test_phase15_m5();
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'sqlstate', SQLSTATE, 'context', v_ctx);
END $$;
