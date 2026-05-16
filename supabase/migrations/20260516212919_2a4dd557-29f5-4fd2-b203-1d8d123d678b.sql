
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('public._test_phase16_b0_6_allocation_hooks'::regproc) INTO v_src;
  v_src := replace(v_src,
    $a$PERFORM public.apply_inventory_adjustment(v_adj_id);$a$,
    $a$PERFORM public.allocation_on_inventory_adjustment_positive(v_adj_id);$a$);
  v_src := replace(v_src,
    $a$PERFORM public.apply_inventory_adjustment(v_adj2);$a$,
    $a$PERFORM public.allocation_on_inventory_adjustment_positive(v_adj2);$a$);
  EXECUTE v_src;
END $$;
