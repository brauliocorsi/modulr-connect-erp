DROP TABLE IF EXISTS public._t16c5_regress;
CREATE TABLE public._t16c5_regress(suite text, total int, passed int, failed_detail text);

DO $$
DECLARE r record; v_tot int; v_ok int; v_failed text;
BEGIN
  -- phase16 c1..c4 (TABLE shape)
  v_tot:=0; v_ok:=0; v_failed:='';
  FOR r IN SELECT test_name, passed, detail FROM public._test_phase16_c1_bom_resolution_readonly() LOOP
    v_tot:=v_tot+1; IF r.passed THEN v_ok:=v_ok+1; ELSE v_failed:=v_failed||r.test_name||':'||COALESCE(r.detail,'')||' | '; END IF;
  END LOOP;
  INSERT INTO public._t16c5_regress VALUES('phase16_c1', v_tot, v_ok, v_failed);

  v_tot:=0; v_ok:=0; v_failed:='';
  FOR r IN SELECT test_name, passed, detail FROM public._test_phase16_c2_mo_materialization() LOOP
    v_tot:=v_tot+1; IF r.passed THEN v_ok:=v_ok+1; ELSE v_failed:=v_failed||r.test_name||':'||COALESCE(r.detail,'')||' | '; END IF;
  END LOOP;
  INSERT INTO public._t16c5_regress VALUES('phase16_c2', v_tot, v_ok, v_failed);

  v_tot:=0; v_ok:=0; v_failed:='';
  FOR r IN SELECT test_name, passed, detail FROM public._test_phase16_c3_component_purchase_reservation() LOOP
    v_tot:=v_tot+1; IF r.passed THEN v_ok:=v_ok+1; ELSE v_failed:=v_failed||r.test_name||':'||COALESCE(r.detail,'')||' | '; END IF;
  END LOOP;
  INSERT INTO public._t16c5_regress VALUES('phase16_c3', v_tot, v_ok, v_failed);

  v_tot:=0; v_ok:=0; v_failed:='';
  FOR r IN SELECT test_name, passed, detail FROM public._test_phase16_c4_close_mo_outputs() LOOP
    v_tot:=v_tot+1; IF r.passed THEN v_ok:=v_ok+1; ELSE v_failed:=v_failed||r.test_name||':'||COALESCE(r.detail,'')||' | '; END IF;
  END LOOP;
  INSERT INTO public._t16c5_regress VALUES('phase16_c4', v_tot, v_ok, v_failed);

  -- jsonb based suites
  INSERT INTO public._t16c5_regress VALUES('phase13', NULL, NULL, public._test_phase13()::text);
  INSERT INTO public._t16c5_regress VALUES('phase14', NULL, NULL, public._test_phase14()::text);
  INSERT INTO public._t16c5_regress VALUES('phase15_2', NULL, NULL, public._test_phase15_2()::text);
  INSERT INTO public._t16c5_regress VALUES('phase15_m3', NULL, NULL, public._test_phase15_m3()::text);
  INSERT INTO public._t16c5_regress VALUES('phase15_m4', NULL, NULL, public._test_phase15_m4()::text);
  INSERT INTO public._t16c5_regress VALUES('phase15_m5', NULL, NULL, public._test_phase15_m5()::text);
END $$;