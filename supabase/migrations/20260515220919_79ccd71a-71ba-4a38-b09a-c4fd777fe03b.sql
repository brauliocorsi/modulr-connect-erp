
-- Phase 5: cancellation cascade

CREATE OR REPLACE FUNCTION public.cancel_mo(_mo uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m record;
BEGIN
  SELECT id, state::text AS state INTO m FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.state = 'done' THEN
    RAISE EXCEPTION 'Cannot cancel a completed manufacturing order';
  END IF;
  IF m.state = 'cancelled' THEN RETURN; END IF;

  -- Release reservations is performed by tg_mo_state_reservations trigger when state -> cancelled
  UPDATE public.manufacturing_orders
     SET state = 'cancelled'::mo_state, actual_end = COALESCE(actual_end, now())
   WHERE id = _mo;
END $$;

-- Patch cancel_sale_order to cascade to MOs, purchase_needs, schedules
CREATE OR REPLACE FUNCTION public.cancel_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  pk record;
  m record;
  freed jsonb := '[]'::jsonb;
  prod_warehouses jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale order not found'; END IF;
  IF o.state = 'cancelled' THEN RETURN; END IF;

  -- Collect (product, warehouse) pairs reserved on outgoing pickings before cancel
  FOR m IN
    SELECT DISTINCT sm.product_id, sp.warehouse_id
    FROM public.stock_moves sm
    JOIN public.stock_pickings sp ON sp.id = sm.picking_id
    WHERE sp.origin = o.name AND sp.kind='outgoing'
      AND sp.state NOT IN ('done','cancelled')
      AND sm.state IN ('waiting','ready','draft')
      AND COALESCE(sm.reserved_quantity,0) > 0
  LOOP
    prod_warehouses := prod_warehouses || jsonb_build_object('product_id', m.product_id, 'warehouse_id', m.warehouse_id);
  END LOOP;

  -- Cancel outgoing pickings (releases reservations via cancel_picking)
  FOR pk IN
    SELECT id FROM public.stock_pickings
    WHERE origin = o.name AND kind='outgoing' AND state NOT IN ('done','cancelled')
  LOOP
    PERFORM public.cancel_picking(pk.id, true);
  END LOOP;

  -- Cancel linked MOs (not done)
  FOR m IN
    SELECT id FROM public.manufacturing_orders
    WHERE sale_order_id = _order AND state::text NOT IN ('done','cancelled')
  LOOP
    PERFORM public.cancel_mo(m.id);
  END LOOP;

  -- Cancel open purchase_needs from this SO
  UPDATE public.purchase_needs
     SET state = 'cancelled'::purchase_need_state, updated_at = now()
   WHERE sale_order_id = _order
     AND state::text IN ('pending','quoting','approved');

  -- Cancel unpaid payment schedules (preserve paid/partial)
  UPDATE public.sale_payment_schedules
     SET state = 'cancelled'
   WHERE order_id = _order
     AND COALESCE(paid_amount,0) = 0
     AND state <> 'paid';

  UPDATE public.sale_orders
     SET state='cancelled', fulfillment_status='cancelled'
   WHERE id = _order;
  PERFORM public.log_record_event('sale_order', _order, 'Pedido cancelado','{}'::jsonb);

  -- Reallocate freed stock
  FOR m IN SELECT * FROM jsonb_to_recordset(prod_warehouses) AS x(product_id uuid, warehouse_id uuid) LOOP
    freed := freed || public.reallocate_freed_stock(m.product_id, m.warehouse_id, _order);
  END LOOP;

  PERFORM public.log_record_event('sale_order', _order,
    'Realocação automática após cancelamento', jsonb_build_object('details', freed));
END $$;

-- =====================================================================
-- Self test
-- =====================================================================
CREATE OR REPLACE FUNCTION public._test_phase5()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asserts jsonb := '[]'::jsonb;
  v_partner uuid;
  v_product uuid;
  v_so uuid;
  v_mo uuid;
  v_need uuid;
  v_sched uuid;
  v_state text;
  cnt int;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_product FROM public.products WHERE COALESCE(can_be_manufactured,false) LIMIT 1;
  IF v_product IS NULL THEN SELECT id INTO v_product FROM public.products LIMIT 1; END IF;
  IF v_partner IS NULL OR v_product IS NULL THEN
    RETURN jsonb_build_object('asserts', jsonb_build_array(
      jsonb_build_object('step','setup','ok',false,'observed','no partner/product')));
  END IF;

  -- Create a confirmed SO with linked MO + purchase_need + unpaid schedule + paid schedule
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total)
       VALUES ('PHASE5-'||gen_random_uuid()::text, v_partner, 'confirmed', 100)
    RETURNING id INTO v_so;

  INSERT INTO public.manufacturing_orders(code, sale_order_id, product_id, qty, state)
       VALUES ('MO-PH5-'||gen_random_uuid()::text, v_so, v_product, 1, 'draft')
    RETURNING id INTO v_mo;

  INSERT INTO public.purchase_needs(product_id, qty_needed, origin_kind, sale_order_id, state)
       VALUES (v_product, 5, 'sale', v_so, 'pending')
    RETURNING id INTO v_need;

  INSERT INTO public.sale_payment_schedules(order_id, sequence, label, due_kind, amount, paid_amount, state)
       VALUES (v_so, 1, 'Sinal',  'on_confirm', 30, 30, 'paid');
  INSERT INTO public.sale_payment_schedules(order_id, sequence, label, due_kind, amount, paid_amount, state)
       VALUES (v_so, 2, 'Resto', 'on_delivery', 70, 0, 'pending')
    RETURNING id INTO v_sched;

  -- Cancel SO
  PERFORM public.cancel_sale_order(v_so);

  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','SO_cancelled','ok',v_state='cancelled','observed',jsonb_build_object('state',v_state));

  SELECT state::text INTO v_state FROM public.manufacturing_orders WHERE id=v_mo;
  asserts := asserts || jsonb_build_object('step','MO_cancelled','ok',v_state='cancelled','observed',jsonb_build_object('state',v_state));

  SELECT state::text INTO v_state FROM public.purchase_needs WHERE id=v_need;
  asserts := asserts || jsonb_build_object('step','need_cancelled','ok',v_state='cancelled','observed',jsonb_build_object('state',v_state));

  SELECT state INTO v_state FROM public.sale_payment_schedules WHERE id=v_sched;
  asserts := asserts || jsonb_build_object('step','unpaid_schedule_cancelled','ok',v_state='cancelled','observed',jsonb_build_object('state',v_state));

  SELECT COUNT(*) INTO cnt FROM public.sale_payment_schedules WHERE order_id=v_so AND state='paid';
  asserts := asserts || jsonb_build_object('step','paid_schedule_preserved','ok',cnt=1,'observed',jsonb_build_object('paid_count',cnt));

  -- Idempotency
  PERFORM public.cancel_sale_order(v_so);
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','idempotent_cancel','ok',v_state='cancelled','observed',jsonb_build_object('state',v_state));

  -- Cannot cancel done MO
  INSERT INTO public.manufacturing_orders(code, product_id, qty, state)
       VALUES ('MO-PH5D-'||gen_random_uuid()::text, v_product, 1, 'done')
    RETURNING id INTO v_mo;
  BEGIN
    PERFORM public.cancel_mo(v_mo);
    asserts := asserts || jsonb_build_object('step','done_mo_cannot_cancel','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','done_mo_cannot_cancel','ok',true,'observed',SQLERRM);
  END;

  RETURN jsonb_build_object('asserts', asserts);
END $$;
