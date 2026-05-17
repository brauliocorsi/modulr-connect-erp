CREATE TABLE IF NOT EXISTS public._test_regression_log(id serial primary key, ran_at timestamptz default now(), test text, result jsonb);
TRUNCATE public._test_regression_log;
DO $$
DECLARE
  v_tests text[] := ARRAY[
    '_test_phase17_golden_flow',
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
  FOREACH t IN ARRAY v_tests LOOP
    BEGIN
      IF t = '_test_phase17_golden_flow' THEN
        EXECUTE format('SELECT to_jsonb(x) FROM (SELECT * FROM public.%I(true) AS r) x', t) INTO r;
      ELSE
        EXECUTE format('SELECT to_jsonb(x) FROM (SELECT * FROM public.%I() AS r) x', t) INTO r;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('error', SQLSTATE||':'||SQLERRM);
    END;
    INSERT INTO public._test_regression_log(test,result) VALUES (t, r);
  END LOOP;
END $$;