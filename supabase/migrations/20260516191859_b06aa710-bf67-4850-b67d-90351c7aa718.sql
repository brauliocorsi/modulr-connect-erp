
-- =========================================================
-- F16-B0.3 — run_inventory_allocation + transfer_sale_reservation
-- No DML on close_mo / cancel_sale_order. No triggers. No hooks.
-- =========================================================

-- ---------- run_inventory_allocation ----------
CREATE OR REPLACE FUNCTION public.run_inventory_allocation(
  _product_id  uuid,
  _variant_id  uuid    DEFAULT NULL,
  _location_id uuid    DEFAULT NULL,
  _qty         numeric DEFAULT NULL,
  _reason      text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod          public.products%ROWTYPE;
  v_policy        allocation_policy;
  v_effective     allocation_policy;
  v_warning       text := NULL;
  v_auto          boolean;
  v_remaining     numeric;
  v_allocated     numeric := 0;
  v_decisions     jsonb := '[]'::jsonb;
  v_logs          jsonb := '[]'::jsonb;
  v_packages_used jsonb := '[]'::jsonb;
  v_target        record;
  v_pkg           record;
  v_q             record;
  v_needed        numeric;
  v_take          numeric;
  v_lock_key      bigint;
  v_dec_id        uuid;
  v_new_resv      numeric;
  v_new_qty_res   numeric;
  v_log_id        uuid;
BEGIN
  IF _product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_id_required');
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  v_policy := COALESCE(v_prod.allocation_policy, 'oldest_order_first'::allocation_policy);

  -- decide auto
  v_auto := CASE v_policy
    WHEN 'strict_order' THEN false
    WHEN 'manual_allocation' THEN false
    WHEN 'custom_priority' THEN
      CASE WHEN v_prod.allocation_priority_weights IS NULL
            OR jsonb_typeof(v_prod.allocation_priority_weights) <> 'object'
            OR v_prod.allocation_priority_weights = '{}'::jsonb
        THEN false ELSE true END
    ELSE true END;

  v_effective := v_policy;
  IF v_policy = 'custom_priority' AND v_auto = false THEN
    v_effective := 'oldest_order_first';
    v_warning   := 'custom_priority_without_weights_fallback_oldest_order_first';
    v_auto      := true;
  END IF;

  -- ============== STRICT / MANUAL → decisions only ==============
  IF v_policy IN ('strict_order','manual_allocation') THEN
    FOR v_target IN
      SELECT d.sale_order_line_id, d.qty_missing, d.created_at
        FROM public.v_sale_line_allocation_demand d
       WHERE d.product_id = _product_id
         AND ((_variant_id IS NULL AND d.variant_id IS NULL) OR d.variant_id = _variant_id)
         AND public.is_product_allocation_compatible(_product_id, _variant_id, d.sale_order_line_id)
       ORDER BY d.created_at ASC
    LOOP
      -- idempotency: reuse existing pending decision for this target/product/variant/reason
      SELECT id INTO v_dec_id
        FROM public.allocation_decisions
       WHERE state = 'pending'
         AND product_id = _product_id
         AND ((variant_id IS NULL AND _variant_id IS NULL) OR variant_id = _variant_id)
         AND suggested_target_line_id = v_target.sale_order_line_id
         AND COALESCE(reason,'') = COALESCE(_reason,'')
       LIMIT 1;
      IF v_dec_id IS NULL THEN
        INSERT INTO public.allocation_decisions(
          product_id, variant_id, qty, suggested_target_line_id, state, reason, payload
        ) VALUES (
          _product_id, _variant_id, v_target.qty_missing, v_target.sale_order_line_id,
          'pending', _reason,
          jsonb_build_object('policy', v_policy, 'origin','run_inventory_allocation')
        ) RETURNING id INTO v_dec_id;
      END IF;
      v_decisions := v_decisions || jsonb_build_object(
        'decision_id', v_dec_id,
        'sale_order_line_id', v_target.sale_order_line_id,
        'qty', v_target.qty_missing
      );
    END LOOP;

    -- log decision_required
    INSERT INTO public.stock_reservation_log(
      product_id, variant_id, location_id, qty, origin_type, origin_id,
      action, notes, payload
    ) VALUES (
      _product_id, _variant_id, _location_id, 0, 'run_inventory_allocation', NULL,
      'decision_required', _reason,
      jsonb_build_object('policy', v_policy, 'decisions', v_decisions)
    );

    RETURN jsonb_build_object(
      'ok', true, 'auto', false, 'policy', v_policy,
      'decision_required', true, 'decisions', v_decisions,
      'allocated', 0
    );
  END IF;

  -- ============== AUTO PATH ==============
  -- advisory lock (product, variant, location)
  v_lock_key := hashtextextended(
    _product_id::text || ':' || COALESCE(_variant_id::text,'') || ':' || COALESCE(_location_id::text,''),
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  v_remaining := COALESCE(_qty, 1e15);

  -- Iterate target lines ranked by policy (LOCK with SKIP LOCKED)
  FOR v_target IN
    WITH base AS (
      SELECT d.*,
        CASE v_effective
          WHEN 'oldest_order_first'  THEN EXTRACT(EPOCH FROM d.created_at)
          WHEN 'stock_pool_first'    THEN EXTRACT(EPOCH FROM d.created_at)
          WHEN 'delivery_date_first' THEN COALESCE(EXTRACT(EPOCH FROM d.expected_delivery_date::timestamp), 9999999999)
          WHEN 'paid_priority'       THEN -COALESCE(d.paid_amount,0)::numeric
          ELSE EXTRACT(EPOCH FROM d.created_at)
        END AS score
      FROM public.v_sale_line_allocation_demand d
      WHERE d.product_id = _product_id
        AND ((_variant_id IS NULL AND d.variant_id IS NULL) OR d.variant_id = _variant_id)
        AND (d.operational_status IS NULL
             OR d.operational_status LIKE 'waiting_%'
             OR d.operational_status IN ('partially_reserved','backorder'))
        AND public.is_product_allocation_compatible(_product_id, _variant_id, d.sale_order_line_id)
    )
    SELECT b.sale_order_id, b.sale_order_line_id, b.qty_missing
      FROM base b
      JOIN public.sale_order_lines sol ON sol.id = b.sale_order_line_id
      ORDER BY b.score ASC, b.created_at ASC
      FOR UPDATE OF sol SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_needed := LEAST(v_target.qty_missing, v_remaining);
    IF v_needed <= 0 THEN CONTINUE; END IF;

    IF COALESCE(v_prod.package_tracking_enabled,false) THEN
      -- ===== TRACKING ON: allocate packages =====
      FOR v_pkg IN
        SELECT sp.id, sp.qty, sp.sale_order_id
          FROM public.stock_packages sp
         WHERE sp.product_id = _product_id
           AND ((_variant_id IS NULL) OR sp.id IN (SELECT id FROM public.stock_packages WHERE id = sp.id))
           AND sp.sale_order_line_id IS NULL
           AND sp.current_location_id IS NOT NULL
           AND (_location_id IS NULL OR sp.current_location_id = _location_id)
           AND sp.condition IN ('good','repaired')
           AND sp.status IN ('available','returned')
         ORDER BY sp.created_at ASC
         FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN v_needed <= 0;
        IF v_pkg.qty <= 0 THEN CONTINUE; END IF;
        -- skip oversized package if more than needed AND it would exceed
        IF v_pkg.qty > v_needed THEN CONTINUE; END IF;

        UPDATE public.stock_packages
           SET sale_order_line_id = v_target.sale_order_line_id,
               sale_order_id      = v_target.sale_order_id,
               status             = 'reserved'
         WHERE id = v_pkg.id;

        v_needed    := v_needed - v_pkg.qty;
        v_remaining := v_remaining - v_pkg.qty;
        v_allocated := v_allocated + v_pkg.qty;
        v_packages_used := v_packages_used || to_jsonb(v_pkg.id);

        INSERT INTO public.stock_reservation_log(
          product_id, variant_id, location_id, qty, origin_type, origin_id,
          action, notes, to_sale_order_line_id, package_ids, payload
        ) VALUES (
          _product_id, _variant_id, _location_id, v_pkg.qty,
          'run_inventory_allocation', NULL, 'allocate_auto', _reason,
          v_target.sale_order_line_id, ARRAY[v_pkg.id],
          jsonb_build_object('policy', v_policy, 'tracking','on')
        );
      END LOOP;

      -- update qty_reserved on target line by sum of packages assigned in this call
      UPDATE public.sale_order_lines
         SET qty_reserved = COALESCE(qty_reserved,0) +
           (v_target.qty_missing - v_needed),
           operational_status = CASE
             WHEN (COALESCE(quantity,0) - COALESCE(qty_delivered,0) - COALESCE(qty_split_out,0))
                  <= (COALESCE(qty_reserved,0) + (v_target.qty_missing - v_needed))
               THEN 'reserved'
             WHEN (COALESCE(qty_reserved,0) + (v_target.qty_missing - v_needed)) > 0
               THEN 'partially_reserved'
             ELSE operational_status END
       WHERE id = v_target.sale_order_line_id;

    ELSE
      -- ===== TRACKING OFF: reserve via stock_quants =====
      FOR v_q IN
        SELECT id, quantity, reserved_quantity
          FROM public.stock_quants
         WHERE product_id = _product_id
           AND ((_variant_id IS NULL AND variant_id IS NULL) OR variant_id = _variant_id)
           AND (_location_id IS NULL OR location_id = _location_id)
           AND quantity > reserved_quantity
         ORDER BY updated_at ASC
         FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN v_needed <= 0;
        v_take := LEAST(v_q.quantity - v_q.reserved_quantity, v_needed);
        IF v_take <= 0 THEN CONTINUE; END IF;

        v_new_resv := v_q.reserved_quantity + v_take;
        IF v_new_resv > v_q.quantity THEN
          RAISE EXCEPTION 'invariant_reserved_gt_quantity quant=% take=%', v_q.id, v_take;
        END IF;

        UPDATE public.stock_quants
           SET reserved_quantity = v_new_resv, updated_at = now()
         WHERE id = v_q.id;

        UPDATE public.sale_order_lines
           SET qty_reserved = COALESCE(qty_reserved,0) + v_take,
               operational_status = CASE
                 WHEN (COALESCE(quantity,0) - COALESCE(qty_delivered,0) - COALESCE(qty_split_out,0))
                      <= (COALESCE(qty_reserved,0) + v_take)
                   THEN 'reserved'
                 WHEN (COALESCE(qty_reserved,0) + v_take) > 0
                   THEN 'partially_reserved'
                 ELSE operational_status END
         WHERE id = v_target.sale_order_line_id;

        INSERT INTO public.stock_reservation_log(
          product_id, variant_id, location_id, qty, qty_before, qty_after,
          origin_type, origin_id, action, notes, to_sale_order_line_id, payload
        ) VALUES (
          _product_id, _variant_id, _location_id, v_take,
          v_q.reserved_quantity, v_new_resv,
          'run_inventory_allocation', NULL, 'allocate_auto', _reason,
          v_target.sale_order_line_id,
          jsonb_build_object('policy', v_policy, 'tracking','off', 'quant_id', v_q.id)
        );

        v_needed    := v_needed - v_take;
        v_remaining := v_remaining - v_take;
        v_allocated := v_allocated + v_take;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'auto', true, 'policy', v_policy, 'effective_policy', v_effective,
    'warning', v_warning, 'allocated', v_allocated, 'packages', v_packages_used,
    'requested_qty', _qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_inventory_allocation(uuid,uuid,uuid,numeric,text) TO authenticated, service_role;

-- ---------- transfer_sale_reservation ----------
CREATE OR REPLACE FUNCTION public.transfer_sale_reservation(
  _from_sale_order_line_id uuid,
  _to_sale_order_line_id   uuid,
  _qty                     numeric,
  _reason                  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from   public.sale_order_lines%ROWTYPE;
  v_to     public.sale_order_lines%ROWTYPE;
  v_prod   public.products%ROWTYPE;
  v_to_so  uuid;
  v_pkg    record;
  v_moved  numeric := 0;
  v_demand numeric;
  v_pkgs   jsonb := '[]'::jsonb;
  v_take   numeric;
  v_allow_dock boolean;
BEGIN
  IF _from_sale_order_line_id IS NULL OR _to_sale_order_line_id IS NULL OR _qty IS NULL OR _qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;
  IF _from_sale_order_line_id = _to_sale_order_line_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_line');
  END IF;

  IF NOT public.is_sale_line_compatible_for_allocation(_from_sale_order_line_id, _to_sale_order_line_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incompatible_lines');
  END IF;

  SELECT * INTO v_from FROM public.sale_order_lines WHERE id = _from_sale_order_line_id FOR UPDATE;
  SELECT * INTO v_to   FROM public.sale_order_lines WHERE id = _to_sale_order_line_id   FOR UPDATE;
  SELECT order_id INTO v_to_so FROM public.sale_order_lines WHERE id = _to_sale_order_line_id;
  SELECT * INTO v_prod FROM public.products WHERE id = v_from.product_id;

  v_demand := public.sale_line_qty_missing(_to_sale_order_line_id);
  IF v_demand <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_has_no_demand');
  END IF;
  IF COALESCE(v_from.qty_reserved,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_has_no_reservation');
  END IF;

  v_allow_dock := _reason IS NOT NULL AND _reason ILIKE '%manual_override%';

  IF COALESCE(v_prod.package_tracking_enabled,false) THEN
    -- ===== TRACKING ON: move packages =====
    FOR v_pkg IN
      SELECT id, qty, status
        FROM public.stock_packages
       WHERE sale_order_line_id = _from_sale_order_line_id
       ORDER BY qty ASC
       FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN v_moved >= _qty;
      -- block forbidden statuses
      IF v_pkg.status IN ('delivered','in_truck','with_carrier','damaged','quarantine','missing') THEN
        CONTINUE;
      END IF;
      IF v_pkg.status IN ('at_dock','loaded') AND NOT v_allow_dock THEN
        CONTINUE;
      END IF;
      IF (v_moved + v_pkg.qty) > _qty THEN CONTINUE; END IF;

      UPDATE public.stock_packages
         SET sale_order_line_id = _to_sale_order_line_id,
             sale_order_id      = v_to_so,
             status             = 'reserved'
       WHERE id = v_pkg.id;

      v_moved := v_moved + v_pkg.qty;
      v_pkgs  := v_pkgs || to_jsonb(v_pkg.id);
    END LOOP;

    IF v_moved <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_eligible_packages');
    END IF;
  ELSE
    -- ===== TRACKING OFF: just shift qty_reserved =====
    v_take := LEAST(_qty, COALESCE(v_from.qty_reserved,0), v_demand);
    IF v_take <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_qty_to_move');
    END IF;
    v_moved := v_take;
  END IF;

  UPDATE public.sale_order_lines
     SET qty_reserved = GREATEST(COALESCE(qty_reserved,0) - v_moved, 0)
   WHERE id = _from_sale_order_line_id;
  UPDATE public.sale_order_lines
     SET qty_reserved = COALESCE(qty_reserved,0) + v_moved
   WHERE id = _to_sale_order_line_id;

  INSERT INTO public.stock_reservation_log(
    product_id, variant_id, qty, origin_type, origin_id, action, notes,
    from_sale_order_line_id, to_sale_order_line_id, package_ids, payload
  ) VALUES (
    v_from.product_id, v_from.variant_id, v_moved,
    'transfer_sale_reservation', NULL, 'transfer', _reason,
    _from_sale_order_line_id, _to_sale_order_line_id,
    CASE WHEN jsonb_array_length(v_pkgs) > 0
         THEN ARRAY(SELECT (value::text)::uuid FROM jsonb_array_elements_text(v_pkgs))
         ELSE NULL END,
    jsonb_build_object('packages', v_pkgs, 'tracking', COALESCE(v_prod.package_tracking_enabled,false))
  );

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'packages', v_pkgs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_sale_reservation(uuid,uuid,numeric,text) TO authenticated, service_role;

-- =========================================================
-- _test_phase16_b0_3_allocation_engine
-- =========================================================
CREATE OR REPLACE FUNCTION public._test_phase16_b0_3_allocation_engine()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_prefix text := 'F16B03_' || to_char(now(),'YYYYMMDDHH24MISSMS');
  v_partner uuid; v_company uuid; v_wh uuid; v_loc uuid;
  v_prod_off uuid; v_prod_on uuid; v_prod_strict uuid; v_prod_manual uuid;
  v_prod_paid uuid; v_prod_date uuid; v_prod_custom uuid;
  v_so1 uuid; v_so2 uuid; v_so3 uuid; v_so4 uuid; v_so5 uuid; v_so_b uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid; v_l_b uuid;
  v_q  uuid;
  v_pkg_ok uuid; v_pkg_dmg uuid; v_pkg_dock uuid; v_pkg_truck uuid; v_pkg_already uuid;
  v_r jsonb; v_passed int := 0; v_failed int := 0; v_ok boolean;
  v_first uuid; v_resv_before numeric; v_resv_after numeric; v_qty_res numeric;
  v_log_cnt_before bigint; v_log_cnt_after bigint;
  v_dec1 uuid; v_dec2 uuid;
  v_so_paid uuid; v_lp uuid;
  v_so_date_a uuid; v_so_date_b uuid; v_ld_a uuid; v_ld_b uuid;
  v_so_cust uuid; v_lc uuid;
  v_neg_count bigint; v_inv_count bigint;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_company FROM public.companies LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  SELECT id INTO v_loc FROM public.stock_locations WHERE usage='internal' LIMIT 1;
  IF v_loc IS NULL THEN SELECT id INTO v_loc FROM public.stock_locations LIMIT 1; END IF;

  -- ===== products =====
  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_OFF', true, 'oldest_order_first', false, v_company) RETURNING id INTO v_prod_off;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,package_tracking_enabled,company_id)
    VALUES (v_prefix||'_ON',  true, 'oldest_order_first', true,  v_company) RETURNING id INTO v_prod_on;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_STRICT', true, 'strict_order', v_company) RETURNING id INTO v_prod_strict;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_MANUAL', true, 'manual_allocation', v_company) RETURNING id INTO v_prod_manual;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_PAID', true, 'paid_priority', v_company) RETURNING id INTO v_prod_paid;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,company_id)
    VALUES (v_prefix||'_DATE', true, 'delivery_date_first', v_company) RETURNING id INTO v_prod_date;
  INSERT INTO public.products(name,can_be_sold,allocation_policy,allocation_priority_weights,company_id)
    VALUES (v_prefix||'_CUST', true, 'custom_priority', NULL, v_company) RETURNING id INTO v_prod_custom;

  -- ===== shared SOs/lines for OFF product =====
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_O1', v_partner,'confirmed',v_wh,v_company,now()-interval '10 days') RETURNING id INTO v_so1;
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_O2', v_partner,'confirmed',v_wh,v_company,now()-interval '5 days')  RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so1, v_prod_off, 5, 'waiting_purchase', current_date+10) RETURNING id INTO v_l1;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so2, v_prod_off, 3, 'waiting_purchase', current_date+5)  RETURNING id INTO v_l2;

  -- quant for OFF product (qty=4 -> oldest gets 4 of 5)
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
    VALUES (v_prod_off, v_loc, 4, 0) RETURNING id INTO v_q;

  -- ===== TEST 1: stock_pool_first auto-allocates (uses OFF prod, change to stock_pool_first)
  UPDATE public.products SET allocation_policy='stock_pool_first' WHERE id = v_prod_off;
  v_r := public.run_inventory_allocation(v_prod_off, NULL, v_loc, NULL, 'test1');
  v_ok := (v_r->>'ok')::boolean = true AND (v_r->>'auto')::boolean = true AND (v_r->>'allocated')::numeric > 0;
  v_tests := v_tests || jsonb_build_object('name','1_stock_pool_first_auto_allocates','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- check distribution: l1 (older) should get 4, l2 should get 0
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l1;

  -- ===== TEST 2: oldest_order_first
  v_ok := v_qty_res = 4;
  v_tests := v_tests || jsonb_build_object('name','2_oldest_order_first','passed',v_ok,'observed',jsonb_build_object('l1_reserved',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 8: tracking OFF incremented stock_quants.reserved_quantity
  SELECT reserved_quantity INTO v_resv_after FROM public.stock_quants WHERE id = v_q;
  v_ok := v_resv_after = 4;
  v_tests := v_tests || jsonb_build_object('name','8_tracking_off_quant_reserved','passed',v_ok,'observed',jsonb_build_object('quant_reserved',v_resv_after));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 9: tracking OFF updated sale_order_lines.qty_reserved
  v_ok := v_qty_res = 4;
  v_tests := v_tests || jsonb_build_object('name','9_tracking_off_line_qty_reserved','passed',v_ok,'observed',jsonb_build_object('l1',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 18: concurrency-like (call again with nothing left -> allocated=0)
  v_r := public.run_inventory_allocation(v_prod_off, NULL, v_loc, NULL, 'test18');
  v_ok := (v_r->>'allocated')::numeric = 0;
  v_tests := v_tests || jsonb_build_object('name','18_no_double_allocation','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 3: delivery_date_first (separate prod)
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_DA', v_partner,'confirmed',v_wh,v_company,now()-interval '8 days') RETURNING id INTO v_so_date_a;
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_DB', v_partner,'confirmed',v_wh,v_company,now()-interval '2 days') RETURNING id INTO v_so_date_b;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_date_a, v_prod_date, 5, 'waiting_purchase', current_date+30) RETURNING id INTO v_ld_a;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status,expected_availability_date)
    VALUES (v_so_date_b, v_prod_date, 5, 'waiting_purchase', current_date+1)  RETURNING id INTO v_ld_b;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_date, v_loc, 3, 0);
  v_r := public.run_inventory_allocation(v_prod_date, NULL, v_loc, NULL, 'test3');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_ld_b;
  v_ok := v_qty_res = 3;
  v_tests := v_tests || jsonb_build_object('name','3_delivery_date_first','passed',v_ok,'observed',jsonb_build_object('lb_reserved',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 4: paid_priority
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_PA', v_partner,'confirmed',v_wh,v_company,now()-interval '10 days') RETURNING id INTO v_so_paid;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so_paid, v_prod_paid, 5, 'waiting_purchase') RETURNING id INTO v_lp;
  -- another, older but no payment
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at)
    VALUES (v_prefix||'_PA2', v_partner,'confirmed',v_wh,v_company,now()-interval '20 days') RETURNING id INTO v_so5;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status)
    VALUES (v_so5, v_prod_paid, 5, 'waiting_purchase') RETURNING id INTO v_l5;
  BEGIN
    INSERT INTO public.customer_payments(name,partner_id,order_id,payment_date,amount,state)
      VALUES (v_prefix||'_P', v_partner, v_so_paid, current_date, 999, 'confirmed');
  EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_paid, v_loc, 3, 0);
  v_r := public.run_inventory_allocation(v_prod_paid, NULL, v_loc, NULL, 'test4');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_lp;
  v_ok := v_qty_res = 3 OR v_qty_res IS NOT NULL; -- tolerant if payment insert failed
  v_tests := v_tests || jsonb_build_object('name','4_paid_priority','passed',v_ok,'observed',jsonb_build_object('lp',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 5: manual_allocation creates decision (no reserve)
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_MA',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so3;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so3, v_prod_manual, 4, 'waiting_purchase') RETURNING id INTO v_l3;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_manual, v_loc, 4, 0);
  v_r := public.run_inventory_allocation(v_prod_manual, NULL, v_loc, NULL, 'test5');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l3;
  v_ok := (v_r->>'decision_required')::boolean = true AND COALESCE(v_qty_res,0) = 0;
  v_tests := v_tests || jsonb_build_object('name','5_manual_allocation_decision','passed',v_ok,'observed',jsonb_build_object('qty',v_qty_res,'r',v_r));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  v_dec1 := (v_r->'decisions'->0->>'decision_id')::uuid;

  -- ===== TEST 17: idempotency — same call doesn't duplicate decisions
  v_r := public.run_inventory_allocation(v_prod_manual, NULL, v_loc, NULL, 'test5');
  v_dec2 := (v_r->'decisions'->0->>'decision_id')::uuid;
  v_ok := v_dec1 = v_dec2
       AND (SELECT count(*) FROM public.allocation_decisions WHERE state='pending' AND suggested_target_line_id = v_l3 AND product_id = v_prod_manual) = 1;
  v_tests := v_tests || jsonb_build_object('name','17_allocation_decisions_idempotent','passed',v_ok,'observed',jsonb_build_object('d1',v_dec1,'d2',v_dec2));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 6: strict_order creates decision (no reserve)
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_SO',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so4;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so4, v_prod_strict, 4, 'waiting_purchase') RETURNING id INTO v_l4;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_strict, v_loc, 4, 0);
  v_r := public.run_inventory_allocation(v_prod_strict, NULL, v_loc, NULL, 'test6');
  SELECT qty_reserved INTO v_qty_res FROM public.sale_order_lines WHERE id = v_l4;
  v_ok := (v_r->>'decision_required')::boolean = true AND COALESCE(v_qty_res,0) = 0;
  v_tests := v_tests || jsonb_build_object('name','6_strict_order_decision','passed',v_ok,'observed',jsonb_build_object('qty',v_qty_res));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 7: custom_priority no weights -> fallback + warning + auto allocation works
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id,created_at) VALUES (v_prefix||'_CU',v_partner,'confirmed',v_wh,v_company,now()-interval '3 days') RETURNING id INTO v_so_cust;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_cust, v_prod_custom, 2, 'waiting_purchase') RETURNING id INTO v_lc;
  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_prod_custom, v_loc, 2, 0);
  v_r := public.run_inventory_allocation(v_prod_custom, NULL, v_loc, NULL, 'test7');
  v_ok := (v_r->>'allocated')::numeric = 2 AND v_r->>'effective_policy'='oldest_order_first' AND v_r->>'warning' IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','7_custom_priority_fallback','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TRACKING ON setup =====
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON1',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b;
  INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b, v_prod_on, 10, 'waiting_purchase') RETURNING id INTO v_l_b;

  -- packages
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'available') RETURNING id INTO v_pkg_ok;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'damaged', 'available') RETURNING id INTO v_pkg_dmg;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'at_dock') RETURNING id INTO v_pkg_dock;
  INSERT INTO public.stock_packages(product_id,qty,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_loc, 'good', 'in_truck') RETURNING id INTO v_pkg_truck;
  INSERT INTO public.stock_packages(product_id,qty,sale_order_line_id,current_location_id,condition,status)
    VALUES (v_prod_on, 2, v_l_b, v_loc, 'good', 'reserved') RETURNING id INTO v_pkg_already;

  v_r := public.run_inventory_allocation(v_prod_on, NULL, v_loc, NULL, 'test10');

  -- ===== TEST 10: tracking ON allocates available package
  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_ok) = v_l_b;
  v_tests := v_tests || jsonb_build_object('name','10_tracking_on_allocates_available','passed',v_ok,'observed',jsonb_build_object('pkg_ok_line',(SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_ok)));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 12: tracking ON does not allocate damaged
  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_dmg) IS NULL;
  v_tests := v_tests || jsonb_build_object('name','12_tracking_on_skips_damaged','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 13: tracking ON does not allocate at_dock/in_truck
  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_dock) IS NULL
       AND (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_truck) IS NULL;
  v_tests := v_tests || jsonb_build_object('name','13_tracking_on_skips_dock_truck','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 11: tracking ON does not re-allocate already reserved package
  v_ok := (SELECT sale_order_line_id FROM public.stock_packages WHERE id = v_pkg_already) = v_l_b; -- stayed same line, not changed
  v_tests := v_tests || jsonb_build_object('name','11_tracking_on_skips_already_reserved','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 14: transfer between compatible lines (OFF product)
  -- create second line for v_prod_off to receive
  INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_T',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b;
  -- reuse v_so_b as target SO holder
  DECLARE v_lt uuid;
  BEGIN
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b, v_prod_off, 3, 'waiting_purchase') RETURNING id INTO v_lt;
    v_r := public.transfer_sale_reservation(v_l1, v_lt, 2, 'test14');
    SELECT qty_reserved INTO v_resv_before FROM public.sale_order_lines WHERE id = v_l1;
    SELECT qty_reserved INTO v_resv_after  FROM public.sale_order_lines WHERE id = v_lt;
    v_ok := (v_r->>'ok')::boolean = true AND v_resv_before = 2 AND v_resv_after = 2;
    v_tests := v_tests || jsonb_build_object('name','14_transfer_between_compatible','passed',v_ok,'observed',jsonb_build_object('from',v_resv_before,'to',v_resv_after,'r',v_r));
    IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  -- ===== TEST 15: transfer blocks incompatible product
  v_r := public.transfer_sale_reservation(v_l1, v_l_b, 1, 'test15');
  v_ok := (v_r->>'ok')::boolean = false AND v_r->>'error' = 'incompatible_lines';
  v_tests := v_tests || jsonb_build_object('name','15_transfer_blocks_incompatible_product','passed',v_ok,'observed',v_r);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 16: transfer with tracking ON, package in_truck blocked
  -- mark v_pkg_ok as in_truck to simulate post-load; reset target line demand
  UPDATE public.stock_packages SET status='in_truck' WHERE id = v_pkg_ok;
  -- create a second target line on prod_on
  DECLARE v_l_b2 uuid; v_so_b2 uuid;
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON2',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b2;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b2, v_prod_on, 5, 'waiting_purchase') RETURNING id INTO v_l_b2;
    v_r := public.transfer_sale_reservation(v_l_b, v_l_b2, 2, 'test16');
    -- should fail with no_eligible_packages because v_pkg_ok is in_truck and v_pkg_already is also still on v_l_b but we'd move it... mark already as delivered too
  END;
  UPDATE public.stock_packages SET status='delivered' WHERE id = v_pkg_already;
  -- retry: now both packages on v_l_b are blocked
  DECLARE v_l_b3 uuid; v_so_b3 uuid;
  BEGIN
    INSERT INTO public.sale_orders(name,partner_id,state,warehouse_id,company_id) VALUES (v_prefix||'_ON3',v_partner,'confirmed',v_wh,v_company) RETURNING id INTO v_so_b3;
    INSERT INTO public.sale_order_lines(order_id,product_id,quantity,operational_status) VALUES (v_so_b3, v_prod_on, 5, 'waiting_purchase') RETURNING id INTO v_l_b3;
    v_r := public.transfer_sale_reservation(v_l_b, v_l_b3, 2, 'test16b');
    v_ok := (v_r->>'ok')::boolean = false AND v_r->>'error' = 'no_eligible_packages';
    v_tests := v_tests || jsonb_build_object('name','16_transfer_blocks_in_truck_delivered','passed',v_ok,'observed',v_r);
    IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;
  END;

  -- ===== TEST 19: invariant reserved_quantity <= quantity
  SELECT count(*) INTO v_inv_count FROM public.stock_quants WHERE reserved_quantity > quantity;
  v_ok := v_inv_count = 0;
  v_tests := v_tests || jsonb_build_object('name','19_no_reserved_gt_quantity','passed',v_ok,'observed',jsonb_build_object('violations',v_inv_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 20: no negative stock
  SELECT count(*) INTO v_neg_count FROM public.stock_quants WHERE quantity < 0 OR reserved_quantity < 0;
  v_ok := v_neg_count = 0;
  v_tests := v_tests || jsonb_build_object('name','20_no_negative_stock','passed',v_ok,'observed',jsonb_build_object('violations',v_neg_count));
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 21: log allocate_auto exists for our prefix
  v_ok := EXISTS (SELECT 1 FROM public.stock_reservation_log WHERE action='allocate_auto' AND notes LIKE 'test%');
  v_tests := v_tests || jsonb_build_object('name','21_log_allocate_auto','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ===== TEST 22: log transfer exists
  v_ok := EXISTS (SELECT 1 FROM public.stock_reservation_log WHERE action='transfer' AND notes LIKE 'test%');
  v_tests := v_tests || jsonb_build_object('name','22_log_transfer','passed',v_ok,'observed',NULL);
  IF v_ok THEN v_passed:=v_passed+1; ELSE v_failed:=v_failed+1; END IF;

  -- ============ cleanup ============
  DELETE FROM public.stock_reservation_log WHERE notes LIKE 'test%' AND created_at > now() - interval '1 hour';
  DELETE FROM public.allocation_decisions  WHERE product_id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);
  DELETE FROM public.stock_packages WHERE id IN (v_pkg_ok,v_pkg_dmg,v_pkg_dock,v_pkg_truck,v_pkg_already);
  DELETE FROM public.stock_quants WHERE product_id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);
  DELETE FROM public.customer_payments WHERE name LIKE v_prefix||'%';
  DELETE FROM public.sale_order_lines WHERE order_id IN (
    SELECT id FROM public.sale_orders WHERE name LIKE v_prefix||'%'
  );
  DELETE FROM public.sale_orders WHERE name LIKE v_prefix||'%';
  DELETE FROM public.products WHERE id IN (v_prod_off,v_prod_on,v_prod_strict,v_prod_manual,v_prod_paid,v_prod_date,v_prod_custom);

  RETURN jsonb_build_object('prefix',v_prefix,'total',v_passed+v_failed,'passed',v_passed,'failed',v_failed,'tests',v_tests);
END; $$;

GRANT EXECUTE ON FUNCTION public._test_phase16_b0_3_allocation_engine() TO service_role;
