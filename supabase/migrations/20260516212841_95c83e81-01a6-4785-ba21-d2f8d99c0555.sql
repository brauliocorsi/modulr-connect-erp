
-- Surgical patch: replace 'mo' literal in test
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public._test_phase16_b0_6_allocation_hooks'::regproc) INTO v_src;
  v_src := replace(v_src, $a$'mo',v_mo$a$, $a$'manufacturing',v_mo$a$);
  EXECUTE v_src;
END $$;
