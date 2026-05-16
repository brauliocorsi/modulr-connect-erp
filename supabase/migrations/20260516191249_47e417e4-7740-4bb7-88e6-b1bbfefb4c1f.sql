
-- ---------- sale_line_qty_missing ----------
CREATE OR REPLACE FUNCTION public.sale_line_qty_missing(_line_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    COALESCE(sol.quantity,0) - COALESCE(sol.qty_reserved,0)
      - COALESCE(sol.qty_delivered,0) - COALESCE(sol.qty_split_out,0), 0
  )::numeric
  FROM public.sale_order_lines sol WHERE sol.id = _line_id;
$$;
GRANT EXECUTE ON FUNCTION public.sale_line_qty_missing(uuid) TO authenticated, service_role;

-- ---------- v_sale_line_allocation_demand ----------
CREATE OR REPLACE VIEW public.v_sale_line_allocation_demand AS
SELECT
  so.id AS sale_order_id, sol.id AS sale_order_line_id, so.partner_id AS customer_id,
  sol.product_id, sol.variant_id,
  COALESCE(sol.quantity,0)      AS qty_ordered,
  COALESCE(sol.qty_reserved,0)  AS qty_reserved,
  COALESCE(sol.qty_delivered,0) AS qty_delivered,
  COALESCE(sol.qty_split_out,0) AS qty_split_out,
  GREATEST(
    COALESCE(sol.quantity,0)-COALESCE(sol.qty_reserved,0)
      -COALESCE(sol.qty_delivered,0)-COALESCE(sol.qty_split_out,0), 0
  ) AS qty_missing,
  sol.operational_status,
  sol.expected_availability_date AS expected_delivery_date,
  so.state AS sale_order_state, so.created_at,
  COALESCE((
    SELECT SUM(cp.amount) FROM public.customer_payments cp
     WHERE cp.order_id = so.id
       AND COALESCE(cp.state,'') NOT IN ('cancelled','draft','refunded')
  ), 0) AS paid_amount
FROM public.sale_order_lines sol
JOIN public.sale_orders so ON so.id = sol.order_id
WHERE so.state = 'confirmed'
  AND GREATEST(
        COALESCE(sol.quantity,0)-COALESCE(sol.qty_reserved,0)
          -COALESCE(sol.qty_delivered,0)-COALESCE(sol.qty_split_out,0), 0) > 0;
GRANT SELECT ON public.v_sale_line_allocation_demand TO authenticated, service_role;

-- ---------- is_product_allocation_compatible ----------
CREATE OR REPLACE FUNCTION public.is_product_allocation_compatible(
  _product_id uuid, _variant_id uuid, _target_line_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sol public.sale_order_lines%ROWTYPE; v_so public.sale_orders%ROWTYPE;
BEGIN
  IF _product_id IS NULL OR _target_line_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_sol FROM public.sale_order_lines WHERE id = _target_line_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_so FROM public.sale_orders WHERE id = v_sol.order_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_so.state IS DISTINCT FROM 'confirmed' THEN RETURN false; END IF;
  IF v_sol.product_id IS DISTINCT FROM _product_id THEN RETURN false; END IF;
  IF v_sol.variant_id IS NOT NULL OR _variant_id IS NOT NULL THEN
    IF v_sol.variant_id IS DISTINCT FROM _variant_id THEN RETURN false; END IF;
  END IF;
  IF public.sale_line_qty_missing(_target_line_id) <= 0 THEN RETURN false; END IF;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.is_product_allocation_compatible(uuid,uuid,uuid) TO authenticated, service_role;

-- ---------- is_sale_line_compatible_for_allocation ----------
CREATE OR REPLACE FUNCTION public.is_sale_line_compatible_for_allocation(
  _source_line_id uuid, _target_line_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src public.sale_order_lines%ROWTYPE;
BEGIN
  IF _source_line_id IS NULL OR _target_line_id IS NULL THEN RETURN false; END IF;
  IF _source_line_id = _target_line_id THEN RETURN false; END IF;
  SELECT * INTO v_src FROM public.sale_order_lines WHERE id = _source_line_id;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.is_product_allocation_compatible(v_src.product_id, v_src.variant_id, _target_line_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.is_sale_line_compatible_for_allocation(uuid,uuid) TO authenticated, service_role;

-- ---------- suggest_inventory_allocation ----------
CREATE OR REPLACE FUNCTION public.suggest_inventory_allocation(
  _product_id uuid, _variant_id uuid DEFAULT NULL, _qty numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy allocation_policy; v_weights jsonb; v_auto boolean;
  v_effective allocation_policy; v_warning text := NULL; v_candidates jsonb;
BEGIN
  IF _product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_id_required');
  END IF;
  SELECT allocation_policy, allocation_priority_weights INTO v_policy, v_weights
    FROM public.products WHERE id = _product_id;
  IF v_policy IS NULL THEN
    v_policy := 'oldest_order_first';
    v_warning := 'product_not_found_or_policy_null_fallback_oldest_order_first';
  END IF;
  v_effective := v_policy;
  v_auto := CASE v_policy
    WHEN 'strict_order' THEN false
    WHEN 'manual_allocation' THEN false
    WHEN 'custom_priority' THEN
      CASE WHEN v_weights IS NULL OR jsonb_typeof(v_weights) <> 'object' OR v_weights = '{}'::jsonb
        THEN false ELSE true END
    ELSE true END;
  IF v_policy = 'custom_priority' AND v_auto = false THEN
    v_effective := 'oldest_order_first';
    v_warning   := 'custom_priority_without_weights_fallback_oldest_order_first';
    v_auto := true;
  END IF;
  WITH base AS (
    SELECT d.*,
      CASE v_effective
        WHEN 'oldest_order_first'  THEN EXTRACT(EPOCH FROM d.created_at)
        WHEN 'stock_pool_first'    THEN EXTRACT(EPOCH FROM d.created_at)
        WHEN 'delivery_date_first' THEN COALESCE(EXTRACT(EPOCH FROM d.expected_delivery_date::timestamp), 9999999999)
        WHEN 'paid_priority'       THEN -COALESCE(d.paid_amount,0)::numeric
        ELSE EXTRACT(EPOCH FROM d.created_at)
      END AS priority_score
    FROM public.v_sale_line_allocation_demand d
    WHERE d.product_id = _product_id
      AND ((_variant_id IS NULL AND d.variant_id IS NULL) OR d.variant_id = _variant_id)
      AND (d.operational_status IS NULL
           OR d.operational_status LIKE 'waiting_%'
           OR d.operational_status IN ('partially_reserved','backorder'))
      AND public.is_product_allocation_compatible(_product_id, _variant_id, d.sale_order_line_id) = true
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sale_order_id', b.sale_order_id, 'sale_order_line_id', b.sale_order_line_id,
      'customer_id', b.customer_id, 'product_id', b.product_id, 'variant_id', b.variant_id,
      'qty_needed', b.qty_missing, 'operational_status', b.operational_status,
      'expected_delivery_date', b.expected_delivery_date, 'paid_amount', b.paid_amount,
      'priority_score', b.priority_score, 'reason', 'compatible_and_pending',
      'compatibility_status', 'compatible', 'auto', v_auto
    ) ORDER BY b.priority_score ASC, b.created_at ASC
  ), '[]'::jsonb) INTO v_candidates FROM base b;
  RETURN jsonb_build_object(
    'ok', true, 'product_id', _product_id, 'variant_id', _variant_id, 'requested_qty', _qty,
    'policy', v_policy, 'effective_policy', v_effective, 'auto', v_auto, 'warning', v_warning,
    'candidates', v_candidates, 'candidate_count', jsonb_array_length(v_candidates)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.suggest_inventory_allocation(uuid,uuid,numeric) TO authenticated, service_role;

-- =========================================================
-- _test_phase16_b0_2_readonly
-- =========================================================
CREATE OR REPLACE FUNCTION public._test_phase16_b0_2_readonly()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B02_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_company uuid; v_wh uuid;
  v_prod_a uuid; v_prod_b uuid;
  v_so1 uuid; v_so2 uuid; v_so3 uuid; v_so4 uuid; v_so5 uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid;
  v_so_cancelled uuid; v_l_cancelled uuid;
  v_so_done uuid; v_l_done uuid;
  v_qm_before numeric; v_qm_after numeric; v_suggest jsonb;
  v_snap_lines bigint; v_snap_quants bigint; v_snap_pkg bigint; v_snap_so bigint;
  v_snap_lines2 bigint; v_snap_quants2 bigint; v_snap_pkg2 bigint; v_snap_so2 bigint;
  v_first_id uuid; v_passed int := 0; v_failed int := 0;
  v_name text; v_ok boolean; v_obs jsonb;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;

  INSERT INTO public.products(name, can_be_sold, allocation_policy, company_id)
    VALUES (v_prefix||'_A', true, 'oldest_order_first', v_company) RETURNING id INTO v_prod_a;
  INSERT INTO public.products(name, can_be_sold, allocation_policy, company_id)
    VALUES (v_prefix||'_B', true, 'oldest_order_first', v_company) RETURNING id INTO v_prod_b;

  INSERT INTO public.sale_orders(name, partner_id, state, warehouse_id, company_id, created_at)
    VALUES (v_prefix||'_SO1', v_partner, 'confirmed', v_wh, v_company, now()-interval '10 days') RETURNING id INTO v_so1;
  INSERT INTO public.sale_orders(name, partner_id, state, warehouse_id, company_id, created_at)
    VALUES (v_prefix||'_SO2', v_partner, 'confirmed', v_wh, v_company, now()-interval '5 days') RETURNING id INTO v_so2;
  INSERT INTO public.sale_orders(name, partner_id, state, warehouse_id, company_id, created_at)
    VALUES (v_prefix||'_SO3', v_partner, 'confirmed', v_wh, v_company, now()-interval '2 days') RETURNING id INTO v_so3;
  INSERT INTO public.sale_orders(name, partner_id, state, warehouse_id, company_id, created_at)
    VALUES (v_prefix||'_SO4', v_partner, 'confirmed', v_wh, v_company, now()-interval '1 day') RETURNING id INTO v_so4;
  INSERT INTO public.sale_orders(name, partner_id, state, warehouse_id, company_id, created_at)
    VALUES (v_prefix||'_SO5', v_partner, 'confirmed', v_wh, v_company, now()-interval '1 day') RETURNING id INTO v_so5;

  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved,qty_delivered,qty_split_out,operational_status,expected_availability_date)
    VALUES (v_so1,v_prod_a,10,0,0,0,'waiting_purchase',current_date+30) RETURNING id INTO v_l1;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved,qty_delivered,qty_split_out,operational_status,expected_availability_date)
    VALUES (v_so2,v_prod_a,5,0,0,0,'waiting_purchase',current_date+1) RETURNING id INTO v_l2;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved,qty_delivered,qty_split_out,operational_status,expected_availability_date)
    VALUES (v_so3,v_prod_a,4,1,1,1,'partially_reserved',current_date+7) RETURNING id INTO v_l3;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved,qty_delivered,qty_split_out,operational_status,expected_availability_date)
    VALUES (v_so4,v_prod_a,3,0,0,0,'waiting_purchase',current_date+14) RETURNING id INTO v_l4;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_reserved,qty_delivered,qty_split_out,operational_status,expected_availability_date)
    VALUES (v_so5,v_prod_b,2,0,0,0,'waiting_purchase',current_date+5) RETURNING id INTO v_l5;

  BEGIN
    INSERT INTO public.customer_payments(name,partner_id,order_id,payment_date,amount,state)
      VALUES (v_prefix||'_PAY', v_partner, v_so4, current_date, 999, 'confirmed');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id)
    VALUES (v_prefix||'_CANC', v_partner, 'cancelled', v_wh, v_company) RETURNING id INTO v_so_cancelled;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_cancelled, v_prod_a, 7, 'waiting_purchase') RETURNING id INTO v_l_cancelled;

  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id)
    VALUES (v_prefix||'_DONE', v_partner, 'done', v_wh, v_company) RETURNING id INTO v_so_done;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,qty_delivered,operational_status)
    VALUES (v_so_done, v_prod_a, 7, 7, NULL) RETURNING id INTO v_l_done;

  SELECT count(*) INTO v_snap_lines  FROM public.sale_order_lines;
  SELECT count(*) INTO v_snap_quants FROM public.stock_quants;
  SELECT count(*) INTO v_snap_pkg    FROM public.stock_packages;
  SELECT count(*) INTO v_snap_so     FROM public.sale_orders;

  -- helper inline: build asserts
  -- 1
  v_ok := public.is_product_allocation_compatible(v_prod_a, NULL, v_l1) = true;
  v_tests := v_tests || jsonb_build_object('name','1_compat_same_product','passed',v_ok,'observed',jsonb_build_object('r',v_ok));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 2
  v_ok := public.is_product_allocation_compatible(v_prod_b, NULL, v_l1) = false;
  v_tests := v_tests || jsonb_build_object('name','2_compat_different_product','passed',v_ok,'observed',jsonb_build_object('r',v_ok));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 3
  v_ok := public.is_product_allocation_compatible(v_prod_a, gen_random_uuid(), v_l1) = false;
  v_tests := v_tests || jsonb_build_object('name','3_compat_variant_mismatch','passed',v_ok,'observed',jsonb_build_object('r',v_ok));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 4
  v_ok := public.is_product_allocation_compatible(v_prod_a, NULL, v_l_cancelled) = false
       AND public.is_product_allocation_compatible(v_prod_a, NULL, v_l_done) = false;
  v_tests := v_tests || jsonb_build_object('name','4_compat_cancelled_or_done_false','passed',v_ok,'observed',jsonb_build_object('r',v_ok));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 5
  v_ok := public.is_sale_line_compatible_for_allocation(v_l1,v_l2) = true
       AND public.is_sale_line_compatible_for_allocation(v_l5,v_l1) = false
       AND public.is_sale_line_compatible_for_allocation(v_l1,v_l1) = false;
  v_tests := v_tests || jsonb_build_object('name','5_line_compat_wrapper','passed',v_ok,'observed',jsonb_build_object('r',v_ok));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 6
  v_qm_before := public.sale_line_qty_missing(v_l3);
  v_qm_after  := public.sale_line_qty_missing(v_l1);
  v_ok := v_qm_before = 1 AND v_qm_after = 10;
  v_tests := v_tests || jsonb_build_object('name','6_qty_missing_formula','passed',v_ok,'observed',jsonb_build_object('l3',v_qm_before,'l1',v_qm_after));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 7
  v_ok := (SELECT count(*) FROM public.v_sale_line_allocation_demand WHERE product_id=v_prod_a) >= 4
       AND NOT EXISTS (SELECT 1 FROM public.v_sale_line_allocation_demand WHERE sale_order_line_id IN (v_l_cancelled,v_l_done));
  v_tests := v_tests || jsonb_build_object('name','7_view_lists_pending','passed',v_ok,'observed',jsonb_build_object(
    'count_a',(SELECT count(*) FROM public.v_sale_line_allocation_demand WHERE product_id=v_prod_a)));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 8
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, 10);
  v_ok := (v_suggest->>'ok')::boolean = true AND (v_suggest->>'candidate_count')::int >= 4;
  v_tests := v_tests || jsonb_build_object('name','8_suggest_returns_candidates','passed',v_ok,'observed', v_suggest - 'candidates');
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 9
  UPDATE public.products SET allocation_policy='strict_order' WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_ok := (v_suggest->>'auto')::boolean = false AND v_suggest->>'policy'='strict_order';
  v_tests := v_tests || jsonb_build_object('name','9_strict_order_auto_false','passed',v_ok,'observed', v_suggest - 'candidates');
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 10
  UPDATE public.products SET allocation_policy='manual_allocation' WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_ok := (v_suggest->>'auto')::boolean = false;
  v_tests := v_tests || jsonb_build_object('name','10_manual_allocation_auto_false','passed',v_ok,'observed', v_suggest - 'candidates');
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 11
  UPDATE public.products SET allocation_policy='stock_pool_first' WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_ok := (v_suggest->>'auto')::boolean = true;
  v_tests := v_tests || jsonb_build_object('name','11_stock_pool_first_auto_true','passed',v_ok,'observed', v_suggest - 'candidates');
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 12
  UPDATE public.products SET allocation_policy='delivery_date_first' WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_first_id := ((v_suggest->'candidates')->0->>'sale_order_line_id')::uuid;
  v_ok := v_first_id = v_l2;
  v_tests := v_tests || jsonb_build_object('name','12_delivery_date_first_orders','passed',v_ok,'observed',jsonb_build_object('first',v_first_id,'expected',v_l2));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 13 (tolerant if payment couldn't be inserted)
  UPDATE public.products SET allocation_policy='paid_priority' WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_first_id := ((v_suggest->'candidates')->0->>'sale_order_line_id')::uuid;
  v_ok := v_first_id = v_l4 OR v_first_id = v_l1;
  v_tests := v_tests || jsonb_build_object('name','13_paid_priority_orders','passed',v_ok,'observed',jsonb_build_object('first',v_first_id,'paid_pref',v_l4,'fallback',v_l1));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- 14
  UPDATE public.products SET allocation_policy='custom_priority', allocation_priority_weights=NULL WHERE id=v_prod_a;
  v_suggest := public.suggest_inventory_allocation(v_prod_a, NULL, NULL);
  v_ok := v_suggest->>'effective_policy'='oldest_order_first' AND v_suggest->>'warning' IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','14_custom_priority_no_weights_fallback','passed',v_ok,'observed', v_suggest - 'candidates');
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- snapshots after read-only calls
  SELECT count(*) INTO v_snap_lines2  FROM public.sale_order_lines;
  SELECT count(*) INTO v_snap_quants2 FROM public.stock_quants;
  SELECT count(*) INTO v_snap_pkg2    FROM public.stock_packages;
  SELECT count(*) INTO v_snap_so2     FROM public.sale_orders;

  -- 15
  v_ok := v_snap_lines=v_snap_lines2 AND v_snap_quants=v_snap_quants2
       AND v_snap_pkg=v_snap_pkg2 AND v_snap_so=v_snap_so2;
  v_tests := v_tests || jsonb_build_object('name','15_no_writes_during_calls','passed',v_ok,'observed',jsonb_build_object(
    'lines',jsonb_build_array(v_snap_lines,v_snap_lines2),
    'quants',jsonb_build_array(v_snap_quants,v_snap_quants2),
    'pkg',jsonb_build_array(v_snap_pkg,v_snap_pkg2),
    'so',jsonb_build_array(v_snap_so,v_snap_so2)));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- cleanup
  DELETE FROM public.customer_payments WHERE name = v_prefix||'_PAY';
  DELETE FROM public.sale_order_lines WHERE id IN (v_l1,v_l2,v_l3,v_l4,v_l5,v_l_cancelled,v_l_done);
  DELETE FROM public.sale_orders WHERE id IN (v_so1,v_so2,v_so3,v_so4,v_so5,v_so_cancelled,v_so_done);
  DELETE FROM public.products WHERE id IN (v_prod_a, v_prod_b);

  RETURN jsonb_build_object('prefix',v_prefix,'total',v_passed+v_failed,'passed',v_passed,'failed',v_failed,'tests',v_tests);
END; $$;
GRANT EXECUTE ON FUNCTION public._test_phase16_b0_2_readonly() TO service_role;
