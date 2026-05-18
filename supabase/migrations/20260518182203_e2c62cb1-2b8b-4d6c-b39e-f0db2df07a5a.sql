-- Phase 18-B closure: fix Golden Flow fixture date collision (D02)
-- Cause: _test_phase17_golden_flow used CURRENT_DATE+1 with the oldest active
-- delivery_zone, colliding with leftover routes from other fixtures
-- (e.g. TESTE_PAY_SUB_) on the same (zone_id, route_date) unique key.
-- Fix: isolate Golden Flow on CURRENT_DATE+30. Cleanup of own residue stays
-- as-is (notes LIKE 'TESTE_GOLDEN_UPM_%').

DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public._test_phase17_golden_flow(boolean)'::regprocedure);
  v_def := replace(v_def, 'CURRENT_DATE+1', 'CURRENT_DATE+30');
  EXECUTE v_def;
END;
$mig$;