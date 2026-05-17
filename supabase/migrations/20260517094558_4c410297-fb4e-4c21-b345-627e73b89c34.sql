CREATE OR REPLACE FUNCTION public.erp_health_check(_threshold_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_row record;
  v_threshold timestamptz := now() - make_interval(days => _threshold_days);
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0; v_p3 int := 0;
  v_started_at timestamptz := clock_timestamp();
  v_summary jsonb;
BEGIN
  -- 1. SALES
  FOR v_row IN
    SELECT id, name, state, fulfillment_status, payment_status FROM sale_orders
    WHERE fulfillment_status IN ('delivered','settled') AND payment_status='paid'
      AND state NOT IN ('done','cancelled')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','sales','code','sale_delivered_paid_not_done','severity','P0','entity','sale_order','entity_id',v_row.id,
      'detail', format('SO %s entregue+pago mas state=%s', v_row.name, v_row.state));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT so.id, so.name, so.amount_total,
           COALESCE((SELECT SUM(CASE WHEN cp.refund_of IS NULL THEN cp.amount ELSE -cp.amount END)
                     FROM customer_payments cp WHERE cp.order_id=so.id AND cp.state='posted'),0) AS net_paid
    FROM sale_orders so WHERE so.state='done'
  LOOP
    IF v_row.net_paid < v_row.amount_total - 0.01 THEN
      v_findings := v_findings || jsonb_build_object('category','sales','code','sale_done_open_balance','severity','P0','entity','sale_order','entity_id',v_row.id,
        'detail', format('SO %s done saldo aberto: total=%s pago=%s', v_row.name, v_row.amount_total, v_row.net_paid));
      v_p0 := v_p0+1;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT so.id, so.name FROM sale_orders so
    WHERE so.state = 'confirmed' AND so.confirmed_at IS NOT NULL AND so.confirmed_at < v_threshold
      AND NOT EXISTS (SELECT 1 FROM stock_pickings sp WHERE sp.origin=so.name)
      AND NOT EXISTS (SELECT 1 FROM manufacturing_orders mo WHERE mo.sale_order_id=so.id)
      AND NOT EXISTS (SELECT 1 FROM purchase_needs pn WHERE pn.sale_order_id=so.id)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','sales','code','sale_confirmed_no_fulfillment','severity','P1','entity','sale_order','entity_id',v_row.id,
      'detail', format('SO %s confirmada >%s dias sem picking/MO/need', v_row.name, _threshold_days));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT so.id, so.name, so.payment_status, so.amount_total,
           COALESCE(SUM(sps.paid_amount),0) AS schedule_paid
    FROM sale_orders so LEFT JOIN sale_payment_schedules sps ON sps.order_id=so.id
    WHERE so.state IN ('confirmed','done') GROUP BY so.id
  LOOP
    IF v_row.payment_status='paid' AND v_row.schedule_paid < v_row.amount_total - 0.01 THEN
      v_findings := v_findings || jsonb_build_object('category','sales','code','sale_payment_schedule_mismatch','severity','P2','entity','sale_order','entity_id',v_row.id,
        'detail', format('SO %s paid mas schedules=%s/%s', v_row.name, v_row.schedule_paid, v_row.amount_total));
      v_p2 := v_p2+1;
    END IF;
  END LOOP;

  -- 2. INVENTORY
  FOR v_row IN SELECT id, product_id, quantity, reserved_quantity, location_id FROM stock_quants WHERE reserved_quantity > quantity LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','quant_reserved_gt_qty','severity','P0','entity','stock_quant','entity_id',v_row.id,
      'detail', format('Quant prod=%s reserved=%s qty=%s', v_row.product_id, v_row.reserved_quantity, v_row.quantity));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id, product_id, reserved_quantity FROM stock_quants WHERE reserved_quantity < 0 LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','quant_reserved_negative','severity','P0','entity','stock_quant','entity_id',v_row.id,
      'detail', format('Quant prod=%s reserved=%s', v_row.product_id, v_row.reserved_quantity));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id, quantity_done FROM stock_moves WHERE state='done' AND quantity_done <= 0 LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','move_done_zero_qty','severity','P1','entity','stock_move','entity_id',v_row.id,
      'detail', format('Move done qty_done=%s', v_row.quantity_done));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id, reserved_quantity, quantity FROM stock_moves WHERE reserved_quantity > quantity AND state NOT IN ('done','cancelled') LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','move_reserved_gt_qty','severity','P1','entity','stock_move','entity_id',v_row.id,
      'detail', format('Move reserved=%s qty=%s', v_row.reserved_quantity, v_row.quantity));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT sp.id, sp.name FROM stock_pickings sp WHERE sp.state='done'
      AND EXISTS (SELECT 1 FROM stock_moves sm WHERE sm.picking_id=sp.id AND sm.state NOT IN ('done','cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','picking_done_open_moves','severity','P0','entity','stock_picking','entity_id',v_row.id,
      'detail', format('Picking %s done com moves abertos', v_row.name));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id, product_id, quantity, reserved_quantity FROM stock_quants WHERE quantity - reserved_quantity < 0 LOOP
    v_findings := v_findings || jsonb_build_object('category','inventory','code','available_negative','severity','P0','entity','stock_quant','entity_id',v_row.id,
      'detail', format('Disponível neg prod=%s qty=%s res=%s', v_row.product_id, v_row.quantity, v_row.reserved_quantity));
    v_p0 := v_p0+1;
  END LOOP;

  -- 3. MANUFACTURING
  FOR v_row IN
    SELECT mo.id, mo.code FROM manufacturing_orders mo
    WHERE mo.state IN ('in_progress','ready')
      AND EXISTS (SELECT 1 FROM mo_components mc WHERE mc.mo_id=mo.id AND mc.qty_required>0)
      AND NOT EXISTS (SELECT 1 FROM mo_components mc WHERE mc.mo_id=mo.id AND mc.qty_reserved>0)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_progress_no_reservation','severity','P1','entity','manufacturing_order','entity_id',v_row.id,
      'detail', format('MO %s em produção sem reservas', v_row.code));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT mo.id, mo.code, mo.product_id, mo.actual_start FROM manufacturing_orders mo WHERE mo.state='done'
      AND NOT EXISTS (
        SELECT 1 FROM stock_moves sm
        JOIN stock_locations sl ON sl.id=sm.destination_location_id
        WHERE sm.product_id=mo.product_id AND sm.state='done' AND sl.type='internal'
          AND sm.created_at >= COALESCE(mo.actual_start, mo.created_at)
      )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_done_no_output','severity','P0','entity','manufacturing_order','entity_id',v_row.id,
      'detail', format('MO %s done sem entrada de produto', v_row.code));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT mo.id, mo.code FROM manufacturing_orders mo WHERE mo.state='cancelled'
      AND EXISTS (SELECT 1 FROM mo_components mc WHERE mc.mo_id=mo.id AND mc.qty_reserved>0)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_cancelled_reservations','severity','P1','entity','manufacturing_order','entity_id',v_row.id,
      'detail', format('MO %s cancelada com qty_reserved>0', v_row.code));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id, qty_required, qty_reserved FROM mo_components WHERE qty_reserved < 0 OR qty_reserved > qty_required + 0.0001 LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_component_invalid_reserve','severity','P1','entity','mo_component','entity_id',v_row.id,
      'detail', format('Comp reserved=%s required=%s', v_row.qty_reserved, v_row.qty_required));
    v_p1 := v_p1+1;
  END LOOP;

  -- 4. PURCHASES
  FOR v_row IN SELECT po.id, po.name FROM purchase_orders po WHERE po.state IN ('confirmed','done') LOOP
    DECLARE v_status jsonb; v_line jsonb;
    BEGIN
      v_status := purchase_order_receipt_status(v_row.id);
      FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(v_status->'lines','[]'::jsonb)) LOOP
        IF (v_line->>'received')::numeric > (v_line->>'ordered')::numeric + 0.0001 THEN
          v_findings := v_findings || jsonb_build_object('category','purchase','code','po_over_received','severity','P0','entity','purchase_order','entity_id',v_row.id,
            'detail', format('PO %s recebido %s > pedido %s', v_row.name, v_line->>'received', v_line->>'ordered'));
          v_p0 := v_p0+1;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  FOR v_row IN
    SELECT po.id, po.name FROM purchase_orders po WHERE po.state='confirmed' AND po.date_order < v_threshold
      AND EXISTS (SELECT 1 FROM stock_pickings sp WHERE sp.origin=po.name AND sp.state='done')
      AND EXISTS (SELECT 1 FROM stock_pickings sp WHERE sp.origin=po.name AND sp.state NOT IN ('done','cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','po_partial_receipt_stale','severity','P2','entity','purchase_order','entity_id',v_row.id,
      'detail', format('PO %s recebida parcial >%s dias', v_row.name, _threshold_days));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN SELECT id FROM purchase_needs WHERE state='pending' AND purchase_order_id IS NULL AND created_at < v_threshold LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','need_pending_no_po','severity','P1','entity','purchase_need','entity_id',v_row.id,
      'detail', format('Need pendente sem PO >%s dias', _threshold_days));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT pn.id FROM purchase_needs pn WHERE pn.state='cancelled' AND (
      EXISTS (SELECT 1 FROM sale_orders so WHERE so.id=pn.sale_order_id AND so.state IN ('confirmed','done'))
      OR EXISTS (SELECT 1 FROM manufacturing_orders mo WHERE mo.id=pn.manufacturing_order_id AND mo.state NOT IN ('cancelled','done'))
    )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','need_cancelled_still_linked','severity','P1','entity','purchase_need','entity_id',v_row.id,
      'detail','Need cancelada mas ligada a SO/MO ativa');
    v_p1 := v_p1+1;
  END LOOP;

  -- 5. CASH
  FOR v_row IN SELECT id, name, opened_at FROM cash_sessions WHERE state='open' AND opened_at < now() - interval '24 hours' LOOP
    v_findings := v_findings || jsonb_build_object('category','cash','code','cash_session_open_long','severity','P1','entity','cash_session','entity_id',v_row.id,
      'detail', format('Caixa %s aberta há %s', v_row.name, age(now(), v_row.opened_at)));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id, name, difference FROM cash_sessions WHERE state='closed' AND COALESCE(difference,0)<>0 AND COALESCE(notes,'')='' LOOP
    v_findings := v_findings || jsonb_build_object('category','cash','code','cash_diff_no_reason','severity','P2','entity','cash_session','entity_id',v_row.id,
      'detail', format('Caixa %s diferença=%s sem motivo', v_row.name, v_row.difference));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN
    SELECT cm.id FROM cash_movements cm JOIN cash_sessions cs ON cs.id=cm.session_id
    WHERE cs.state='closed' AND cs.closed_at IS NOT NULL AND cm.created_at > cs.closed_at
  LOOP
    v_findings := v_findings || jsonb_build_object('category','cash','code','cash_movement_after_close','severity','P0','entity','cash_movement','entity_id',v_row.id,
      'detail','Movimento criado após fecho');
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT cs.id, cs.name, cs.opening_balance, cs.closing_balance_theoretical,
      COALESCE((SELECT SUM(CASE WHEN cm.kind IN ('in','cash_in','income') THEN cm.amount
                                WHEN cm.kind IN ('out','cash_out','expense') THEN -cm.amount
                                ELSE cm.amount END)
                FROM cash_movements cm WHERE cm.session_id=cs.id),0) AS sum_movs
    FROM cash_sessions cs WHERE cs.state='closed'
  LOOP
    IF v_row.closing_balance_theoretical IS NOT NULL
       AND ABS(v_row.closing_balance_theoretical - (COALESCE(v_row.opening_balance,0)+v_row.sum_movs)) > 0.01 THEN
      v_findings := v_findings || jsonb_build_object('category','cash','code','cash_balance_summary_mismatch','severity','P1','entity','cash_session','entity_id',v_row.id,
        'detail', format('Caixa %s teórico=%s vs calc=%s', v_row.name, v_row.closing_balance_theoretical, v_row.opening_balance+v_row.sum_movs));
      v_p1 := v_p1+1;
    END IF;
  END LOOP;

  -- 6. FINANCE
  FOR v_row IN
    SELECT cp.id, cp.name FROM customer_payments cp WHERE cp.state='posted' AND cp.refund_of IS NULL
      AND cp.order_id IS NOT NULL AND cp.schedule_id IS NULL
      AND EXISTS (SELECT 1 FROM sale_payment_schedules sps WHERE sps.order_id=cp.order_id)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','finance','code','payment_no_schedule','severity','P2','entity','customer_payment','entity_id',v_row.id,
      'detail', format('Pagamento %s sem schedule_id', v_row.name));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN
    SELECT cp.id, cp.name FROM customer_payments cp WHERE cp.refund_of IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customer_payments orig WHERE orig.id=cp.refund_of AND orig.state='posted')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','finance','code','refund_orphan','severity','P0','entity','customer_payment','entity_id',v_row.id,
      'detail', format('Refund %s sem original', v_row.name));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT so.id, so.name, so.amount_total,
      COALESCE((SELECT SUM(CASE WHEN cp.refund_of IS NULL THEN cp.amount ELSE -cp.amount END)
                FROM customer_payments cp WHERE cp.order_id=so.id AND cp.state='posted'),0) AS net
    FROM sale_orders so WHERE so.state IN ('confirmed','done')
  LOOP
    IF v_row.net > v_row.amount_total + 0.01 THEN
      v_findings := v_findings || jsonb_build_object('category','finance','code','payment_over_total','severity','P0','entity','sale_order','entity_id',v_row.id,
        'detail', format('SO %s pago=%s > total=%s', v_row.name, v_row.net, v_row.amount_total));
      v_p0 := v_p0+1;
    END IF;
  END LOOP;

  FOR v_row IN SELECT so.id, so.name FROM sale_orders so WHERE so.state IN ('confirmed','done') LOOP
    DECLARE v_rec jsonb;
    BEGIN
      v_rec := sale_order_reconciliation(v_row.id);
      IF (v_rec->>'consistent')::boolean = false THEN
        v_findings := v_findings || jsonb_build_object('category','finance','code','reconciliation_inconsistent','severity','P1','entity','sale_order','entity_id',v_row.id,
          'detail', format('SO %s db=%s expected=%s', v_row.name, v_rec->>'payment_status_db', v_rec->>'payment_status_expected'));
        v_p1 := v_p1+1;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- 7. DELIVERY
  FOR v_row IN SELECT id, name FROM stock_pickings WHERE kind='outgoing' AND state NOT IN ('done','cancelled') AND created_at < v_threshold LOOP
    v_findings := v_findings || jsonb_build_object('category','delivery','code','delivery_open_stale','severity','P1','entity','stock_picking','entity_id',v_row.id,
      'detail', format('Entrega %s aberta >%s dias', v_row.name, _threshold_days));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT so.id, so.name FROM sale_orders so WHERE so.state='cancelled' AND so.fulfillment_status IN ('delivered','partial')
      AND NOT EXISTS (SELECT 1 FROM stock_pickings sp WHERE sp.origin=so.name AND sp.kind='incoming' AND sp.state='done')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','delivery','code','return_pending','severity','P2','entity','sale_order','entity_id',v_row.id,
      'detail', format('SO %s cancelada sem devolução', v_row.name));
    v_p2 := v_p2+1;
  END LOOP;

  -- 8. NOTIFICATIONS
  FOR v_row IN
    SELECT entity_type, entity_id, user_id, type, COUNT(*) AS dup
    FROM notifications WHERE created_at > now() - interval '7 days' AND entity_id IS NOT NULL
    GROUP BY entity_type, entity_id, user_id, type, date_trunc('hour', created_at)
    HAVING COUNT(*) > 1
  LOOP
    v_findings := v_findings || jsonb_build_object('category','notifications','code','notification_duplicate','severity','P3','entity','notification','entity_id',v_row.entity_id,
      'detail', format('%sx duplicadas tipo=%s user=%s', v_row.dup, v_row.type, v_row.user_id));
    v_p3 := v_p3+1;
  END LOOP;


  -- 9. F16-C.3 — COMPONENT PURCHASE RESERVATION
  -- P0.1 mo_waiting_components_while_component_stock_available
  FOR v_row IN
    SELECT mc.id AS mc_id, mc.mo_id, mc.product_id, mc.qty_required, mc.qty_reserved, mo.code
      FROM mo_components mc
      JOIN manufacturing_orders mo ON mo.id = mc.mo_id
     WHERE mo.state IN ('confirmed','planned','in_progress','ready')
       AND mc.qty_required > COALESCE(mc.qty_reserved,0)
       AND COALESCE((SELECT SUM(GREATEST(sq.quantity - sq.reserved_quantity,0))
                       FROM stock_quants sq
                      WHERE sq.product_id = mc.product_id),0)
           >= (mc.qty_required - COALESCE(mc.qty_reserved,0))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_waiting_components_while_component_stock_available','severity','P0','entity','mo_component','entity_id',v_row.mc_id,
      'detail', format('MO %s comp prod=%s req=%s res=%s mas stock livre disponível', v_row.code, v_row.product_id, v_row.qty_required, v_row.qty_reserved));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0.2 component_received_for_mo_not_reserved
  FOR v_row IN
    SELECT sm.id AS sm_id, sm.product_id, pn.mo_component_id, pn.id AS pn_id
      FROM stock_moves sm
      JOIN purchase_needs pn ON pn.id = sm.purchase_need_id
      JOIN mo_components mc ON mc.id = pn.mo_component_id
      JOIN manufacturing_orders mo ON mo.id = mc.mo_id
     WHERE sm.state='done'
       AND pn.mo_component_id IS NOT NULL
       AND mo.state NOT IN ('done','cancelled')
       AND mc.qty_required > COALESCE(mc.qty_reserved,0)
       AND NOT EXISTS (
         SELECT 1 FROM stock_reservation_log srl
          WHERE srl.origin_type='mo_component'
            AND srl.origin_id = mc.id
            AND srl.payload->>'stock_move_id' = sm.id::text
       )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','component_received_for_mo_not_reserved','severity','P0','entity','stock_move','entity_id',v_row.sm_id,
      'detail', format('Move done ligado a need %s/mo_comp %s mas sem reserva registada', v_row.pn_id, v_row.mo_component_id));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0.3 mo_component_reserved_exceeds_required
  FOR v_row IN
    SELECT id, mo_id, product_id, qty_required, qty_reserved FROM mo_components
     WHERE qty_reserved > qty_required + 0.0001
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','mo_component_reserved_exceeds_required','severity','P0','entity','mo_component','entity_id',v_row.id,
      'detail', format('mo_comp prod=%s reserved=%s > required=%s', v_row.product_id, v_row.qty_reserved, v_row.qty_required));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0.4 component_reserved_quantity_exceeds_stock (distinct code from quant_reserved_gt_qty, scoped to manufacturing components)
  FOR v_row IN
    SELECT sq.id, sq.product_id, sq.quantity, sq.reserved_quantity
      FROM stock_quants sq
     WHERE sq.reserved_quantity > sq.quantity
       AND public.is_manufacturing_component(sq.product_id) = true
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','component_reserved_quantity_exceeds_stock','severity','P0','entity','stock_quant','entity_id',v_row.id,
      'detail', format('Comp prod=%s reserved=%s > quantity=%s', v_row.product_id, v_row.reserved_quantity, v_row.quantity));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0.5 purchase_need_satisfied_but_state_open
  FOR v_row IN
    SELECT id, state, qty_needed FROM purchase_needs pn
     WHERE pn.state NOT IN ('received','cancelled')
       AND pn.satisfied_at IS NULL
       AND public.purchase_need_remaining_qty(pn.id) = 0
       AND pn.qty_needed > 0
  LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','purchase_need_satisfied_but_state_open','severity','P0','entity','purchase_need','entity_id',v_row.id,
      'detail', format('Need state=%s mas remaining=0', v_row.state));
    v_p0 := v_p0+1;
  END LOOP;

  -- P1.1 component_stock_allocated_to_sale_while_mo_waiting (exceto sales_first)
  FOR v_row IN
    SELECT DISTINCT mc.id AS mc_id, mc.product_id, mc.mo_id, p.component_allocation_policy::text AS pol
      FROM mo_components mc
      JOIN products p ON p.id = mc.product_id
      JOIN manufacturing_orders mo ON mo.id = mc.mo_id
     WHERE mo.state IN ('confirmed','planned','in_progress','ready')
       AND mc.qty_required > COALESCE(mc.qty_reserved,0)
       AND COALESCE(p.component_allocation_policy::text,'manufacturing_first') <> 'sales_first'
       AND EXISTS (
         SELECT 1 FROM sale_order_lines sol
          JOIN sale_orders so ON so.id = sol.order_id
         WHERE sol.product_id = mc.product_id
           AND COALESCE(sol.qty_reserved,0) > 0
           AND so.state IN ('confirmed','sale','draft')
       )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','component_stock_allocated_to_sale_while_mo_waiting','severity','P1','entity','mo_component','entity_id',v_row.mc_id,
      'detail', format('Comp prod=%s policy=%s reservado para venda enquanto MO espera', v_row.product_id, v_row.pol));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1.2 component_allocation_policy_missing
  FOR v_row IN
    SELECT DISTINCT p.id, p.name
      FROM products p
     WHERE public.is_manufacturing_component(p.id) = true
       AND p.component_allocation_policy IS NULL
  LOOP
    v_findings := v_findings || jsonb_build_object('category','products','code','component_allocation_policy_missing','severity','P1','entity','product','entity_id',v_row.id,
      'detail', format('Produto %s é componente de fabrico sem component_allocation_policy', v_row.name));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1.3 purchase_need_missing_mo_component_link
  FOR v_row IN
    SELECT pn.id, pn.product_id, pn.manufacturing_order_id
      FROM purchase_needs pn
     WHERE pn.origin_kind = 'manufacturing'
       AND pn.manufacturing_order_id IS NOT NULL
       AND pn.mo_component_id IS NULL
       AND pn.state NOT IN ('cancelled','received')
       AND EXISTS (
         SELECT 1 FROM mo_components mc
          WHERE mc.mo_id = pn.manufacturing_order_id
            AND mc.product_id = pn.product_id
       )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','purchase_need_missing_mo_component_link','severity','P1','entity','purchase_need','entity_id',v_row.id,
      'detail', format('Need origin=manufacturing MO=%s prod=%s sem mo_component_id', v_row.manufacturing_order_id, v_row.product_id));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1.4 po_received_after_need_satisfied_not_reallocated
  FOR v_row IN
    SELECT pn.id, pn.product_id, pn.purchase_order_id
      FROM purchase_needs pn
     WHERE pn.satisfied_at IS NOT NULL
       AND pn.purchase_order_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM stock_moves sm
          WHERE sm.purchase_need_id = pn.id
            AND sm.state = 'done'
            AND sm.created_at > pn.satisfied_at
       )
       AND NOT EXISTS (
         SELECT 1 FROM stock_reservation_log srl
          WHERE srl.payload->>'purchase_need_id' = pn.id::text
            AND srl.action IN ('reallocated','allocated','replenishment_unallocated_surplus','redirected')
            AND srl.created_at > pn.satisfied_at
       )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','purchase','code','po_received_after_need_satisfied_not_reallocated','severity','P1','entity','purchase_need','entity_id',v_row.id,
      'detail', format('Need satisfied prod=%s recebeu mais sem realocação', v_row.product_id));
    v_p1 := v_p1+1;
  END LOOP;

  -- P2.1 component_stock_available_no_mo_need
  FOR v_row IN
    SELECT p.id AS product_id, p.name,
           COALESCE((SELECT SUM(GREATEST(sq.quantity - sq.reserved_quantity,0))
                       FROM stock_quants sq WHERE sq.product_id = p.id),0) AS free_qty
      FROM products p
     WHERE p.active = true
       AND public.is_manufacturing_component(p.id) = true
       AND COALESCE((SELECT SUM(GREATEST(sq.quantity - sq.reserved_quantity,0))
                       FROM stock_quants sq WHERE sq.product_id = p.id),0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM mo_components mc
          JOIN manufacturing_orders mo ON mo.id = mc.mo_id
         WHERE mc.product_id = p.id
           AND mc.qty_required > COALESCE(mc.qty_reserved,0)
           AND mo.state IN ('confirmed','planned','in_progress','ready')
       )
  LOOP
    v_findings := v_findings || jsonb_build_object('category','manufacturing','code','component_stock_available_no_mo_need','severity','P2','entity','product','entity_id',v_row.product_id,
      'detail', format('Comp %s tem %s livre sem MO a precisar', v_row.name, v_row.free_qty));
    v_p2 := v_p2+1;
  END LOOP;


  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', EXTRACT(MILLISECOND FROM (clock_timestamp()-v_started_at))::int);

  RETURN jsonb_build_object('summary', v_summary, 'findings', v_findings);
END;
$function$;

COMMENT ON FUNCTION public.erp_health_check(int) IS 'F16-C.3: extended with P0/P1/P2 component-purchase-reservation checks';