
DO $mig$
DECLARE
  v_src text := pg_get_functiondef('public._test_phase16_b_schema()'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_src,
    'INSERT INTO public.products(name, sku, can_be_manufactured, can_be_purchased, type)',
    'INSERT INTO public.products(name, internal_ref, can_be_manufactured, can_be_purchased, type)');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'patch failed';
  END IF;
  EXECUTE v_new;
END $mig$;
