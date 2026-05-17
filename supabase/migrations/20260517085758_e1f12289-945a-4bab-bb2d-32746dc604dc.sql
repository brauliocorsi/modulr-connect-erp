-- ============================================================================
-- F16-C.3 Migration 3: mfg_reserve_components_on_receipt
-- Reserves received PO quantities to the originating SO/MO purchase_need
-- with unambiguous PO<->need link resolution and purchase_need_remaining_qty
-- as the single source of truth.
-- ZERO changes to close_mo, cancel_sale_order, run_inventory_allocation
-- internals, sales hooks or UI.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mfg_reserve_components_on_receipt(_stock_move_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_move           stock_moves%ROWTYPE;
  v_picking_kind   text;
  v_received_qty   numeric;
  v_loc            uuid;
  v_product_id     uuid;
  v_variant_id     uuid;
  v_need           purchase_needs%ROWTYPE;
  v_need_id        uuid;
  v_candidate_cnt  int;
  v_remaining      numeric;
  v_to_reserve     numeric;
  v_surplus        numeric;
  v_quant_id       uuid;
  v_quant_qty      numeric;
  v_quant_res      numeric;
  v_mo_id          uuid;
  v_mo_comp        mo_components%ROWTYPE;
  v_sol            sale_order_lines%ROWTYPE;
  v_is_component   boolean;
  v_policy         text;
  v_route          text := 'unrouted';
  v_reason         text := NULL;
  v_already        int;
  v_result         jsonb;
  v_satisfied      boolean := false;
  v_alloc_payload  jsonb := '[]'::jsonb;
BEGIN
  -- 1. Validate stock_move
  SELECT * INTO v_move FROM stock_moves WHERE id = _stock_move_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stock_move_not_found', 'stock_move_id', _stock_move_id);
  END IF;

  IF v_move.state::text <> 'done' THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'stock_move_not_done',
      'stock_move_id', _stock_move_id, 'state', v_move.state::text);
  END IF;

  SELECT kind::text INTO v_picking_kind FROM stock_pickings WHERE id = v_move.picking_id;
  IF v_picking_kind IS DISTINCT FROM 'incoming' THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'not_incoming_picking',
      'stock_move_id', _stock_move_id, 'picking_kind', v_picking_kind);
  END IF;

  v_product_id   := v_move.product_id;
  v_variant_id   := v_move.variant_id;
  v_loc          := v_move.destination_location_id;
  v_received_qty := COALESCE(NULLIF(v_move.quantity_done, 0), v_move.quantity, 0);

  IF v_received_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'no_quantity_received',
      'stock_move_id', _stock_move_id);
  END IF;

  IF v_loc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'no_destination_location',
      'stock_move_id', _stock_move_id);
  END IF;

  -- 2. Idempotency check
  SELECT COUNT(*) INTO v_already
  FROM stock_reservation_log
  WHERE (payload->>'stock_move_id') = _stock_move_id::text
    AND (payload->>'source') = 'mfg_reserve_components_on_receipt'
    AND action = 'reserve';

  IF v_already > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_processed',
      'stock_move_id', _stock_move_id, 'existing_log_entries', v_already);
  END IF;

  -- 3. Resolve purchase_need (unambiguous link only)
  IF v_move.purchase_need_id IS NOT NULL THEN
    SELECT * INTO v_need FROM purchase_needs WHERE id = v_move.purchase_need_id FOR UPDATE;
    IF FOUND THEN
      v_need_id := v_need.id;
    END IF;
  END IF;

  IF v_need_id IS NULL AND v_move.purchase_order_line_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_candidate_cnt
    FROM purchase_needs
    WHERE purchase_order_line_id = v_move.purchase_order_line_id
      AND state NOT IN ('cancelled','received');
    IF v_candidate_cnt = 1 THEN
      SELECT * INTO v_need FROM purchase_needs
      WHERE purchase_order_line_id = v_move.purchase_order_line_id
        AND state NOT IN ('cancelled','received')
      FOR UPDATE;
      v_need_id := v_need.id;
    ELSIF v_candidate_cnt > 1 THEN
      v_reason := 'ambiguous_purchase_need_link';
    END IF;
  END IF;

  -- Helpers for routing/policy
  v_is_component := public.is_manufacturing_component(v_product_id);
  SELECT COALESCE(component_allocation_policy::text, 'manufacturing_first')
    INTO v_policy
  FROM products WHERE id = v_product_id;

  -- Lock destination quant for invariants
  SELECT id, quantity, reserved_quantity INTO v_quant_id, v_quant_qty, v_quant_res
  FROM stock_quants
  WHERE location_id = v_loc
    AND product_id = v_product_id
    AND COALESCE(variant_id::text,'') = COALESCE(v_variant_id::text,'')
  FOR UPDATE;

  -- 4/5. Specific need path
  IF v_need_id IS NOT NULL THEN
    v_remaining := public.purchase_need_remaining_qty(v_need_id);

    IF v_remaining <= 0 THEN
      -- Need was satisfied by other stock before this PO arrived
      UPDATE purchase_needs
      SET satisfied_by      = COALESCE(satisfied_by, 'other_purchase'),
          satisfied_at      = COALESCE(satisfied_at, now()),
          satisfied_source_id = COALESCE(satisfied_source_id, _stock_move_id),
          fulfillment_payload = COALESCE(fulfillment_payload, '{}'::jsonb)
            || jsonb_build_object(
                 'late_receipt_stock_move_id', _stock_move_id,
                 'late_receipt_source', 'mfg_reserve_components_on_receipt')
      WHERE id = v_need_id AND satisfied_at IS NULL;

      -- Route surplus to correct engine
      IF v_need.sale_order_line_id IS NOT NULL THEN
        v_alloc_payload := jsonb_build_array(
          public.run_inventory_allocation(v_product_id, v_variant_id, v_loc, v_received_qty, 'po_receipt_need_already_satisfied'));
        v_route := 'sales_allocation_engine';
      ELSIF v_need.mo_component_id IS NOT NULL THEN
        IF v_is_component AND v_policy IN ('manufacturing_first','oldest_need_first') THEN
          v_alloc_payload := jsonb_build_array(
            public.mfg_allocate_components_from_stock(v_product_id, v_variant_id, v_loc, v_received_qty, 'po_receipt_need_already_satisfied'));
          v_route := 'component_allocation_engine';
        ELSE
          v_route := 'stock_free_no_allocation';
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'stock_move_id', _stock_move_id,
        'purchase_need_id', v_need_id,
        'remaining', 0,
        'reserved', 0,
        'route', v_route,
        'reason', 'need_already_satisfied_by_other_source',
        'allocation', v_alloc_payload);
    END IF;

    v_to_reserve := LEAST(v_received_qty, v_remaining);
    v_surplus    := v_received_qty - v_to_reserve;

    IF v_need.sale_order_line_id IS NOT NULL THEN
      -- CASE A: Sale order line
      SELECT * INTO v_sol FROM sale_order_lines WHERE id = v_need.sale_order_line_id FOR UPDATE;
      IF FOUND THEN
        v_to_reserve := LEAST(v_to_reserve, GREATEST(v_sol.quantity - COALESCE(v_sol.qty_reserved,0), 0));
        IF v_to_reserve > 0 AND v_quant_id IS NOT NULL THEN
          v_to_reserve := LEAST(v_to_reserve, GREATEST(v_quant_qty - v_quant_res, 0));
        END IF;

        IF v_to_reserve > 0 THEN
          UPDATE sale_order_lines
          SET qty_reserved = COALESCE(qty_reserved,0) + v_to_reserve
          WHERE id = v_sol.id;

          IF v_quant_id IS NOT NULL THEN
            UPDATE stock_quants
            SET reserved_quantity = reserved_quantity + v_to_reserve
            WHERE id = v_quant_id
              AND reserved_quantity + v_to_reserve <= quantity;
          END IF;

          INSERT INTO stock_reservation_log
            (origin_type, origin_id, action, to_sale_order_line_id, product_id, variant_id, location_id, qty, payload)
          VALUES
            ('PURCHASE', _stock_move_id, 'reserve', v_sol.id, v_product_id, v_variant_id, v_loc, v_to_reserve,
             jsonb_build_object(
               'source','mfg_reserve_components_on_receipt',
               'purchase_need_id', v_need_id,
               'stock_move_id', _stock_move_id));

          -- Check satisfaction
          SELECT (public.purchase_need_remaining_qty(v_need_id) <= 0) INTO v_satisfied;
          IF v_satisfied THEN
            UPDATE purchase_needs
            SET satisfied_by='po_receipt',
                satisfied_at=now(),
                satisfied_source_id=_stock_move_id,
                satisfied_qty = COALESCE(satisfied_qty,0) + v_to_reserve,
                fulfillment_payload = COALESCE(fulfillment_payload,'{}'::jsonb)
                  || jsonb_build_object('source','mfg_reserve_components_on_receipt','stock_move_id',_stock_move_id)
            WHERE id = v_need_id;
          END IF;
        END IF;
      END IF;

      IF v_surplus > 0 THEN
        v_alloc_payload := jsonb_build_array(
          public.run_inventory_allocation(v_product_id, v_variant_id, v_loc, v_surplus, 'po_receipt_surplus'));
      END IF;
      v_route := 'sale_order_line';

    ELSIF v_need.mo_component_id IS NOT NULL THEN
      -- CASE B: MO component
      SELECT * INTO v_mo_comp FROM mo_components WHERE id = v_need.mo_component_id FOR UPDATE;
      IF FOUND THEN
        v_mo_id := v_mo_comp.mo_id;
        v_to_reserve := LEAST(v_to_reserve, GREATEST(v_mo_comp.qty_required - COALESCE(v_mo_comp.qty_reserved,0), 0));
        IF v_to_reserve > 0 AND v_quant_id IS NOT NULL THEN
          v_to_reserve := LEAST(v_to_reserve, GREATEST(v_quant_qty - v_quant_res, 0));
        END IF;

        IF v_to_reserve > 0 THEN
          UPDATE mo_components
          SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + v_to_reserve)
          WHERE id = v_mo_comp.id;

          IF v_quant_id IS NOT NULL THEN
            UPDATE stock_quants
            SET reserved_quantity = reserved_quantity + v_to_reserve
            WHERE id = v_quant_id
              AND reserved_quantity + v_to_reserve <= quantity;
          END IF;

          INSERT INTO stock_reservation_log
            (origin_type, origin_id, action, product_id, variant_id, location_id, qty, payload)
          VALUES
            ('MO', v_mo_id, 'reserve', v_product_id, v_variant_id, v_loc, v_to_reserve,
             jsonb_build_object(
               'source','mfg_reserve_components_on_receipt',
               'purchase_need_id', v_need_id,
               'mo_component_id', v_mo_comp.id,
               'stock_move_id', _stock_move_id));

          PERFORM public.mfg_refresh_mo_state(v_mo_id);

          SELECT (public.purchase_need_remaining_qty(v_need_id) <= 0) INTO v_satisfied;
          IF v_satisfied THEN
            UPDATE purchase_needs
            SET satisfied_by='po_receipt',
                satisfied_at=now(),
                satisfied_source_id=_stock_move_id,
                satisfied_qty = COALESCE(satisfied_qty,0) + v_to_reserve,
                fulfillment_payload = COALESCE(fulfillment_payload,'{}'::jsonb)
                  || jsonb_build_object('source','mfg_reserve_components_on_receipt','stock_move_id',_stock_move_id)
            WHERE id = v_need_id;
          END IF;
        END IF;
      END IF;

      IF v_surplus > 0 AND v_is_component AND v_policy IN ('manufacturing_first','oldest_need_first') THEN
        v_alloc_payload := jsonb_build_array(
          public.mfg_allocate_components_from_stock(v_product_id, v_variant_id, v_loc, v_surplus, 'po_receipt_surplus'));
      END IF;
      v_route := 'mo_component';
    END IF;

    v_result := jsonb_build_object(
      'ok', true,
      'stock_move_id', _stock_move_id,
      'purchase_need_id', v_need_id,
      'received_qty', v_received_qty,
      'reserved', v_to_reserve,
      'surplus', v_surplus,
      'route', v_route,
      'satisfied', v_satisfied,
      'allocation', v_alloc_payload);
    RETURN v_result;
  END IF;

  -- 6. Stock replenishment / ambiguous
  IF v_is_component AND v_policy IN ('manufacturing_first','oldest_need_first') THEN
    v_alloc_payload := jsonb_build_array(
      public.mfg_allocate_components_from_stock(v_product_id, v_variant_id, v_loc, v_received_qty,
        COALESCE(v_reason, 'stock_replenishment_receipt')));
    v_route := 'component_allocation_engine';
  ELSIF v_is_component AND v_policy = 'sales_first' THEN
    v_alloc_payload := jsonb_build_array(
      public.run_inventory_allocation(v_product_id, v_variant_id, v_loc, v_received_qty,
        'purchase_receipt_stock_replenishment_sales_first'));
    v_route := 'sales_then_components';
  ELSIF NOT v_is_component THEN
    v_alloc_payload := jsonb_build_array(
      public.run_inventory_allocation(v_product_id, v_variant_id, v_loc, v_received_qty,
        'purchase_receipt_stock_replenishment'));
    v_route := 'sales_allocation_engine';
  ELSE
    v_route := 'stock_free_manual_policy';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'stock_move_id', _stock_move_id,
    'purchase_need_id', NULL,
    'received_qty', v_received_qty,
    'reserved', 0,
    'route', v_route,
    'reason', COALESCE(v_reason, 'stock_replenishment'),
    'allocation', v_alloc_payload);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mfg_reserve_components_on_receipt(uuid) TO authenticated, service_role;