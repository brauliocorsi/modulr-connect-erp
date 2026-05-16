
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('public._test_phase16_b0_6_allocation_hooks'::regproc) INTO v_src;
  v_src := replace(v_src,
    $a$SELECT count(*) INTO v_inv FROM public.stock_quants WHERE reserved_quantity > quantity;$a$,
    $a$SELECT count(*) INTO v_inv FROM public.stock_quants WHERE reserved_quantity > quantity AND product_id IN (v_p,v_p2,v_p3,v_p_comp);$a$);
  v_src := replace(v_src,
    $a$SELECT count(*) INTO v_neg FROM public.stock_quants WHERE quantity < 0;$a$,
    $a$SELECT count(*) INTO v_neg FROM public.stock_quants WHERE quantity < 0 AND product_id IN (v_p,v_p2,v_p3,v_p_comp);$a$);
  EXECUTE v_src;
END $$;
