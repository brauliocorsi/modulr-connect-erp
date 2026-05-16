
DO $mig$
DECLARE
  v_src text := pg_get_functiondef('public._test_phase16_b_schema()'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_src, $$, 'product')$$, $$, 'storable')$$);
  IF v_new = v_src THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE v_new;
END $mig$;
