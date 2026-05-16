DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname='_test_phase16_b0_4_close_mo_finished_reservation';
  v_src := replace(v_src,
    'SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE reserved_quantity < 0;',
    'SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE reserved_quantity < 0 AND product_id IN (v_pA,v_pB,v_pC,v_pD,v_pE,v_pF,v_pG,v_comp);');
  v_src := replace(v_src,
    'SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE quantity < 0;',
    'SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE quantity < 0 AND product_id IN (v_pA,v_pB,v_pC,v_pD,v_pE,v_pF,v_pG,v_comp);');
  v_src := replace(v_src,
    'SELECT count(*) INTO v_inv_count FROM public.stock_quants WHERE reserved_quantity > quantity;',
    'SELECT count(*) INTO v_inv_count FROM public.stock_quants WHERE reserved_quantity > quantity AND product_id IN (v_pA,v_pB,v_pC,v_pD,v_pE,v_pF,v_pG,v_comp);');
  EXECUTE 'CREATE OR REPLACE FUNCTION public._test_phase16_b0_4_close_mo_finished_reservation() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS $body$'
       || v_src || '$body$';
END $$;