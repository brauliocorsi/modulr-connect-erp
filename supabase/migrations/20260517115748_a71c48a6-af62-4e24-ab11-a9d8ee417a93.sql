DO $$
DECLARE
  v_funcs text[] := ARRAY[
    '_test_phase16_c4_close_mo_outputs',
    '_test_phase16_c3_component_purchase_reservation',
    '_test_phase16_c2_mo_materialization',
    '_test_phase16_c1_bom_resolution_readonly',
    '_test_phase16_b_schema',
    '_test_inventory_allocation_policy',
    '_test_phase16_b0_6_allocation_hooks',
    '_test_phase16_b0_5_cancel_allocation_policy',
    '_test_phase16_b0_4_close_mo_finished_reservation',
    '_test_phase16_b0_3_allocation_engine',
    '_test_phase16_b0_2_readonly',
    '_test_phase13',
    '_test_phase14',
    '_test_phase15_2',
    '_test_phase15_m3',
    '_test_phase15_m4',
    '_test_phase15_m5'
  ];
  v_fname text; v_sql text;
  v_pass int; v_fail int;
  v_total_pass int := 0; v_total_fail int := 0;
  v_report text := '';
  v_result_type text;
  v_jres jsonb;
  v_failed_tests text;
BEGIN
  FOREACH v_fname IN ARRAY v_funcs LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v_fname) THEN
      v_report := v_report || E'\n  SKIP '||v_fname;
      CONTINUE;
    END IF;

    SELECT pg_get_function_result(oid) INTO v_result_type FROM pg_proc WHERE proname = v_fname LIMIT 1;

    BEGIN
      IF v_result_type = 'jsonb' THEN
        EXECUTE format('SELECT public.%I()', v_fname) INTO v_jres;
        -- Accept either {passed,failed} or {pass,fail} or array of {ok}
        IF jsonb_typeof(v_jres) = 'array' THEN
          SELECT count(*) FILTER (WHERE (e->>'ok')::boolean OR (e->>'passed')::boolean),
                 count(*) FILTER (WHERE NOT COALESCE((e->>'ok')::boolean, (e->>'passed')::boolean, false))
            INTO v_pass, v_fail
            FROM jsonb_array_elements(v_jres) e;
        ELSE
          v_pass := COALESCE((v_jres->>'passed')::int, (v_jres->>'pass')::int, 0);
          v_fail := COALESCE((v_jres->>'failed')::int, (v_jres->>'fail')::int, 0);
          IF v_fail > 0 AND jsonb_typeof(v_jres->'tests') = 'array' THEN
            SELECT string_agg(e::text, ' | ') INTO v_failed_tests
              FROM jsonb_array_elements(v_jres->'tests') e
              WHERE NOT COALESCE((e->>'ok')::boolean,(e->>'passed')::boolean,false);
          ELSE v_failed_tests := NULL;
          END IF;
        END IF;
      ELSE
        EXECUTE format(
          'SELECT count(*) FILTER (WHERE passed), count(*) FILTER (WHERE NOT passed),'
          ' string_agg(CASE WHEN NOT passed THEN test_name||'':''||COALESCE(detail,'''') END, '' | '')'
          ' FROM public.%I()', v_fname)
          INTO v_pass, v_fail, v_failed_tests;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_report := v_report || E'\n  ERROR '||v_fname||' :: '||SQLERRM;
      v_total_fail := v_total_fail + 1;
      CONTINUE;
    END;

    v_total_pass := v_total_pass + COALESCE(v_pass,0);
    v_total_fail := v_total_fail + COALESCE(v_fail,0);
    v_report := v_report || E'\n  '||v_fname||' pass='||COALESCE(v_pass,0)::text||' fail='||COALESCE(v_fail,0)::text;
    IF COALESCE(v_fail,0) > 0 THEN
      v_report := v_report || E'\n    failed: '||COALESCE(v_failed_tests,'(no detail)');
    END IF;
  END LOOP;

  IF v_total_fail > 0 THEN
    RAISE EXCEPTION E'C.4 regression FAILED total_pass=% total_fail=% report:%',
      v_total_pass, v_total_fail, v_report;
  END IF;
  RAISE NOTICE 'C.4 regression OK total_pass=% report:%', v_total_pass, v_report;
END $$;