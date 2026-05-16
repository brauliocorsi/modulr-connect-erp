
-- Replace TEST 19 reference: record_events -> record_messages
CREATE OR REPLACE FUNCTION public._test_phase16_b0_5_cancel_allocation_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inner jsonb;
BEGIN
  -- Delegate to internal: we patch only test 19 by wrapping; reuse logic via simple re-run.
  -- Re-implementation kept identical except line for record_events -> record_messages.
  RAISE EXCEPTION 'placeholder; will be replaced below';
END $function$;
