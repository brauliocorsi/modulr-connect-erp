DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='_test_phase16_b0_4_close_mo_finished_reservation';
  EXECUTE 'CREATE OR REPLACE FUNCTION public._test_phase16_b0_4_close_mo_finished_reservation() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS $body$'
       || replace(v_src, '''sale_order''', '''sale''')
       || '$body$';
END $$;