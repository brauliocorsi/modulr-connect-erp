DO $mig$
DECLARE
  v_src text;
  v_new text;
BEGIN
  -- _test_phase15_m5: substitui o cálculo de "tag" por versão com UUID
  v_src := pg_get_functiondef('public._test_phase15_m5()'::regprocedure);
  v_new := replace(
    v_src,
    $old$tag text := 'TESTE_M5_' || to_char(now(),'YYYYMMDDHH24MISSMS');$old$,
    $new$tag text := 'TESTE_M5_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);$new$
  );
  IF v_new = v_src THEN
    RAISE EXCEPTION 'Could not patch _test_phase15_m5: prefix line not found';
  END IF;
  EXECUTE v_new;

  -- _test_phase16_b0_6_allocation_hooks: substitui o cálculo de "v_prefix"
  v_src := pg_get_functiondef('public._test_phase16_b0_6_allocation_hooks()'::regprocedure);
  v_new := replace(
    v_src,
    $old$v_prefix text := 'F16B06_' || to_char(now(),'YYYYMMDDHH24MISSMS');$old$,
    $new$v_prefix text := 'F16B06_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);$new$
  );
  IF v_new = v_src THEN
    RAISE EXCEPTION 'Could not patch _test_phase16_b0_6_allocation_hooks: prefix line not found';
  END IF;
  EXECUTE v_new;
END
$mig$;