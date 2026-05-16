
CREATE OR REPLACE FUNCTION public.cancel_sale_order(
  _order_id uuid,
  _options  jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so            public.sale_orders%ROWTYPE;
  v_action_in     text;
  v_target_line   uuid;
  v_reason        text;
  v_blocked       jsonb := '[]'::jsonb;
  v_decisions     jsonb := '[]'::jsonb;
  v_released_pkgs jsonb := '[]'::jsonb;
  v_realloc       jsonb := '[]'::jsonb;
  v_mo            record;
  v_pk            record;
  v_pkg           record;
  v_line          record;
  v_prod          public.products%ROWTYPE;
  v_dec_id        uuid;
  v_main_loc      uuid;
  v_r             jsonb;
  v_action_eff    text;
  v_has_physical  boolean := false;
  v_per_action    text;
  v_line_qty      numeric;
BEGIN
  SELECT * INTO v_so FROM public.sale_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sale_order_not_found');
  END IF;
  IF v_so.state = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'sale_order_id', _order_id, 'state', 'cancelled');
  END IF;

  v_action_in   := COALESCE(NULLIF(_options->>'reservation_action',''), 'auto');
  v_target_line := NULLIF(_options->>'target_sale_order_line_id','')::uuid;
  v_reason      := NULLIF(_options->>'reason','');

  IF v_action_in = 'manual_reassign' THEN
    IF v_target_line IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'target_sale_order_line_id_required');
    END IF;
    FOR v_line IN
      SELECT id, product_id, variant_id, qty_reserved
        FROM public.sale_order_lines
       WHERE order_id = _order_id AND COALESCE(qty_reserved,0) > 0
    LOOP
      v_r := public.transfer_sale_reservation(v_line.id, v_target_line, v_line.qty_reserved, v_reason);
      v_realloc := v_realloc || jsonb_build_object('from_line', v_line.id, 'result', v_r);
    END LOOP;
  END IF;

  -- Pre-flight: packages em fluxo físico ou danificados
  FOR v_pkg IN
    SELECT id, product_id, sale_order_line_id, qty, status::text AS status, condition::text AS condition
      FROM public.stock_packages
     WHERE sale_order_id = _order_id
       AND (status::text IN ('at_dock','picked','loaded','delivered')
            OR condition::text IN ('damaged','quarantine','missing'))
  LOOP
    IF v_pkg.status IN ('at_dock','picked','loaded','delivered') THEN
      v_has_physical := true;
      v_blocked := v_blocked || jsonb_build_object('package_id', v_pkg.id, 'reason', 'package_in_physical_flow_requires_return', 'status', v_pkg.status);
    ELSE
      v_blocked := v_blocked || jsonb_build_object('package_id', v_pkg.id, 'reason', 'package_condition_blocks_auto_realloc', 'condition', v_pkg.condition);
    END IF;

    INSERT INTO public.allocation_decisions(product_id, variant_id, qty, source_sale_order_line_id, state, reason, payload)
    SELECT v_pkg.product_id, NULL, GREATEST(v_pkg.qty, 0.0001), v_pkg.sale_order_line_id, 'pending',
           'cancel_sale_order_blocked',
           jsonb_build_object('source','cancel_sale_order_decision_required','sale_order_id',_order_id,'package_id',v_pkg.id,'status',v_pkg.status,'condition',v_pkg.condition)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.allocation_decisions ad
       WHERE ad.state='pending'
         AND ad.source_sale_order_line_id IS NOT DISTINCT FROM v_pkg.sale_order_line_id
         AND ad.product_id = v_pkg.product_id
         AND (ad.payload->>'package_id')::uuid = v_pkg.id
    )
    RETURNING id INTO v_dec_id;

    IF v_dec_id IS NOT NULL THEN
      v_decisions := v_decisions || jsonb_build_object('decision_id', v_dec_id, 'package_id', v_pkg.id);
      INSERT INTO public.stock_reservation_log(product_id, variant_id, location_id, qty, origin_type, origin_id, action, package_ids, payload)
      VALUES (v_pkg.product_id, NULL, NULL, v_pkg.qty, 'SO', _order_id, 'decision_required', ARRAY[v_pkg.id],
              jsonb_build_object('source','cancel_sale_order_decision_required','package_status',v_pkg.status,'package_condition',v_pkg.condition,'decision_id',v_dec_id));
    END IF;
  END LOOP;

  IF v_has_physical THEN
    PERFORM public.log_record_event('sale_order', _order_id, 'Cancelamento bloqueado: packages em fluxo físico requerem retorno',
      jsonb_build_object('blocked', v_blocked, 'decisions', v_decisions));
    RETURN jsonb_build_object('ok', false, 'state', 'decision_required', 'reason', 'package_in_physical_flow_requires_return', 'blocked', v_blocked, 'decisions', v_decisions);
  END IF;

  -- MOs
  FOR v_mo IN
    SELECT mo.id, mo.state::text AS state, mo.product_id, mo.qty
      FROM public.manufacturing_orders mo
     WHERE mo.sale_order_id = _order_id
  LOOP
    IF v_mo.state IN ('done','cancelled') THEN CONTINUE; END IF;
    SELECT * INTO v_prod FROM public.products WHERE id = v_mo.product_id;

    IF v_mo.state IN ('draft','waiting_material','ready') THEN
      PERFORM public.cancel_mo(v_mo.id);
    ELSE
      IF COALESCE(v_prod.allocation_policy::text,'oldest_order_first') IN ('strict_order','manual_allocation') THEN
        INSERT INTO public.allocation_decisions(product_id, variant_id, qty, source_sale_order_line_id, state, reason, payload)
        SELECT v_mo.product_id, NULL, GREATEST(v_mo.qty, 0.0001), NULL, 'pending', 'mo_in_progress_strict_order',
               jsonb_build_object('source','cancel_sale_order_mo_reassign','manufacturing_order_id',v_mo.id,'sale_order_id',_order_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.allocation_decisions ad
           WHERE ad.state='pending' AND ad.product_id = v_mo.product_id
             AND (ad.payload->>'manufacturing_order_id')::uuid = v_mo.id
        );
        PERFORM public.log_record_event('manufacturing_order', v_mo.id,
          'Reatribuição manual necessária (SO cancelada, strict_order)',
          jsonb_build_object('sale_order_id', _order_id));
      ELSE
        UPDATE public.manufacturing_orders
           SET sale_order_id = NULL, sale_order_line_id = NULL
         WHERE id = v_mo.id;
        PERFORM public.log_record_event('manufacturing_order', v_mo.id,
          'MO desvinculada de SO cancelada; continua para stock',
          jsonb_build_object('sale_order_id', _order_id, 'policy', v_prod.allocation_policy));
      END IF;
    END IF;
  END LOOP;

  -- Cancelar pickings outgoing
  FOR v_pk IN
    SELECT id FROM public.stock_pickings
     WHERE origin = v_so.name AND kind='outgoing' AND state NOT IN ('done','cancelled')
  LOOP
    PERFORM public.cancel_picking(v_pk.id, true);
  END LOOP;

  -- Libertar packages seguros
  FOR v_pkg IN
    SELECT id, product_id, sale_order_line_id, qty, status::text AS status, condition::text AS condition
      FROM public.stock_packages
     WHERE sale_order_id = _order_id
       AND status::text NOT IN ('at_dock','picked','loaded','delivered','cancelled')
       AND condition::text NOT IN ('damaged','quarantine','missing')
    FOR UPDATE
  LOOP
    UPDATE public.stock_packages
       SET sale_order_id = NULL, sale_order_line_id = NULL, status = 'available'::package_status
     WHERE id = v_pkg.id;
    v_released_pkgs := v_released_pkgs || jsonb_build_object('package_id', v_pkg.id);
    INSERT INTO public.stock_reservation_log(product_id, variant_id, location_id, qty, origin_type, origin_id, action, from_sale_order_line_id, package_ids, payload)
    VALUES (v_pkg.product_id, NULL, NULL, v_pkg.qty, 'SO', _order_id, 'release', v_pkg.sale_order_line_id, ARRAY[v_pkg.id],
            jsonb_build_object('source','cancel_sale_order_release','package_tracking',true,'prev_status',v_pkg.status));
  END LOOP;

  -- Purchase needs e payment schedules
  UPDATE public.purchase_needs
     SET state = 'cancelled'::purchase_need_state, updated_at = now()
   WHERE sale_order_id = _order_id AND state::text IN ('pending','quoting','approved');
  UPDATE public.sale_payment_schedules
     SET state = 'cancelled'
   WHERE order_id = _order_id AND COALESCE(paid_amount,0) = 0 AND state <> 'paid';

  -- Log release por linha (com qty > 0)
  FOR v_line IN
    SELECT id, product_id, variant_id, qty_reserved
      FROM public.sale_order_lines
     WHERE order_id = _order_id AND COALESCE(qty_reserved,0) > 0
  LOOP
    INSERT INTO public.stock_reservation_log(product_id, variant_id, location_id, qty, origin_type, origin_id, action, from_sale_order_line_id, payload)
    VALUES (v_line.product_id, v_line.variant_id, NULL, v_line.qty_reserved, 'SO', _order_id, 'release', v_line.id,
            jsonb_build_object('source','cancel_sale_order_release_line'));
  END LOOP;

  -- Cancelar SO
  UPDATE public.sale_orders SET state='cancelled', fulfillment_status='cancelled' WHERE id = _order_id;
  PERFORM public.log_record_event('sale_order', _order_id, 'Pedido cancelado',
    jsonb_build_object('action',v_action_in,'released_packages',v_released_pkgs,'blocked',v_blocked,'decisions',v_decisions,'manual_reassign',v_realloc,'reason',v_reason));

  v_action_eff := v_action_in;
  IF v_action_eff IN ('auto','run_allocation','decision_required') THEN
    FOR v_line IN
      SELECT DISTINCT sol.product_id, sol.variant_id, so.warehouse_id,
             SUM(sol.quantity) AS line_qty
        FROM public.sale_order_lines sol
        JOIN public.sale_orders so ON so.id = sol.order_id
       WHERE sol.order_id = _order_id
       GROUP BY sol.product_id, sol.variant_id, so.warehouse_id
    LOOP
      SELECT * INTO v_prod FROM public.products WHERE id = v_line.product_id;
      SELECT id INTO v_main_loc FROM public.stock_locations
       WHERE warehouse_id = v_line.warehouse_id AND type='internal' LIMIT 1;

      v_per_action := v_action_eff;
      IF v_action_eff = 'auto' THEN
        IF COALESCE(v_prod.allocation_policy::text,'oldest_order_first') IN ('strict_order','manual_allocation') THEN
          v_per_action := 'decision_required';
        ELSE
          v_per_action := 'run_allocation';
        END IF;
      END IF;

      IF v_per_action = 'run_allocation' THEN
        v_r := public.run_inventory_allocation(v_line.product_id, v_line.variant_id, v_main_loc, NULL,
          COALESCE(v_reason,'cancel_sale_order_run_allocation'));
        v_realloc := v_realloc || jsonb_build_object('product_id', v_line.product_id, 'result', v_r);
      ELSIF v_per_action = 'decision_required' THEN
        v_line_qty := GREATEST(COALESCE(v_line.line_qty, 1), 0.0001);
        INSERT INTO public.allocation_decisions(product_id, variant_id, qty, source_sale_order_line_id, state, reason, payload)
        SELECT v_line.product_id, v_line.variant_id, v_line_qty, NULL, 'pending', 'cancel_sale_order_decision_required',
               jsonb_build_object('source','cancel_sale_order_decision_required','sale_order_id',_order_id,'policy',v_prod.allocation_policy)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.allocation_decisions ad
           WHERE ad.state='pending' AND ad.product_id = v_line.product_id
             AND (ad.payload->>'sale_order_id')::uuid = _order_id
             AND ad.reason = 'cancel_sale_order_decision_required'
        )
        RETURNING id INTO v_dec_id;
        IF v_dec_id IS NOT NULL THEN
          v_decisions := v_decisions || jsonb_build_object('decision_id', v_dec_id, 'product_id', v_line.product_id);
          INSERT INTO public.stock_reservation_log(product_id, variant_id, location_id, qty, origin_type, origin_id, action, payload)
          VALUES (v_line.product_id, v_line.variant_id, v_main_loc, v_line_qty, 'SO', _order_id, 'decision_required',
                  jsonb_build_object('source','cancel_sale_order_decision_required','decision_id',v_dec_id,'policy',v_prod.allocation_policy));
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'sale_order_id', _order_id, 'state', 'cancelled', 'action', v_action_in,
    'released_packages', v_released_pkgs, 'blocked', v_blocked, 'decisions', v_decisions, 'reallocation', v_realloc);
END $function$;
