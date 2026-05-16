
-- Patch only the offending state value in the test function via inline create-or-replace
-- (uses 'confirmed' instead of 'sale')
DO $do$
BEGIN
  EXECUTE replace(pg_get_functiondef('public._test_phase15_m3'::regproc), $$state, 'sale'$$, $$state, 'confirmed'$$);
END $do$;
