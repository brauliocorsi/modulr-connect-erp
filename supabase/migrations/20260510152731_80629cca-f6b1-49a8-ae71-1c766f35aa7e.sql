
-- Helper: SO has any picking that is "scheduled" (batched or future scheduled_at set explicitly)
CREATE OR REPLACE FUNCTION public.so_is_scheduled(_so uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_pickings sp
    JOIN public.sale_orders so ON so.name = sp.origin
    WHERE so.id = _so AND sp.kind = 'outgoing'
      AND sp.state NOT IN ('done','cancelled')
      AND (
        sp.batch_id IS NOT NULL
        OR (sp.scheduled_at IS NOT NULL AND sp.scheduled_at > sp.created_at + interval '2 minutes')
      )
  );
$$;

-- Helper: SO has any active backorder picking
CREATE OR REPLACE FUNCTION public.so_has_active_backorder(_so uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_pickings sp
    JOIN public.sale_orders so ON so.name = sp.origin
    WHERE so.id = _so AND sp.kind='outgoing'
      AND sp.backorder_id IS NOT NULL
      AND sp.state NOT IN ('done','cancelled')
  );
$$;

-- Helper: SO is fully settled with cash (all related customer_payments are in closed cash sessions, or have no cash movement at all)
CREATE OR REPLACE FUNCTION public.so_is_settled(_so uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE has_open boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_payments cp
    JOIN public.cash_movements cm ON cm.payment_id = cp.id
    JOIN public.cash_sessions cs ON cs.id = cm.session_id
    WHERE cp.order_id = _so
      AND cp.state = 'posted'
      AND cs.state <> 'closed'
  ) INTO has_open;
  RETURN NOT has_open;
END $$;

-- Replace recalc_so_fulfillment with richer state machine
CREATE OR REPLACE FUNCTION public.recalc_so_fulfillment(_so uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record;
  new_status text;
  out_count int;
  out_done int;
  so_name text;
  has_backorder boolean;
  is_scheduled boolean;
  is_settled boolean;
BEGIN
  SELECT * INTO r FROM public.sale_order_fulfillment WHERE order_id = _so;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.state::text = 'cancelled' THEN
    UPDATE public.sale_orders SET fulfillment_status='cancelled' WHERE id = _so;
    RETURN;
  END IF;
  IF r.state::text IN ('draft','sent') THEN
    UPDATE public.sale_orders SET fulfillment_status='pending' WHERE id = _so;
    RETURN;
  END IF;

  SELECT name INTO so_name FROM public.sale_orders WHERE id = _so;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE state='done')
    INTO out_count, out_done
    FROM public.stock_pickings
   WHERE origin = so_name AND kind='outgoing' AND state <> 'cancelled';

  has_backorder := public.so_has_active_backorder(_so);

  -- All outgoing pickings done
  IF out_count > 0 AND out_done = out_count AND NOT has_backorder THEN
    is_settled := public.so_is_settled(_so);
    IF is_settled THEN
      new_status := 'settled';
    ELSE
      new_status := 'delivered';
    END IF;
  -- Some delivered, some pending (backorder)
  ELSIF out_done > 0 AND has_backorder THEN
    new_status := 'delivered_partial';
  -- All reserved → check if scheduled
  ELSIF r.qty_total > 0 AND r.qty_reserved >= r.qty_total THEN
    is_scheduled := public.so_is_scheduled(_so);
    IF is_scheduled THEN new_status := 'scheduled';
    ELSE new_status := 'available';
    END IF;
  -- Partial reservation + still incoming
  ELSIF r.qty_reserved > 0 AND r.qty_incoming > 0 THEN
    new_status := 'partial_available';
  -- Nothing reserved but PO confirmed → in transit
  ELSIF r.qty_incoming > 0 AND r.po_any_confirmed THEN
    new_status := 'purchased';
  -- PO drafted → ordered
  ELSIF r.qty_incoming > 0 AND r.po_any_draft THEN
    new_status := 'ordered';
  -- Partial reserved with no incoming
  ELSIF r.qty_reserved > 0 THEN
    new_status := 'available';
  ELSE
    new_status := 'pending';
  END IF;

  UPDATE public.sale_orders
     SET fulfillment_status = new_status
   WHERE id = _so AND fulfillment_status IS DISTINCT FROM new_status;
END $function$;

-- Trigger: when picking gets a batch or rescheduled date, recalc related SO
CREATE OR REPLACE FUNCTION public.tg_picking_schedule_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE so_id uuid;
BEGIN
  IF NEW.kind <> 'outgoing' OR NEW.origin IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP='UPDATE') AND
     (OLD.batch_id IS NOT DISTINCT FROM NEW.batch_id)
     AND (OLD.scheduled_at IS NOT DISTINCT FROM NEW.scheduled_at) THEN
    RETURN NEW;
  END IF;
  SELECT id INTO so_id FROM public.sale_orders WHERE name = NEW.origin;
  IF so_id IS NOT NULL THEN PERFORM public.recalc_so_fulfillment(so_id); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_picking_schedule_change ON public.stock_pickings;
CREATE TRIGGER tg_picking_schedule_change
AFTER UPDATE OF batch_id, scheduled_at ON public.stock_pickings
FOR EACH ROW EXECUTE FUNCTION public.tg_picking_schedule_change();

-- Trigger: when cash session closes, recalc all SOs whose payments touch this session
CREATE OR REPLACE FUNCTION public.tg_cash_session_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE so_id uuid;
BEGIN
  IF NEW.state = 'closed' AND COALESCE(OLD.state,'') <> 'closed' THEN
    FOR so_id IN
      SELECT DISTINCT cp.order_id
      FROM public.cash_movements cm
      JOIN public.customer_payments cp ON cp.id = cm.payment_id
      WHERE cm.session_id = NEW.id AND cp.order_id IS NOT NULL
    LOOP
      PERFORM public.recalc_so_fulfillment(so_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_cash_session_close ON public.cash_sessions;
CREATE TRIGGER tg_cash_session_close
AFTER UPDATE OF state ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_session_close();

-- Trigger: when a cash movement is inserted linked to a payment, recalc SO
CREATE OR REPLACE FUNCTION public.tg_cash_movement_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE so_id uuid;
BEGIN
  IF NEW.payment_id IS NULL THEN RETURN NEW; END IF;
  SELECT order_id INTO so_id FROM public.customer_payments WHERE id = NEW.payment_id;
  IF so_id IS NOT NULL THEN PERFORM public.recalc_so_fulfillment(so_id); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_cash_movement_after ON public.cash_movements;
CREATE TRIGGER tg_cash_movement_after
AFTER INSERT ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_movement_after();

-- Reallocate freed stock to next pending SO needing the same product
CREATE OR REPLACE FUNCTION public.reallocate_freed_stock(_product uuid, _warehouse uuid, _exclude_so uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  m record;
  reserved numeric;
  total_reserved numeric := 0;
  affected jsonb := '[]'::jsonb;
  src_so_name text;
BEGIN
  IF _exclude_so IS NOT NULL THEN
    SELECT name INTO src_so_name FROM public.sale_orders WHERE id = _exclude_so;
  END IF;

  FOR m IN
    SELECT sm.id AS move_id, sm.picking_id, sm.quantity, sm.reserved_quantity,
           so.id AS so_id, so.name AS so_name, so.salesperson_id, so.partner_id
    FROM public.stock_moves sm
    JOIN public.stock_pickings sp ON sp.id = sm.picking_id
    JOIN public.sale_orders so ON so.name = sp.origin
    WHERE sm.product_id = _product
      AND sp.kind = 'outgoing'
      AND sp.state NOT IN ('done','cancelled')
      AND sm.state IN ('draft','waiting')
      AND sp.warehouse_id = _warehouse
      AND (_exclude_so IS NULL OR so.id <> _exclude_so)
      AND so.state IN ('confirmed','sent')
      AND so.fulfillment_status IN ('pending','ordered','purchased','partial_available','backordered')
    ORDER BY so.created_at, sm.created_at
  LOOP
    reserved := public.reserve_for_move(m.move_id);
    IF reserved > 0 THEN
      total_reserved := total_reserved + reserved;
      PERFORM public.recalc_picking_state(m.picking_id);
      PERFORM public.recalc_so_fulfillment(m.so_id);
      affected := affected || jsonb_build_object('so_id', m.so_id, 'so_name', m.so_name, 'qty', reserved);
      IF m.salesperson_id IS NOT NULL THEN
        PERFORM public.notify_user(
          m.salesperson_id, 'sales'::app_module, 'reservation_reallocated',
          'Stock libertado atribuído à sua venda',
          format('A venda %s recebeu %s unid. libertadas de %s',
                 m.so_name, reserved, COALESCE(src_so_name,'outra venda')),
          '/sales/orders/' || m.so_id);
      END IF;
    END IF;
    EXIT WHEN total_reserved >= 0 AND NOT EXISTS (
      SELECT 1 FROM public.stock_quants q
      JOIN public.stock_locations l ON l.id = q.location_id
      WHERE q.product_id = _product AND l.warehouse_id = _warehouse
        AND (q.quantity - q.reserved_quantity) > 0
    );
  END LOOP;

  RETURN jsonb_build_object('total_reserved', total_reserved, 'allocated', affected);
END $$;

-- Update cancel_sale_order to free stock and reallocate
CREATE OR REPLACE FUNCTION public.cancel_sale_order(_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  o record;
  pk record;
  m record;
  freed jsonb := '[]'::jsonb;
  prod_warehouses jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale order not found'; END IF;

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

  -- Release reservations and cancel pickings
  FOR pk IN
    SELECT id FROM public.stock_pickings
    WHERE origin = o.name AND kind='outgoing' AND state NOT IN ('done','cancelled')
  LOOP
    PERFORM public.cancel_picking(pk.id, true);
  END LOOP;

  UPDATE public.sale_orders SET state='cancelled', fulfillment_status='cancelled' WHERE id = _order;
  PERFORM public.log_record_event('sale_order', _order, 'Pedido cancelado','{}'::jsonb);

  -- Reallocate to other pending SOs
  FOR m IN SELECT * FROM jsonb_to_recordset(prod_warehouses) AS x(product_id uuid, warehouse_id uuid) LOOP
    freed := freed || public.reallocate_freed_stock(m.product_id, m.warehouse_id, _order);
  END LOOP;

  PERFORM public.log_record_event('sale_order', _order,
    'Realocação automática após cancelamento', jsonb_build_object('details', freed));
END $function$;

-- Patch cancel_picking to reallocate after release for outgoing pickings
CREATE OR REPLACE FUNCTION public.cancel_picking(_picking uuid, _cascade boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  m record;
  nxt record;
  p record;
  pairs jsonb := '[]'::jsonb;
  src_so_id uuid;
BEGIN
  SELECT * INTO p FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RETURN; END IF;
  IF p.state = 'done' THEN
    RAISE EXCEPTION 'Não é possível cancelar uma transferência já concluída';
  END IF;

  IF p.kind = 'outgoing' AND p.origin IS NOT NULL THEN
    SELECT id INTO src_so_id FROM public.sale_orders WHERE name = p.origin;
    FOR m IN
      SELECT DISTINCT product_id FROM public.stock_moves
      WHERE picking_id = _picking AND COALESCE(reserved_quantity,0) > 0
    LOOP
      pairs := pairs || jsonb_build_object('product_id', m.product_id, 'warehouse_id', p.warehouse_id);
    END LOOP;
  END IF;

  FOR m IN SELECT id FROM public.stock_moves WHERE picking_id = _picking AND state NOT IN ('done','cancelled') LOOP
    PERFORM public.release_move_reservation(m.id);
    UPDATE public.stock_moves SET state = 'cancelled'::picking_state WHERE id = m.id;
  END LOOP;
  UPDATE public.stock_pickings SET state = 'cancelled'::picking_state WHERE id = _picking;
  PERFORM public.log_record_event('stock_picking', _picking, 'Transferência cancelada', '{}'::jsonb);

  IF _cascade THEN
    FOR nxt IN SELECT id FROM public.stock_pickings WHERE previous_picking_id = _picking AND state NOT IN ('done','cancelled') LOOP
      PERFORM public.cancel_picking(nxt.id, true);
    END LOOP;
  END IF;

  -- Reallocate freed reservations to other pending SOs
  IF jsonb_array_length(pairs) > 0 THEN
    FOR m IN SELECT * FROM jsonb_to_recordset(pairs) AS x(product_id uuid, warehouse_id uuid) LOOP
      PERFORM public.reallocate_freed_stock(m.product_id, m.warehouse_id, src_so_id);
    END LOOP;
  END IF;
END $function$;

-- Patch confirm_purchase_order to recalc fulfillment of all linked SOs
CREATE OR REPLACE FUNCTION public.confirm_purchase_order(_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  o record;
  l record;
  wh uuid;
  src uuid;
  dst uuid;
  v_picking_id uuid;
  picking_name text;
  reception_mode text;
  so_id uuid;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF o.state NOT IN ('draft','rfq_sent') THEN RAISE EXCEPTION 'PO must be draft/rfq'; END IF;

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  SELECT COALESCE(reception_steps, 'one_step') INTO reception_mode FROM public.warehouses WHERE id = wh;
  src := public.supplier_location_id();
  dst := CASE WHEN reception_mode = 'one_step' THEN public.default_location(wh, 'Stock')
              ELSE public.default_location(wh, 'Recebimento') END;

  picking_name := public.next_sequence('picking_in');
  INSERT INTO public.stock_pickings(
    name, kind, state, warehouse_id, source_location_id, destination_location_id,
    partner_id, origin, created_by, scheduled_at, step_label
  ) VALUES (
    picking_name, 'incoming'::picking_kind, 'ready'::picking_state, wh, src, dst,
    o.partner_id, o.name, auth.uid(), COALESCE(o.expected_date::timestamptz, now()),
    CASE WHEN reception_mode = 'one_step' THEN 'Receção (Fornecedor → Stock)' ELSE 'Receção (Fornecedor → Recebimento)' END
  ) RETURNING id INTO v_picking_id;

  FOR l IN SELECT * FROM public.purchase_order_lines WHERE order_id = _order LOOP
    INSERT INTO public.stock_moves(
      picking_id, product_id, variant_id, uom_id, source_location_id,
      destination_location_id, quantity, state, reference
    ) VALUES (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst,
              l.quantity, 'ready'::picking_state, o.name);
  END LOOP;

  UPDATE public.purchase_orders SET state = 'confirmed' WHERE id = _order;
  PERFORM public.log_record_event('purchase_order', _order, format('Compra confirmada, recebimento %s criado', picking_name),'{}'::jsonb);
  IF o.buyer_id IS NOT NULL THEN
    PERFORM public.notify_user(o.buyer_id,'purchase','po_confirmed','Compra confirmada',
      format('%s para %s', o.name,(SELECT name FROM public.partners WHERE id=o.partner_id)),'/purchase/orders');
  END IF;

  -- Recalc all sale orders linked to this PO
  FOR so_id IN
    SELECT DISTINCT s.id
    FROM public.sale_orders s
    LEFT JOIN public.purchase_order_origins poo ON poo.sale_order_id = s.id AND poo.po_id = _order
    WHERE poo.sale_order_id IS NOT NULL OR s.name = o.origin
  LOOP
    PERFORM public.recalc_so_fulfillment(so_id);
  END LOOP;
END $function$;

-- Recalc all confirmed sale orders to apply new state machine
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sale_orders WHERE state IN ('confirmed','done') LOOP
    PERFORM public.recalc_so_fulfillment(r.id);
  END LOOP;
END $$;
