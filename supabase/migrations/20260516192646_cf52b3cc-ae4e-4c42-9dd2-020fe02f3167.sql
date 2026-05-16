
-- =========================================================
-- F16-B0.3 FIX — normalize logging:
--   origin_type stays a business origin (MANUAL here).
--   Technical RPC name + context goes into payload jsonb.
-- No changes to close_mo, cancel_sale_order, origin_type CHECK,
-- no triggers, no hooks.
-- =========================================================

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
  v_packages_used jsonb := '[]'::jsonb;
  v_target        record;
  v_pkg           record;
  v_q             record;
  v_needed        numeric;
  v_take          numeric;
  v_lock_key      bigint;
  v_dec_id        uuid;
  v_new_resv      numeric;
  v_score         numeric;
BEGIN
  IF _product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_id_required');
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  v_policy := COALESCE(v_prod.allocation_policy, 'oldest_order_first'::allocation_policy);

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
          jsonb_build_object('policy', v_policy, 'source','run_inventory_allocation')
        ) RETURNING id INTO v_dec_id;
      END IF;
      v_decisions := v_decisions || jsonb_build_object(
        'decision_id', v_dec_id,
        'sale_order_line_id', v_target.sale_order_line_id,
        'qty', v_target.qty_missing
      );
    END LOOP;

    INSERT INTO public.stock_reservation_log(
      product_id, variant_id, location_id, qty, origin_type, origin_id,
      action, notes, payload
    ) VALUES (
      _product_id, _variant_id, _location_id, 0, 'MANUAL', NULL,
      'decision_required', _reason,
      jsonb_build_object(
        'source','run_inventory_allocation',
        'reason', _reason,
        'policy', v_policy,
        'product_id', _product_id,
        'variant_id', _variant_id,
        'decisions', v_decisions
      )
    );

    RETURN jsonb_build_object(
      'ok', true, 'auto', false, 'policy', v_policy,
      'decision_required', true, 'decisions', v_decisions,
      'allocated', 0
    );
  END IF;

  -- ============== AUTO PATH ==============
  v_lock_key := hashtextextended(
    _product_id::text || ':' || COALESCE(_variant_id::text,'') || ':' || COALESCE(_location_id::text,''),
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  v_remaining := COALESCE(_qty, 1e15);

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
    SELECT b.sale_order_id, b.sale_order_line_id, b.qty_missing, b.score
      FROM base b
      JOIN public.sale_order_lines sol ON sol.id = b.sale_order_line_id
      ORDER BY b.score ASC, b.created_at ASC
      FOR UPDATE OF sol SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_needed := LEAST(v_target.qty_missing, v_remaining);
    v_score  := v_target.score;
    IF v_needed <= 0 THEN CONTINUE; END IF;

    IF COALESCE(v_prod.package_tracking_enabled,false) THEN
      FOR v_pkg IN
        SELECT sp.id, sp.qty, sp.sale_order_id
          FROM public.stock_packages sp
         WHERE sp.product_id = _product_id
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
          'MANUAL', NULL, 'allocate_auto', _reason,
          v_target.sale_order_line_id, ARRAY[v_pkg.id],
          jsonb_build_object(
            'source','run_inventory_allocation',
            'reason', _reason,
            'policy', v_policy,
            'effective_policy', v_effective,
            'tracking','on',
            'product_id', _product_id,
            'variant_id', _variant_id,
            'to_sale_order_line_id', v_target.sale_order_line_id,
            'qty', v_pkg.qty,
            'package_ids', jsonb_build_array(v_pkg.id),
            'candidate_score', v_score
          )
        );
      END LOOP;

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
      FOR v_q IN
        SELECT id, quantity, reserved_quantity
          FROM public.stock_quants
         WHERE product_id = _product_id
           AND ((_variant_id IS NULL AND variant_id IS NULL) OR variant_id = _variant_id)
           AND (_location_id IS NULL OR location_id = _location_id)
           AND (COALESCE(quantity,0) - COALESCE(reserved_quantity,0)) > 0
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN v_needed <= 0;
        v_take := LEAST(v_needed, COALESCE(v_q.quantity,0) - COALESCE(v_q.reserved_quantity,0));
        IF v_take <= 0 THEN CONTINUE; END IF;
        v_new_resv := COALESCE(v_q.reserved_quantity,0) + v_take;

        UPDATE public.stock_quants
           SET reserved_quantity = v_new_resv
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
          'MANUAL', NULL, 'allocate_auto', _reason,
          v_target.sale_order_line_id,
          jsonb_build_object(
            'source','run_inventory_allocation',
            'reason', _reason,
            'policy', v_policy,
            'effective_policy', v_effective,
            'tracking','off',
            'product_id', _product_id,
            'variant_id', _variant_id,
            'to_sale_order_line_id', v_target.sale_order_line_id,
            'qty', v_take,
            'quant_id', v_q.id,
            'candidate_score', v_score
          )
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
  v_pkg_ids uuid[];
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
    FOR v_pkg IN
      SELECT id, qty, status
        FROM public.stock_packages
       WHERE sale_order_line_id = _from_sale_order_line_id
       ORDER BY qty ASC
       FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN v_moved >= _qty;
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

  v_pkg_ids := CASE WHEN jsonb_array_length(v_pkgs) > 0
                    THEN ARRAY(SELECT (value::text)::uuid FROM jsonb_array_elements_text(v_pkgs))
                    ELSE NULL END;

  INSERT INTO public.stock_reservation_log(
    product_id, variant_id, qty, origin_type, origin_id, action, notes,
    from_sale_order_line_id, to_sale_order_line_id, package_ids, payload
  ) VALUES (
    v_from.product_id, v_from.variant_id, v_moved,
    'MANUAL', NULL, 'transfer', _reason,
    _from_sale_order_line_id, _to_sale_order_line_id,
    v_pkg_ids,
    jsonb_build_object(
      'source','transfer_sale_reservation',
      'reason', _reason,
      'tracking', COALESCE(v_prod.package_tracking_enabled,false),
      'product_id', v_from.product_id,
      'variant_id', v_from.variant_id,
      'from_sale_order_line_id', _from_sale_order_line_id,
      'to_sale_order_line_id', _to_sale_order_line_id,
      'qty', v_moved,
      'package_ids', v_pkgs
    )
  );

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'packages', v_pkgs);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_sale_reservation(uuid,uuid,numeric,text) TO authenticated, service_role;
