
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef('public._test_phase16_b0_6_allocation_hooks'::regproc) INTO v_src;
  v_src := replace(v_src,
    $a$INSERT INTO public.inventory_adjustments(name,location_id,state,company_id)$a$,
    $a$INSERT INTO public.inventory_adjustments(name,location_id,state)$a$);
  v_src := replace(v_src,
    $a$VALUES (v_prefix||'_ADJ',v_loc,'draft',v_company)$a$,
    $a$VALUES (v_prefix||'_ADJ',v_loc,'draft')$a$);
  v_src := replace(v_src,
    $a$VALUES (v_prefix||'_ADJC',v_loc_cust,'draft',v_company)$a$,
    $a$VALUES (v_prefix||'_ADJC',v_loc_cust,'draft')$a$);
  EXECUTE v_src;
END $$;
