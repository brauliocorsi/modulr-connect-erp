CREATE OR REPLACE FUNCTION public._test_phase16_b0_4_close_mo_finished_reservation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B04_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_company uuid; v_wh uuid; v_loc uuid;
  v_comp uuid;
  v_pA uuid; v_pB uuid; v_pC uuid; v_pD uuid; v_pE uuid; v_pF uuid; v_pG uuid;
  v_mo_a uuid; v_mo_b uuid; v_mo_c uuid; v_mo_d uuid; v_mo_e uuid; v_mo_f uuid; v_mo_g uuid;
  v_so_pend uuid; v_sol_pend uuid;
  v_so_active uuid; v_sol_active uuid;
  v_so_cancel uuid; v_sol_cancel uuid;
  v_qty_q numeric; v_qty_res numeric; v_qty_sol numeric;
  v_pkg_count int; v_pkg_res_count int; v_pkg_avail_count int;
  v_log_count int; v_neg_count bigint; v_inv_count bigint;
  v_r jsonb; v_ok boolean; v_passed int := 0; v_failed int := 0;
  v_err text;
BEGIN
  SELECT id INTO v_partner FROM public.partners WHERE COALESCE(is_customer,true)=true LIMIT 1;
  IF v_partner IS NULL THEN SELECT id INTO v_partner FROM public.partners LIMIT 1; END IF;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses WHERE COALESCE(active,true)=true LIMIT 1;
  SELECT id INTO v_loc FROM public.stock_locations WHERE warehouse_id=v_wh AND type='internal' LIMIT 1;
  IF v_loc IS NULL THEN SELECT id INTO v_loc FROM public.stock_locations WHERE type='internal' LIMIT 1; END IF;

  -- Shared component product with plenty of stock
  INSERT INTO public.products(name,type,active,can_be_purchased,company_id)
    VALUES (v_prefix||'_COMP','storable',true,true,v_company) RETURNING id INTO v_comp;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
    VALUES (v_comp,v_loc,10000,0);

  -- Products
  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_MANUAL','storable',true,true,true,false,'oldest_order_first',v_company) RETURNING id INTO v_pA;
  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_PKG_OK','storable',true,true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pB;
  INSERT INTO public.product_package_templates(product_id,name,package_sequence,package_total,is_required,active)
    VALUES (v_pB,'BOX1',1,2,true,true), (v_pB,'BOX2',2,2,true,true);

  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_POOL','storable',true,true,true,'stock_pool_first',v_company) RETURNING id INTO v_pC;

  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_SO_ACTIVE','storable',true,true,true,'stock_pool_first',v_company) RETURNING id INTO v_pD;

  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_SO_PKG','storable',true,true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pE;
  INSERT INTO public.product_package_templates(product_id,name,package_sequence,package_total,is_required,active)
    VALUES (v_pE,'BOX1',1,1,true,true);

  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_PKG_NO_TMPL','storable',true,true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pF;

  INSERT INTO public.products(name,type,active,can_be_sold,can_be_manufactured,allocation_policy,company_id)
    VALUES (v_prefix||'_FG_SO_CANCEL','storable',true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pG;

  ----------------------------------------------------------------------
  -- SCENARIO A: manual MO (no SO) - simple finished good to free stock
  ----------------------------------------------------------------------
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin)
    VALUES (v_prefix||'_MA','00000000-0000-0000-0000-000000000000',1,'draft',v_wh,'manual') RETURNING id INTO v_mo_a;
  UPDATE public.manufacturing_orders SET product_id=v_pA, qty=2 WHERE id=v_mo_a;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_a, v_comp, 2);

  v_r := public.close_mo(v_mo_a, NULL);

  SELECT COALESCE(sum(quantity),0), COALESCE(sum(reserved_quantity),0)
    INTO v_qty_q, v_qty_res
    FROM public.stock_quants WHERE product_id=v_pA;
  v_ok := v_qty_q = 2 AND v_qty_res = 0 AND (v_r->>'case')='manual';
  v_tests := v_tests || jsonb_build_object('name','01_manual_mo_free_stock','passed',v_ok,
    'observed', jsonb_build_object('qty',v_qty_q,'res',v_qty_res,'case',v_r->>'case'));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO B: manual MO with package_tracking ON + templates
  ----------------------------------------------------------------------
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin)
    VALUES (v_prefix||'_MB',v_pB,3,'draft',v_wh,'manual') RETURNING id INTO v_mo_b;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_b, v_comp, 3);

  v_r := public.close_mo(v_mo_b, NULL);

  SELECT count(*) INTO v_pkg_count FROM public.stock_packages WHERE manufacturing_order_id=v_mo_b;
  SELECT count(*) INTO v_pkg_avail_count FROM public.stock_packages
    WHERE manufacturing_order_id=v_mo_b AND status='available' AND sale_order_line_id IS NULL;
  v_ok := v_pkg_count = 6 AND v_pkg_avail_count = 6;
  v_tests := v_tests || jsonb_build_object('name','02_manual_mo_packages_available','passed',v_ok,
    'observed', jsonb_build_object('total',v_pkg_count,'available',v_pkg_avail_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO C: manual MO triggers run_inventory_allocation for pending SO
  ----------------------------------------------------------------------
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_SO_PEND',v_partner,'confirmed',v_wh,v_company,now()-interval '5 days')
    RETURNING id INTO v_so_pend;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_pend,v_pC,4,'waiting_purchase',current_date+10)
    RETURNING id INTO v_sol_pend;

  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin)
    VALUES (v_prefix||'_MC',v_pC,4,'draft',v_wh,'manual') RETURNING id INTO v_mo_c;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_c, v_comp, 4);

  v_r := public.close_mo(v_mo_c, NULL);

  SELECT qty_reserved INTO v_qty_sol FROM public.sale_order_lines WHERE id=v_sol_pend;
  v_ok := v_qty_sol = 4;
  v_tests := v_tests || jsonb_build_object('name','03_manual_mo_runs_allocation','passed',v_ok,
    'observed', jsonb_build_object('qty_reserved_on_pending_sol',v_qty_sol));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO D: MO linked to active SO  → reserves for SO original
  -- (uses stock_pool_first product to also verify policy is bypassed)
  ----------------------------------------------------------------------
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id)
    VALUES (v_prefix||'_SO_ACT',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_active;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_active,v_pD,5,'waiting_manufacturing') RETURNING id INTO v_sol_active;

  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_MD',v_pD,5,'draft',v_wh,'sale_order',v_so_active,v_sol_active) RETURNING id INTO v_mo_d;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_d, v_comp, 5);

  v_r := public.close_mo(v_mo_d, NULL);

  SELECT COALESCE(sum(quantity),0), COALESCE(sum(reserved_quantity),0)
    INTO v_qty_q, v_qty_res
    FROM public.stock_quants WHERE product_id=v_pD;
  SELECT qty_reserved INTO v_qty_sol FROM public.sale_order_lines WHERE id=v_sol_active;

  v_ok := v_qty_q = 5 AND v_qty_res = 5 AND v_qty_sol = 5 AND (v_r->>'case')='sale_active';
  v_tests := v_tests || jsonb_build_object('name','04_sale_active_reserves_for_so','passed',v_ok,
    'observed', jsonb_build_object('qty',v_qty_q,'res',v_qty_res,'sol_res',v_qty_sol,'case',v_r->>'case'));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 05: stock_pool_first product still reserves for original SO (already implicit in 04, restate)
  v_ok := v_qty_sol = 5 AND v_qty_res = 5;
  v_tests := v_tests || jsonb_build_object('name','05_pool_policy_ignored_for_sale_active','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 06: no allocation_decision created for sale_active (would mean engine was called)
  SELECT count(*) INTO v_inv_count FROM public.allocation_decisions
    WHERE product_id = v_pD;
  v_ok := v_inv_count = 0;
  v_tests := v_tests || jsonb_build_object('name','06_sale_active_no_allocation_engine','passed',v_ok,
    'observed', jsonb_build_object('decisions',v_inv_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 07/08 covered by 04. Add explicit checks:
  v_ok := v_qty_q = 5;
  v_tests := v_tests || jsonb_build_object('name','07_stock_quants_quantity_increases','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_ok := v_qty_res = 5;
  v_tests := v_tests || jsonb_build_object('name','08_reserved_only_for_sale_active','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 09: free available = quantity - reserved = 0
  v_ok := (v_qty_q - v_qty_res) = 0;
  v_tests := v_tests || jsonb_build_object('name','09_no_free_stock_when_sale_active','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 10: sale_order_line.qty_reserved increases correctly
  v_ok := v_qty_sol = 5;
  v_tests := v_tests || jsonb_build_object('name','10_sale_order_line_qty_reserved','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO E: MO of active SO with package tracking ON
  ----------------------------------------------------------------------
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id)
    VALUES (v_prefix||'_SO_PKG',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_active;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_active,v_pE,2,'waiting_manufacturing') RETURNING id INTO v_sol_active;

  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_ME',v_pE,2,'draft',v_wh,'sale_order',v_so_active,v_sol_active) RETURNING id INTO v_mo_e;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_e, v_comp, 2);

  v_r := public.close_mo(v_mo_e, NULL);

  SELECT count(*) INTO v_pkg_res_count FROM public.stock_packages
    WHERE manufacturing_order_id=v_mo_e AND status='reserved'
      AND sale_order_line_id=v_sol_active AND sale_order_id=v_so_active;
  v_ok := v_pkg_res_count = 2;
  v_tests := v_tests || jsonb_build_object('name','11_sale_active_packages_reserved','passed',v_ok,
    'observed', jsonb_build_object('reserved_pkgs',v_pkg_res_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT count(*) INTO v_pkg_count FROM public.stock_packages
    WHERE manufacturing_order_id=v_mo_e;
  v_ok := v_pkg_count = 2;
  v_tests := v_tests || jsonb_build_object('name','12_packages_have_mo_id','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT count(*) INTO v_pkg_count FROM public.stock_packages
    WHERE manufacturing_order_id=v_mo_e AND sale_order_line_id=v_sol_active;
  v_ok := v_pkg_count = 2;
  v_tests := v_tests || jsonb_build_object('name','13_packages_have_sol_id_when_sale_active','passed',v_ok);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO F: package_tracking ON but no templates → fails with rollback
  ----------------------------------------------------------------------
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin)
    VALUES (v_prefix||'_MF',v_pF,1,'draft',v_wh,'manual') RETURNING id INTO v_mo_f;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_f, v_comp, 1);

  v_err := NULL;
  BEGIN
    PERFORM public.close_mo(v_mo_f, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  SELECT COALESCE(sum(quantity),0) INTO v_qty_q FROM public.stock_quants WHERE product_id=v_pF;
  SELECT state::text INTO v_err FROM public.manufacturing_orders WHERE id=v_mo_f;
  v_ok := v_qty_q = 0 AND v_err = 'draft';
  v_tests := v_tests || jsonb_build_object('name','14_pkg_tracking_no_templates_rollback','passed',v_ok,
    'observed', jsonb_build_object('qty',v_qty_q,'mo_state',v_err));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- 15: Idempotency — re-call close_mo on done MO (use mo_d from sale_active)
  ----------------------------------------------------------------------
  v_r := public.close_mo(v_mo_d, NULL);
  SELECT COALESCE(sum(quantity),0), COALESCE(sum(reserved_quantity),0)
    INTO v_qty_q, v_qty_res FROM public.stock_quants WHERE product_id=v_pD;
  SELECT qty_reserved INTO v_qty_sol FROM public.sale_order_lines WHERE id=v_sol_active;
  -- v_sol_active was reassigned to scenario E above; reselect mo_d sol
  SELECT qty_reserved INTO v_qty_sol FROM public.sale_order_lines sol
    JOIN public.manufacturing_orders mo ON mo.sale_order_line_id = sol.id
   WHERE mo.id = v_mo_d;
  v_ok := v_qty_q = 5 AND v_qty_res = 5 AND v_qty_sol = 5 AND (v_r->>'already')='done';
  v_tests := v_tests || jsonb_build_object('name','15_idempotent_no_duplication','passed',v_ok,
    'observed', jsonb_build_object('qty',v_qty_q,'res',v_qty_res,'sol_res',v_qty_sol,'rep',v_r));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- SCENARIO G: MO of cancelled SO → free stock + run allocation
  ----------------------------------------------------------------------
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id)
    VALUES (v_prefix||'_SO_CANC',v_partner,'cancelled',v_wh,v_company) RETURNING id INTO v_so_cancel;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_cancel,v_pG,3,'waiting_manufacturing') RETURNING id INTO v_sol_cancel;

  -- Also create a fresh pending SO that should be allocated
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_SO_PEND_G',v_partner,'confirmed',v_wh,v_company,now()-interval '1 day')
    RETURNING id INTO v_so_pend;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_pend,v_pG,3,'waiting_purchase',current_date+10) RETURNING id INTO v_sol_pend;

  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_MG',v_pG,3,'draft',v_wh,'sale_order',v_so_cancel,v_sol_cancel) RETURNING id INTO v_mo_g;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_g, v_comp, 3);

  v_r := public.close_mo(v_mo_g, NULL);

  SELECT qty_reserved INTO v_qty_sol FROM public.sale_order_lines WHERE id=v_sol_pend;
  SELECT qty_reserved INTO v_qty_q   FROM public.sale_order_lines WHERE id=v_sol_cancel;
  v_ok := (v_r->>'case')='sale_cancelled' AND v_qty_sol = 3 AND v_qty_q = 0;
  v_tests := v_tests || jsonb_build_object('name','16_sale_cancelled_to_stock_and_allocates','passed',v_ok,
    'observed', jsonb_build_object('case',v_r->>'case','allocated_pending',v_qty_sol,'cancel_sol_res',v_qty_q));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- 17: components consumed once (manual mo_a used 2 from v_comp)
  ----------------------------------------------------------------------
  SELECT qty_consumed INTO v_qty_q FROM public.mo_components WHERE mo_id=v_mo_a;
  v_ok := v_qty_q = 2;
  v_tests := v_tests || jsonb_build_object('name','17_components_consumed_once','passed',v_ok,
    'observed', jsonb_build_object('qty_consumed',v_qty_q));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  ----------------------------------------------------------------------
  -- 18: component reserved_quantity non-negative across all quants
  ----------------------------------------------------------------------
  SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE reserved_quantity < 0;
  v_ok := v_neg_count = 0;
  v_tests := v_tests || jsonb_build_object('name','18_no_negative_reserved','passed',v_ok,
    'observed', jsonb_build_object('neg_reserved',v_neg_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 19: no negative quantity
  SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE quantity < 0;
  v_ok := v_neg_count = 0;
  v_tests := v_tests || jsonb_build_object('name','19_no_negative_quantity','passed',v_ok,
    'observed', jsonb_build_object('neg_qty',v_neg_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 20: reserved_quantity <= quantity
  SELECT count(*) INTO v_inv_count FROM public.stock_quants WHERE reserved_quantity > quantity;
  v_ok := v_inv_count = 0;
  v_tests := v_tests || jsonb_build_object('name','20_reserved_le_quantity','passed',v_ok,
    'observed', jsonb_build_object('violations',v_inv_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 21: produced for active SO doesn't appear as free stock
  SELECT (COALESCE(sum(quantity),0) - COALESCE(sum(reserved_quantity),0))
    INTO v_qty_q FROM public.stock_quants WHERE product_id=v_pD;
  v_ok := v_qty_q = 0;
  v_tests := v_tests || jsonb_build_object('name','21_active_so_fg_not_free','passed',v_ok,
    'observed', jsonb_build_object('free',v_qty_q));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 22: stock_reservation_log has MO origin + payload.source for our MOs
  SELECT count(*) INTO v_log_count FROM public.stock_reservation_log
    WHERE origin_type='MO' AND origin_id IN (v_mo_a,v_mo_b,v_mo_c,v_mo_d,v_mo_e,v_mo_g)
      AND payload IS NOT NULL AND payload ? 'source';
  v_ok := v_log_count >= 6;
  v_tests := v_tests || jsonb_build_object('name','22_reservation_log_with_payload_source','passed',v_ok,
    'observed', jsonb_build_object('logs',v_log_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  RETURN jsonb_build_object(
    'phase','F16-B0.4',
    'passed',v_passed,
    'failed',v_failed,
    'total',v_passed+v_failed,
    'tests',v_tests
  );
END $function$;