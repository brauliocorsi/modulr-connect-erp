TRUNCATE public._test_regression_log;
DO $$
DECLARE
  v_scalar text[] := ARRAY['_test_phase17_golden_flow'];
  v_setof text[] := ARRAY[
    '_test_purchase_need_to_po_flow',
    '_test_phase16_shopfloor_workorders',
    '_test_phase16_component_variant_flow',
    '_test_phase16_multilevel_bom_subassembly',
    '_test_phase16_c1_bom_resolution_readonly',
    '_test_phase16_c2_mo_materialization',
    '_test_phase16_c3_component_purchase_reservation',
    '_test_phase16_c4_close_mo_outputs',
    '_test_phase13',
    '_test_phase14',
    '_test_phase15_2',
    '_test_phase15_m3',
    '_test_phase15_m4',
    '_test_phase15_m5'
  ];
  t text; r jsonb;
BEGIN
  -- Scalar
  FOREACH t IN ARRAY v_scalar LOOP
    BEGIN
      EXECUTE format('SELECT public.%I(true)', t) INTO r;
    EXCEPTION WHEN OTHERS THEN r := jsonb_build_object('error', SQLSTATE||':'||SQLERRM); END;
    INSERT INTO public._test_regression_log(test,result) VALUES (t, r);
  END LOOP;
  -- Set-returning: agregar todas as linhas
  FOREACH t IN ARRAY v_setof LOOP
    BEGIN
      EXECUTE format('SELECT jsonb_agg(to_jsonb(x)) FROM public.%I() AS x', t) INTO r;
    EXCEPTION WHEN OTHERS THEN r := jsonb_build_object('error', SQLSTATE||':'||SQLERRM); END;
    INSERT INTO public._test_regression_log(test,result) VALUES (t, r);
  END LOOP;
END $$;