
CREATE OR REPLACE FUNCTION public._test_phase16_b0_5_cancel_allocation_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B05_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_company uuid; v_wh uuid; v_loc uuid;
  v_pA uuid; v_pB uuid; v_pC uuid; v_pD uuid; v_pE uuid; v_pB12 uuid;
  v_so_legacy uuid; v_sol_legacy uuid;
  v_so2 uuid; v_sol2 uuid; v_so3 uuid; v_sol3 uuid; v_so4 uuid; v_sol4 uuid; v_so5 uuid; v_sol5 uuid;
  v_so6 uuid; v_sol6 uuid; v_so7 uuid; v_sol7 uuid;
  v_so_target uuid; v_sol_target uuid; v_so_alt uuid; v_sol_alt uuid;
  v_pkg uuid; v_pkg2 uuid; v_pkg_dmg uuid;
  v_r jsonb; v_state text; v_status text;
  v_cnt int; v_neg bigint; v_inv bigint; v_dec_count int; v_log_count int;
  v_passed int := 0; v_failed int := 0; v_comp uuid;
  v_so_dlv uuid; v_sol_dlv uuid; v_pkg_dlv uuid;
  v_so_dmg uuid; v_sol_dmg uuid;
  v_before_resv numeric; v_after_resv numeric;
  v_so_t uuid; v_sol_t uuid;
  v_so_pk uuid; v_sol_pk uuid; v_pkg_safe uuid;
  v_so_new uuid; v_sol_new uuid; v_so_src uuid; v_sol_src uuid; v_pkg_r uuid; v_pkg_now_so uuid;
  v_so_md uuid; v_sol_md uuid; v_mo_draft uuid;
  v_so_mi uuid; v_sol_mi uuid; v_mo_inprog uuid;
  v_so_mp uuid; v_sol_mp uuid; v_mo_inprog_pool uuid; v_mo_so uuid;
  v_so_mdone uuid; v_sol_mdone uuid; v_mo_done uuid; v_mo_st text;
BEGIN
  SELECT id INTO v_partner FROM public.partners WHERE COALESCE(is_customer,true)=true LIMIT 1;
  IF v_partner IS NULL THEN SELECT id INTO v_partner FROM public.partners LIMIT 1; END IF;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses WHERE COALESCE(active,true)=true LIMIT 1;
  SELECT id INTO v_loc FROM public.stock_locations WHERE warehouse_id=v_wh AND type='internal' LIMIT 1;
  IF v_loc IS NULL THEN SELECT id INTO v_loc FROM public.stock_locations WHERE type='internal' LIMIT 1; END IF;

  INSERT INTO public.products(name,type,active,can_be_purchased,company_id)
    VALUES (v_prefix||'_COMP','storable',true,true,v_company) RETURNING id INTO v_comp;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
    VALUES (v_comp,v_loc,10000,0);

  INSERT INTO public.products(name,type,active,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_A','storable',true,true,'oldest_order_first',v_company) RETURNING id INTO v_pA;
  INSERT INTO public.products(name,type,active,can_be_sold,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_B','storable',true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pB;
  INSERT INTO public.products(name,type,active,can_be_sold,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_C','storable',true,true,true,'strict_order',v_company) RETURNING id INTO v_pC;
  INSERT INTO public.products(name,type,active,can_be_sold,allocation_policy,can_be_manufactured,company_id)
    VALUES (v_prefix||'_D','storable',true,true,'strict_order',true,v_company) RETURNING id INTO v_pD;
  INSERT INTO public.products(name,type,active,can_be_sold,allocation_policy,can_be_manufactured,company_id)
    VALUES (v_prefix||'_E','storable',true,true,'stock_pool_first',true,v_company) RETURNING id INTO v_pE;
  -- Produto isolado para o teste 12 (evita interferência de packages remanescentes do teste 11)
  INSERT INTO public.products(name,type,active,can_be_sold,package_tracking_enabled,allocation_policy,company_id)
    VALUES (v_prefix||'_B12','storable',true,true,true,'oldest_order_first',v_company) RETURNING id INTO v_pB12;

  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
    VALUES (v_pA,v_loc,100,0),(v_pB,v_loc,0,0),(v_pC,v_loc,0,0),(v_pD,v_loc,0,0),(v_pE,v_loc,0,0),(v_pB12,v_loc,0,0);

  -- 1
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
      VALUES (v_prefix||'_LEG',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_legacy;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved)
      VALUES (v_so_legacy,v_pA,1,0) RETURNING id INTO v_sol_legacy;
    PERFORM public.cancel_sale_order(v_so_legacy);
    SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so_legacy;
    v_tests := v_tests || jsonb_build_object('test','1_legacy_signature','ok',v_state='cancelled','detail',jsonb_build_object('state',v_state));
  EXCEPTION WHEN OTHERS THEN
    v_tests := v_tests || jsonb_build_object('test','1_legacy_signature','ok',false,'detail',jsonb_build_object('err',SQLERRM));
  END;

  -- 2
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_TGT',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_target;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_target,v_pA,5,0) RETURNING id INTO v_sol_target;
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S2',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so2,v_pA,3,3) RETURNING id INTO v_sol2;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+3 WHERE product_id=v_pA AND location_id=v_loc;
  v_r := public.cancel_sale_order(v_so2, jsonb_build_object('reservation_action','run_allocation'));
  v_tests := v_tests || jsonb_build_object('test','2_run_allocation','ok',(v_r->>'ok')::boolean,'detail',v_r);

  -- 3
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_ALT',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_alt;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_alt,v_pA,4,0) RETURNING id INTO v_sol_alt;
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S3',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so3;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so3,v_pA,2,2) RETURNING id INTO v_sol3;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+2 WHERE product_id=v_pA AND location_id=v_loc;
  v_r := public.cancel_sale_order(v_so3, jsonb_build_object('reservation_action','manual_reassign','target_sale_order_line_id',v_sol_alt::text));
  v_tests := v_tests || jsonb_build_object('test','3_manual_reassign','ok',(v_r->>'ok')::boolean,'detail',v_r);

  -- 4
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S4',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so4;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so4,v_pA,2,2) RETURNING id INTO v_sol4;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+2 WHERE product_id=v_pA AND location_id=v_loc;
  v_r := public.cancel_sale_order(v_so4, jsonb_build_object('reservation_action','release_to_stock'));
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so4;
  v_tests := v_tests || jsonb_build_object('test','4_release_to_stock','ok',v_state='cancelled' AND jsonb_array_length(COALESCE(v_r->'reallocation','[]'::jsonb))=0,'detail',jsonb_build_object('state',v_state));

  -- 5
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S5',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so5;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so5,v_pD,2,0) RETURNING id INTO v_sol5;
  v_r := public.cancel_sale_order(v_so5, jsonb_build_object('reservation_action','decision_required'));
  SELECT count(*) INTO v_dec_count FROM public.allocation_decisions WHERE (payload->>'sale_order_id')::uuid = v_so5 AND state='pending';
  v_tests := v_tests || jsonb_build_object('test','5_decision_required','ok',v_dec_count>=1,'detail',jsonb_build_object('count',v_dec_count));

  -- 6
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S6',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so6;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so6,v_pB,1,1) RETURNING id INTO v_sol6;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB,v_so6,v_sol6,1,'at_dock','good',v_loc) RETURNING id INTO v_pkg;
  v_r := public.cancel_sale_order(v_so6);
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so6;
  v_tests := v_tests || jsonb_build_object('test','6_at_dock_blocks','ok',v_state<>'cancelled' AND (v_r->>'state')='decision_required','detail',jsonb_build_object('state',v_state));

  -- 7
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_S7',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so7;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so7,v_pB,1,1) RETURNING id INTO v_sol7;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB,v_so7,v_sol7,1,'loaded','good',v_loc) RETURNING id INTO v_pkg2;
  v_r := public.cancel_sale_order(v_so7);
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so7;
  v_tests := v_tests || jsonb_build_object('test','7_loaded_blocks','ok',v_state<>'cancelled','detail',jsonb_build_object('state',v_state));

  -- 8
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_SDLV',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_dlv;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_dlv,v_pB,1,1) RETURNING id INTO v_sol_dlv;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB,v_so_dlv,v_sol_dlv,1,'delivered','good',v_loc) RETURNING id INTO v_pkg_dlv;
  v_r := public.cancel_sale_order(v_so_dlv);
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so_dlv;
  v_tests := v_tests || jsonb_build_object('test','8_delivered_blocks','ok',v_state<>'cancelled','detail',jsonb_build_object('state',v_state));

  -- 9
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_SDMG',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_dmg;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_dmg,v_pB,1,1) RETURNING id INTO v_sol_dmg;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB,v_so_dmg,v_sol_dmg,1,'reserved','damaged',v_loc) RETURNING id INTO v_pkg_dmg;
  v_r := public.cancel_sale_order(v_so_dmg);
  SELECT count(*) INTO v_dec_count FROM public.allocation_decisions WHERE (payload->>'package_id')::uuid = v_pkg_dmg;
  v_tests := v_tests || jsonb_build_object('test','9_damaged_decision','ok',v_dec_count>=1,'detail',jsonb_build_object('count',v_dec_count));

  -- 10
  SELECT COALESCE(reserved_quantity,0) INTO v_before_resv FROM public.stock_quants WHERE product_id=v_pA AND location_id=v_loc;
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_STO',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_t;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_t,v_pA,2,2) RETURNING id INTO v_sol_t;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+2 WHERE product_id=v_pA AND location_id=v_loc;
  v_r := public.cancel_sale_order(v_so_t, jsonb_build_object('reservation_action','release_to_stock'));
  SELECT COALESCE(reserved_quantity,0) INTO v_after_resv FROM public.stock_quants WHERE product_id=v_pA AND location_id=v_loc;
  v_tests := v_tests || jsonb_build_object('test','10_tracking_off_release','ok',v_after_resv<=v_before_resv+2,'detail',jsonb_build_object('before',v_before_resv,'after',v_after_resv));

  -- 11
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_SPK',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_pk;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_pk,v_pB,1,1) RETURNING id INTO v_sol_pk;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB,v_so_pk,v_sol_pk,1,'reserved','good',v_loc) RETURNING id INTO v_pkg_safe;
  v_r := public.cancel_sale_order(v_so_pk);
  SELECT status::text INTO v_status FROM public.stock_packages WHERE id=v_pkg_safe;
  v_tests := v_tests || jsonb_build_object('test','11_tracking_on_release','ok',v_status='available','detail',jsonb_build_object('status',v_status));

  -- 12 — produto isolado v_pB12 para evitar interferência de packages remanescentes
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_NEW',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_new;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_new,v_pB12,1,0) RETURNING id INTO v_sol_new;
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_SRC',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_src;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_src,v_pB12,1,1) RETURNING id INTO v_sol_src;
  INSERT INTO public.stock_packages(product_id,sale_order_id,sale_order_line_id,qty,status,condition,current_location_id)
    VALUES (v_pB12,v_so_src,v_sol_src,1,'reserved','good',v_loc) RETURNING id INTO v_pkg_r;
  v_r := public.cancel_sale_order(v_so_src, jsonb_build_object('reservation_action','run_allocation'));
  SELECT sale_order_id INTO v_pkg_now_so FROM public.stock_packages WHERE id=v_pkg_r;
  v_tests := v_tests || jsonb_build_object('test','12_realloc_pkg_to_new_so','ok',v_pkg_now_so=v_so_new,'detail',jsonb_build_object('new_so',v_pkg_now_so,'expected',v_so_new));

  -- 13
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_MD',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_md;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_md,v_pE,1,0) RETURNING id INTO v_sol_md;
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_MOD',v_pE,1,'draft',v_wh,'sale',v_so_md,v_sol_md) RETURNING id INTO v_mo_draft;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required) VALUES (v_mo_draft,v_comp,1);
  v_r := public.cancel_sale_order(v_so_md);
  SELECT state::text INTO v_state FROM public.manufacturing_orders WHERE id=v_mo_draft;
  v_tests := v_tests || jsonb_build_object('test','13_mo_draft_cancelled','ok',v_state='cancelled','detail',jsonb_build_object('mo_state',v_state));

  -- 14
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_MI',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_mi;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_mi,v_pD,1,0) RETURNING id INTO v_sol_mi;
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_MOI',v_pD,1,'in_progress',v_wh,'sale',v_so_mi,v_sol_mi) RETURNING id INTO v_mo_inprog;
  v_r := public.cancel_sale_order(v_so_mi);
  SELECT state::text INTO v_state FROM public.manufacturing_orders WHERE id=v_mo_inprog;
  SELECT count(*) INTO v_dec_count FROM public.allocation_decisions WHERE (payload->>'manufacturing_order_id')::uuid = v_mo_inprog;
  v_tests := v_tests || jsonb_build_object('test','14_mo_inprog_strict','ok',v_state='in_progress' AND v_dec_count>=1,'detail',jsonb_build_object('mo_state',v_state,'dec',v_dec_count));

  -- 15
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_MP',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_mp;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_mp,v_pE,1,0) RETURNING id INTO v_sol_mp;
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id)
    VALUES (v_prefix||'_MOP',v_pE,1,'in_progress',v_wh,'sale',v_so_mp,v_sol_mp) RETURNING id INTO v_mo_inprog_pool;
  v_r := public.cancel_sale_order(v_so_mp);
  SELECT sale_order_id INTO v_mo_so FROM public.manufacturing_orders WHERE id=v_mo_inprog_pool;
  SELECT state::text INTO v_state FROM public.manufacturing_orders WHERE id=v_mo_inprog_pool;
  v_tests := v_tests || jsonb_build_object('test','15_mo_inprog_pool_detached','ok',v_mo_so IS NULL AND v_state='in_progress','detail',jsonb_build_object('mo_so',v_mo_so,'state',v_state));

  -- 16
  INSERT INTO public.sale_orders(name,partner_id,state,fulfillment_status,warehouse_id,company_id)
    VALUES (v_prefix||'_MDN',v_partner,'confirmed','pending',v_wh,v_company) RETURNING id INTO v_so_mdone;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved) VALUES (v_so_mdone,v_pE,1,0) RETURNING id INTO v_sol_mdone;
  INSERT INTO public.manufacturing_orders(code,product_id,qty,state,warehouse_id,origin,sale_order_id,sale_order_line_id,actual_end)
    VALUES (v_prefix||'_MODN',v_pE,1,'done',v_wh,'sale',v_so_mdone,v_sol_mdone,now()) RETURNING id INTO v_mo_done;
  v_r := public.cancel_sale_order(v_so_mdone);
  SELECT state::text INTO v_mo_st FROM public.manufacturing_orders WHERE id=v_mo_done;
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so_mdone;
  v_tests := v_tests || jsonb_build_object('test','16_mo_done_so_cancelled','ok',v_mo_st='done' AND v_state='cancelled','detail',jsonb_build_object('mo',v_mo_st,'so',v_state));

  -- 17
  v_r := public.cancel_sale_order(v_so4, jsonb_build_object('reservation_action','release_to_stock'));
  v_tests := v_tests || jsonb_build_object('test','17_idempotent','ok',(v_r->>'ok')::boolean = true AND (v_r->>'idempotent')::boolean = true,'detail',v_r);

  -- 18
  SELECT count(*) INTO v_log_count FROM public.stock_reservation_log WHERE origin_type='SO' AND origin_id=v_so5 AND action='decision_required';
  v_tests := v_tests || jsonb_build_object('test','18_log_decision_required','ok',v_log_count>=1,'detail',jsonb_build_object('count',v_log_count));

  -- 19  (record_messages)
  SELECT count(*) INTO v_log_count FROM public.record_messages WHERE record_type='sale_order' AND record_id=v_so2;
  v_tests := v_tests || jsonb_build_object('test','19_timeline_event','ok',v_log_count>=1,'detail',jsonb_build_object('count',v_log_count));

  -- 20
  SELECT count(*) INTO v_neg FROM public.stock_quants WHERE product_id IN (v_pA,v_pB,v_pC,v_pD,v_pE,v_pB12) AND reserved_quantity < 0;
  v_tests := v_tests || jsonb_build_object('test','20_no_negative_reserved','ok',v_neg=0,'detail',jsonb_build_object('count',v_neg));

  -- 21
  SELECT count(*) INTO v_inv FROM public.stock_quants WHERE product_id IN (v_pA,v_pB,v_pC,v_pD,v_pE,v_pB12) AND reserved_quantity > quantity;
  v_tests := v_tests || jsonb_build_object('test','21_reserved_le_quantity','ok',v_inv=0,'detail',jsonb_build_object('count',v_inv));

  -- 22
  SELECT count(*) INTO v_cnt FROM public.stock_packages p JOIN public.sale_orders so ON so.id=p.sale_order_id
   WHERE so.state='cancelled'
     AND p.status::text NOT IN ('at_dock','picked','loaded','delivered','cancelled')
     AND p.condition::text NOT IN ('damaged','quarantine','missing')
     AND so.name LIKE v_prefix||'%';
  v_tests := v_tests || jsonb_build_object('test','22_no_pkg_reserved_to_cancelled','ok',v_cnt=0,'detail',jsonb_build_object('count',v_cnt));

  -- 23
  SELECT count(*) INTO v_cnt FROM public.stock_packages WHERE id IN (v_pkg, v_pkg2) AND sale_order_id IS NULL;
  v_tests := v_tests || jsonb_build_object('test','23_physical_pkg_not_realloc','ok',v_cnt=0,'detail',jsonb_build_object('count',v_cnt));

  -- 24
  SELECT count(*) INTO v_cnt FROM public.stock_moves sm
    WHERE sm.created_at >= now() - interval '5 minutes'
      AND sm.product_id IN (v_pB,v_pC,v_pD,v_pE,v_pB12)
      AND sm.state NOT IN ('cancelled');
  v_tests := v_tests || jsonb_build_object('test','24_no_new_stock_move_tracking_on','ok',v_cnt=0,'detail',jsonb_build_object('count',v_cnt));

  SELECT count(*) FILTER (WHERE (e->>'ok')::boolean = true),
         count(*) FILTER (WHERE (e->>'ok')::boolean = false)
    INTO v_passed, v_failed FROM jsonb_array_elements(v_tests) e;

  RETURN jsonb_build_object('phase','F16-B0.5','passed',v_passed,'failed',v_failed,'total',v_passed+v_failed,'tests',v_tests);
END $function$;
