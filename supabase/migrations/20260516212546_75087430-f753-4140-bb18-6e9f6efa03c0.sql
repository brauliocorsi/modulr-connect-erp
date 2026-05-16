
-- F16-B0.6.1: fix test typo + remove silent EXCEPTION + log failures explicitly + retry-on-failure idempotency
-- 1) Extend allocation_hook_events with structured error fields
ALTER TABLE public.allocation_hook_events
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS error_detail jsonb;

-- 2) Register-event helper: allow retry when prior attempt failed
CREATE OR REPLACE FUNCTION public._alloc_hook_register_event(
  _event_type text, _source_id uuid, _source_event_id text,
  _product_id uuid, _variant_id uuid, _location_id uuid, _qty numeric
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_existing record;
BEGIN
  SELECT id, status INTO v_existing
    FROM public.allocation_hook_events
   WHERE event_type = _event_type AND source_event_id = _source_event_id
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.status = 'failed' THEN
      -- retry: reset to 'ok' (will be re-marked failed if it fails again)
      UPDATE public.allocation_hook_events
         SET status='ok', error=NULL, error_message=NULL, error_detail=NULL,
             qty=_qty, product_id=_product_id, variant_id=_variant_id,
             location_id=_location_id, source_id=_source_id
       WHERE id = v_existing.id;
      RETURN TRUE;
    END IF;
    -- already ok or in any non-failed state -> idempotent skip
    RETURN FALSE;
  END IF;

  INSERT INTO public.allocation_hook_events(
    event_type, source_id, source_event_id, product_id, variant_id, location_id, qty, status
  ) VALUES (
    _event_type, _source_id, _source_event_id, _product_id, _variant_id, _location_id, _qty, 'ok'
  );
  RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
  -- concurrent insert: treat as already-registered
  RETURN FALSE;
END;
$$;

-- 3) Helper to mark an event as failed with structured detail
CREATE OR REPLACE FUNCTION public._alloc_hook_mark_failed(
  _event_type text, _source_event_id text, _sqlerrm text, _sqlstate text, _context text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.allocation_hook_events
     SET status        = 'failed',
         error         = _sqlerrm,
         error_message = _sqlerrm,
         error_detail  = jsonb_build_object(
           'sqlstate', _sqlstate,
           'context',  _context,
           'logged_at', now()
         )
   WHERE event_type = _event_type AND source_event_id = _source_event_id;
END;
$$;

-- 4) Rewrite each hook to use explicit failure logging (no silent EXCEPTION)
CREATE OR REPLACE FUNCTION public.allocation_on_po_receipt(_picking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pick record; v_move record; v_pn record;
  v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_evt_key text; v_is_new boolean;
  v_state text; v_ctx text;
BEGIN
  SELECT * INTO v_pick FROM public.stock_pickings WHERE id = _picking_id;
  IF NOT FOUND OR v_pick.kind <> 'incoming' OR v_pick.state <> 'done' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_incoming_done');
  END IF;

  FOR v_move IN
    SELECT m.* FROM public.stock_moves m
     WHERE m.picking_id = _picking_id AND COALESCE(m.quantity_done, m.quantity, 0) > 0
  LOOP
    IF NOT public._alloc_hook_is_safe_location(v_move.destination_location_id) THEN CONTINUE; END IF;

    SELECT pn.* INTO v_pn
      FROM public.purchase_needs pn
      JOIN public.purchase_order_lines pol ON pol.id IS NOT NULL
      JOIN public.purchase_orders po ON po.id = pol.order_id
     WHERE pn.purchase_order_id = po.id
       AND pn.product_id = v_move.product_id
       AND pn.manufacturing_order_id IS NOT NULL
       AND pn.sale_order_id IS NULL
       AND po.name = v_pick.origin
     LIMIT 1;
    IF FOUND THEN CONTINUE; END IF;

    v_evt_key := 'po_receipt:'||_picking_id::text||':move:'||v_move.id::text;
    v_is_new := public._alloc_hook_register_event(
      'po_receipt', _picking_id, v_evt_key,
      v_move.product_id, v_move.variant_id, v_move.destination_location_id,
      COALESCE(v_move.quantity_done, v_move.quantity)
    );
    IF NOT v_is_new THEN CONTINUE; END IF;

    BEGIN
      v_res := public.run_inventory_allocation(
        v_move.product_id, v_move.variant_id, v_move.destination_location_id,
        COALESCE(v_move.quantity_done, v_move.quantity), 'po_receipt'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'move_id', v_move.id, 'product_id', v_move.product_id, 'result', v_res
      ));
      UPDATE public.allocation_hook_events SET result = v_res
       WHERE event_type='po_receipt' AND source_event_id = v_evt_key;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_ctx = PG_EXCEPTION_CONTEXT;
      PERFORM public._alloc_hook_mark_failed('po_receipt', v_evt_key, SQLERRM, v_state, v_ctx);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'picking_id', _picking_id, 'results', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocation_on_return_good(_package_id uuid, _mode text DEFAULT 'release_reserved')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pkg record; v_res jsonb; v_key text;
  v_state text; v_ctx text;
BEGIN
  IF _mode <> 'release_reserved' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'mode_not_release');
  END IF;
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id = _package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','package_not_found'); END IF;
  IF NOT public._alloc_hook_is_package_eligible(_package_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','package_not_eligible');
  END IF;
  v_key := 'return_good:'||_package_id::text;
  IF NOT public._alloc_hook_register_event(
    'return_good', _package_id, v_key, v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','duplicate');
  END IF;

  BEGIN
    v_res := public.run_inventory_allocation(
      v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty, 'return_good_release_reserved'
    );
    UPDATE public.allocation_hook_events SET result=v_res
     WHERE event_type='return_good' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_ctx = PG_EXCEPTION_CONTEXT;
    PERFORM public._alloc_hook_mark_failed('return_good', v_key, SQLERRM, v_state, v_ctx);
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'sqlstate', v_state);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocation_on_inventory_adjustment_positive(_adj_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_line record; v_results jsonb := '[]'::jsonb; v_res jsonb;
  v_key text; v_diff numeric; v_state text; v_ctx text;
BEGIN
  FOR v_line IN
    SELECT * FROM public.inventory_adjustment_lines WHERE adjustment_id = _adj_id
  LOOP
    v_diff := COALESCE(v_line.counted_qty,0) - COALESCE(v_line.theoretical_qty,0);
    IF v_diff <= 0 THEN CONTINUE; END IF;
    IF NOT public._alloc_hook_is_safe_location(v_line.location_id) THEN CONTINUE; END IF;

    v_key := 'inv_adj_pos:'||_adj_id::text||':line:'||v_line.id::text;
    IF NOT public._alloc_hook_register_event(
      'inv_adj_positive', _adj_id, v_key,
      v_line.product_id, v_line.variant_id, v_line.location_id, v_diff
    ) THEN CONTINUE; END IF;

    BEGIN
      v_res := public.run_inventory_allocation(
        v_line.product_id, v_line.variant_id, v_line.location_id, v_diff,
        'inventory_adjustment_positive'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id, 'product_id', v_line.product_id, 'result', v_res
      ));
      UPDATE public.allocation_hook_events SET result=v_res
       WHERE event_type='inv_adj_positive' AND source_event_id=v_key;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_ctx = PG_EXCEPTION_CONTEXT;
      PERFORM public._alloc_hook_mark_failed('inv_adj_positive', v_key, SQLERRM, v_state, v_ctx);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'adjustment_id', _adj_id, 'results', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocation_on_manual_release(
  _product_id uuid, _variant_id uuid, _location_id uuid, _qty numeric, _source_event_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_res jsonb; v_key text; v_state text; v_ctx text;
BEGIN
  IF _product_id IS NULL OR _location_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','missing_params');
  END IF;
  IF NOT public._alloc_hook_is_safe_location(_location_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','unsafe_location');
  END IF;

  v_key := COALESCE(_source_event_id, 'manual_release:'||_product_id::text||':'||_location_id::text||':'||extract(epoch from clock_timestamp())::text);
  IF NOT public._alloc_hook_register_event(
    'manual_release', _product_id, v_key, _product_id, _variant_id, _location_id, _qty
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','duplicate');
  END IF;

  BEGIN
    v_res := public.run_inventory_allocation(_product_id, _variant_id, _location_id, _qty, 'manual_release_reservation');
    UPDATE public.allocation_hook_events SET result=v_res
     WHERE event_type='manual_release' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_ctx = PG_EXCEPTION_CONTEXT;
    PERFORM public._alloc_hook_mark_failed('manual_release', v_key, SQLERRM, v_state, v_ctx);
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'sqlstate', v_state);
  END;
END;
$$;

-- 5) Fix test fixture: manufacturing_orders.quantity -> qty; broaden test 25 to also check 'failed'
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
    INSERT INTO public.manufacturing_orders(product_id,qty,state,warehouse_id,company_id)
      VALUES (v_p3,1,'draft',v_wh,v_company) RETURNING id INTO v_mo;
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
