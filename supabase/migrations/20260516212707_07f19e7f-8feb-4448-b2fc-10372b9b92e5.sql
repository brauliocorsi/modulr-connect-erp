
CREATE OR REPLACE FUNCTION public._test_phase16_b0_6_allocation_hooks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B06_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_passed int := 0; v_failed int := 0;
  v_partner uuid; v_company uuid; v_wh uuid; v_loc uuid; v_loc_veh uuid; v_loc_cust uuid; v_loc_sup uuid;
  v_p uuid; v_p2 uuid; v_p3 uuid; v_p_comp uuid;
  v_so uuid; v_so2 uuid; v_so_draft uuid; v_l uuid; v_l2 uuid; v_l_draft uuid;
  v_pick uuid; v_move uuid;
  v_res jsonb; v_assert_ok boolean; v_qty_res numeric;
  v_moves_before bigint; v_moves_after bigint;
  v_neg bigint; v_inv bigint;
  v_mo uuid; v_pn uuid; v_po uuid; v_pol uuid;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  SELECT id INTO v_loc FROM public.stock_locations WHERE type='internal' AND active=true
    AND NOT EXISTS (SELECT 1 FROM public.loading_docks d WHERE d.stock_location_id = stock_locations.id)
    AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.stock_location_id = stock_locations.id)
    LIMIT 1;

  INSERT INTO public.stock_locations(name,type) VALUES (v_prefix||'_CUST','customer') RETURNING id INTO v_loc_cust;
  INSERT INTO public.stock_locations(name,type) VALUES (v_prefix||'_SUP','supplier') RETURNING id INTO v_loc_sup;
  INSERT INTO public.stock_locations(name,type,warehouse_id) VALUES (v_prefix||'_VEHLOC','internal',v_wh) RETURNING id INTO v_loc_veh;
  INSERT INTO public.loading_docks(name,stock_location_id,warehouse_id) VALUES (v_prefix||'_DOCK', v_loc_veh, v_wh);

  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_P', true, 'oldest_order_first', false, v_company) RETURNING id INTO v_p;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_PON', true, 'oldest_order_first', true, v_company) RETURNING id INTO v_p2;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_P3', true, 'oldest_order_first', false, v_company) RETURNING id INTO v_p3;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_COMP', false, 'oldest_order_first', v_company) RETURNING id INTO v_p_comp;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_SO',v_partner,'confirmed',v_wh,v_company,now()-interval '1 day') RETURNING id INTO v_so;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so,v_p,10,'waiting_purchase') RETURNING id INTO v_l;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_SO2',v_partner,'confirmed',v_wh,v_company,now()-interval '2 days') RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so2,v_p2,5,'waiting_purchase') RETURNING id INTO v_l2;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_DRAFT',v_partner,'draft',v_wh,v_company,now()) RETURNING id INTO v_so_draft;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_draft,v_p3,5,'waiting_purchase') RETURNING id INTO v_l_draft;

  SELECT count(*) INTO v_moves_before FROM public.stock_moves;

  INSERT INTO public.stock_pickings(name,kind,state,source_location_id,destination_location_id,scheduled_at)
    VALUES (v_prefix||'_PO1','incoming','draft', v_loc_sup, v_loc, now()) RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
    VALUES (v_pick,v_p, v_loc_sup, v_loc, 10, 10, 'done') RETURNING id INTO v_move;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_p, v_loc, 10, 0);
  UPDATE public.stock_pickings SET state='done' WHERE id=v_pick;
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id=v_l;
  v_assert_ok := (COALESCE(v_qty_res,0) > 0);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','01_po_receipt_good_triggers','ok',v_assert_ok,'qty_res',v_qty_res));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  DECLARE v_pick2 uuid;
  BEGIN
    INSERT INTO public.stock_pickings(name,kind,state,source_location_id,destination_location_id,scheduled_at)
      VALUES (v_prefix||'_POX','incoming','draft', v_loc_sup, v_loc_cust, now()) RETURNING id INTO v_pick2;
    INSERT INTO public.stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
      VALUES (v_pick2,v_p3, v_loc_sup, v_loc_cust, 5,5,'done');
    UPDATE public.stock_pickings SET state='done' WHERE id=v_pick2;
    v_assert_ok := NOT EXISTS (SELECT 1 FROM public.allocation_hook_events WHERE source_id=v_pick2 AND event_type='po_receipt');
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','02_po_receipt_unsafe_loc_skip','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pick3 uuid;
  BEGIN
    INSERT INTO public.manufacturing_orders(product_id,qty,state,warehouse_id)
      VALUES (v_p3,1,'draft',v_wh) RETURNING id INTO v_mo;
    INSERT INTO public.purchase_orders(name,partner_id,state,company_id) VALUES (v_prefix||'_POMO',v_partner,'confirmed',v_company) RETURNING id INTO v_po;
    INSERT INTO public.purchase_order_lines(order_id,product_id,quantity,unit_price) VALUES (v_po,v_p_comp,5,1) RETURNING id INTO v_pol;
    INSERT INTO public.purchase_needs(product_id,qty_needed,origin_kind,manufacturing_order_id,state,purchase_order_id)
      VALUES (v_p_comp,5,'mo',v_mo,'po_created',v_po) RETURNING id INTO v_pn;
    INSERT INTO public.stock_pickings(name,kind,state,source_location_id,destination_location_id,origin,scheduled_at)
      VALUES (v_prefix||'_POMO_PICK','incoming','draft',v_loc_sup,v_loc, v_prefix||'_POMO', now()) RETURNING id INTO v_pick3;
    INSERT INTO public.stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
      VALUES (v_pick3,v_p_comp,v_loc_sup,v_loc,5,5,'done');
    UPDATE public.stock_pickings SET state='done' WHERE id=v_pick3;
    v_assert_ok := NOT EXISTS (
      SELECT 1 FROM public.allocation_hook_events
      WHERE event_type='po_receipt' AND source_id=v_pick3 AND product_id=v_p_comp
    );
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','03_po_component_for_mo_not_allocated','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkg uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,2,'good','available') RETURNING id INTO v_pkg;
    INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_p2,v_loc,5,0);
    SELECT public.allocation_on_return_good(v_pkg,'release_reserved') INTO v_res;
    v_assert_ok := (v_res->>'ok')::boolean;
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','04_return_good_release_triggers','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgk uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p,v_loc,1,'good','reserved') RETURNING id INTO v_pkgk;
    SELECT public.allocation_on_return_good(v_pkgk,'keep_reserved') INTO v_res;
    v_assert_ok := (v_res->>'skipped') = 'mode_not_release';
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','05_return_keep_reserved_skip','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgd uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p,v_loc,1,'damaged','available') RETURNING id INTO v_pkgd;
    SELECT public.allocation_on_return_good(v_pkgd,'release_reserved') INTO v_res;
    v_assert_ok := (v_res->>'skipped') = 'package_not_eligible';
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','06_return_damaged_skip','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgq uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p,v_loc,1,'quarantine','available') RETURNING id INTO v_pkgq;
    SELECT public.allocation_on_return_good(v_pkgq,'release_reserved') INTO v_res;
    v_assert_ok := (v_res->>'skipped') = 'package_not_eligible';
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','07_return_quarantine_skip','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_adj_id uuid;
  BEGIN
    INSERT INTO public.inventory_adjustments(name,location_id,state,company_id)
      VALUES (v_prefix||'_ADJ',v_loc,'draft',v_company) RETURNING id INTO v_adj_id;
    INSERT INTO public.inventory_adjustment_lines(adjustment_id,product_id,location_id,theoretical_qty,counted_qty)
      VALUES (v_adj_id,v_p,v_loc,0,3);
    PERFORM public.apply_inventory_adjustment(v_adj_id);
    v_assert_ok := EXISTS (SELECT 1 FROM public.allocation_hook_events WHERE event_type='inv_adj_positive' AND source_id=v_adj_id);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','08_inv_adj_positive_triggers','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_adj2 uuid;
  BEGIN
    INSERT INTO public.inventory_adjustments(name,location_id,state,company_id)
      VALUES (v_prefix||'_ADJC',v_loc_cust,'draft',v_company) RETURNING id INTO v_adj2;
    INSERT INTO public.inventory_adjustment_lines(adjustment_id,product_id,location_id,theoretical_qty,counted_qty)
      VALUES (v_adj2,v_p,v_loc_cust,0,3);
    PERFORM public.apply_inventory_adjustment(v_adj2);
    v_assert_ok := NOT EXISTS (SELECT 1 FROM public.allocation_hook_events WHERE event_type='inv_adj_positive' AND source_id=v_adj2);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','09_inv_adj_customer_loc_skip','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  SELECT public.allocation_on_manual_release(v_p,NULL,v_loc,1, v_prefix||'_REL1') INTO v_res;
  v_assert_ok := (v_res->>'ok')::boolean;
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','10_manual_release_triggers','ok',v_assert_ok));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT public.allocation_on_manual_release(v_p,NULL,v_loc_cust,1, v_prefix||'_REL2') INTO v_res;
  v_assert_ok := (v_res->>'skipped') = 'unsafe_location';
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','11_manual_release_unsafe_skip','ok',v_assert_ok));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id=v_l_draft;
  v_assert_ok := (COALESCE(v_qty_res,0) = 0);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','12_so_draft_not_allocated','ok',v_assert_ok,'qty',v_qty_res));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_assert_ok := EXISTS (SELECT 1 FROM public.sale_order_lines WHERE id=v_l AND qty_reserved > 0);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','13_so_confirmed_allocated','ok',v_assert_ok));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  DECLARE v_pkga uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,1,'good','at_dock') RETURNING id INTO v_pkga;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkga);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','14_pkg_at_dock_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgl uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,1,'good','loaded') RETURNING id INTO v_pkgl;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkgl);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','15_pkg_loaded_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgdv uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,1,'good','delivered') RETURNING id INTO v_pkgdv;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkgdv);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','16_pkg_delivered_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgu uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc_veh,1,'good','available') RETURNING id INTO v_pkgu;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkgu);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','17_pkg_unsafe_loc_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgdm uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,1,'damaged','available') RETURNING id INTO v_pkgdm;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkgdm);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','18_pkg_damaged_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgqr uuid;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p2,v_loc,1,'quarantine','available') RETURNING id INTO v_pkgqr;
    v_assert_ok := NOT public._alloc_hook_is_package_eligible(v_pkgqr);
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','19_pkg_quarantine_not_eligible','ok',v_assert_ok));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  DECLARE v_pkgi uuid; v_res2 jsonb; v_count int;
  BEGIN
    INSERT INTO public.stock_packages(product_id,current_location_id,qty,condition,status)
      VALUES (v_p,v_loc,1,'good','available') RETURNING id INTO v_pkgi;
    PERFORM public.allocation_on_return_good(v_pkgi,'release_reserved');
    SELECT public.allocation_on_return_good(v_pkgi,'release_reserved') INTO v_res2;
    SELECT count(*) INTO v_count FROM public.allocation_hook_events
      WHERE event_type='return_good' AND source_event_id='return_good:'||v_pkgi::text;
    v_assert_ok := (v_count = 1) AND ((v_res2->>'skipped')='duplicate');
    v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','20_idempotency','ok',v_assert_ok,'count',v_count));
    IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  SELECT count(*) INTO v_inv FROM public.stock_quants WHERE reserved_quantity > quantity;
  v_assert_ok := (v_inv = 0);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','21_reserved_le_quantity','ok',v_assert_ok,'violations',v_inv));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT count(*) INTO v_neg FROM public.stock_quants WHERE quantity < 0;
  v_assert_ok := (v_neg = 0);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','22_no_negative_stock','ok',v_assert_ok,'violations',v_neg));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_assert_ok := EXISTS (
    SELECT 1 FROM public.stock_reservation_log
    WHERE action='allocate_auto' AND payload ? 'source'
  );
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','23_srlog_source_present','ok',v_assert_ok));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  SELECT count(*) INTO v_moves_after FROM public.stock_moves;
  v_assert_ok := ((v_moves_after - v_moves_before) = 3);
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','24_no_extra_stock_moves','ok',v_assert_ok,'delta', v_moves_after - v_moves_before));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  v_assert_ok := EXISTS (SELECT 1 FROM public.allocation_hook_events WHERE status='ok')
              AND NOT EXISTS (SELECT 1 FROM public.allocation_hook_events WHERE status IN ('error','failed'));
  v_tests := v_tests || jsonb_build_array(jsonb_build_object('test','25_hook_events_no_failures','ok',v_assert_ok));
  IF v_assert_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  RETURN jsonb_build_object(
    'phase','F16-B0.6',
    'passed',v_passed,'failed',v_failed,'total',v_passed+v_failed,
    'tests',v_tests
  );
END;
$$;
