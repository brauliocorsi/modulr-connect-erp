DO $$
DECLARE r jsonb;
BEGIN
  r := public._test_phase17_golden_flow(true);
  RAISE NOTICE 'GOLDEN_FLOW_RESULT: %', r::text;
END $$;