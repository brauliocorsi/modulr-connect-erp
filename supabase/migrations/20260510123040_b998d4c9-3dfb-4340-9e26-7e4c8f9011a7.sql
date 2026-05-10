CREATE OR REPLACE FUNCTION public.reserve_incoming_to_origin_so(_picking uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pk record;
  po record;
  so_rec record;
  incoming_move record;
  out_move record;
  reserved numeric;
BEGIN
  SELECT * INTO pk FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND OR pk.kind <> 'incoming' OR pk.origin IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO po FROM public.purchase_orders WHERE name = pk.origin;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR so_rec IN
    SELECT DISTINCT so.*
    FROM public.sale_orders so
    LEFT JOIN public.purchase_order_origins poo ON poo.sale_order_id = so.id AND poo.po_id = po.id
    WHERE poo.sale_order_id IS NOT NULL OR so.name = po.origin
    ORDER BY so.created_at
  LOOP
    FOR incoming_move IN
      SELECT *
      FROM public.stock_moves
      WHERE picking_id = _picking
        AND COALESCE(quantity_done, 0) > 0
    LOOP
      FOR out_move IN
        SELECT sm.*
        FROM public.stock_moves sm
        JOIN public.stock_pickings sp ON sp.id = sm.picking_id
        WHERE sp.origin = so_rec.name
          AND sp.kind = 'outgoing'
          AND sp.state NOT IN ('done','cancelled')
          AND sm.product_id = incoming_move.product_id
          AND sm.state IN ('draft','waiting','ready')
        ORDER BY sp.created_at, sm.created_at
      LOOP
        reserved := public.reserve_for_move(out_move.id);
        PERFORM public.recalc_picking_state(out_move.picking_id);
      END LOOP;
    END LOOP;

    PERFORM public.recalc_so_fulfillment(so_rec.id);
    PERFORM public.log_record_event('sale_order', so_rec.id,
      format('Recebimento %s validado — disponibilidade da venda recalculada', pk.name), '{}'::jsonb);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_purchase_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  l record;
  wh uuid;
  src uuid;
  dst uuid;
  v_picking_id uuid;
  picking_name text;
  reception_mode text;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF o.state NOT IN ('draft','rfq_sent') THEN RAISE EXCEPTION 'PO must be draft/rfq'; END IF;

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  SELECT COALESCE(reception_steps, 'one_step') INTO reception_mode FROM public.warehouses WHERE id = wh;
  src := public.supplier_location_id();
  dst := CASE
    WHEN reception_mode = 'one_step' THEN public.default_location(wh, 'Stock')
    ELSE public.default_location(wh, 'Recebimento')
  END;

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
    ) VALUES (
      v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst,
      l.quantity, 'ready'::picking_state, o.name
    );
  END LOOP;

  UPDATE public.purchase_orders SET state = 'confirmed' WHERE id = _order;
  PERFORM public.log_record_event('purchase_order', _order, format('Compra confirmada, recebimento %s criado', picking_name),'{}'::jsonb);
  IF o.buyer_id IS NOT NULL THEN
    PERFORM public.notify_user(o.buyer_id,'purchase','po_confirmed','Compra confirmada',
      format('%s para %s', o.name,(SELECT name FROM public.partners WHERE id=o.partner_id)),'/purchase/orders');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record; prod record;
  wh_mode text;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.state <> 'draft' AND o.state <> 'sent' THEN RAISE EXCEPTION 'Order must be draft/sent'; END IF;

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  SELECT COALESCE(delivery_steps,'one_step') INTO wh_mode FROM public.warehouses WHERE id=wh;

  IF wh_mode <> 'one_step' THEN
    v_picking_id := public.create_outgoing_chain(_order);
    FOR l IN
      SELECT sm.* FROM public.stock_moves sm
      JOIN public.stock_pickings sp ON sp.id = sm.picking_id
      WHERE sp.origin = o.name AND sp.kind='outgoing'
        AND sm.source_location_id = public.default_location(wh,'Stock')
    LOOP
      DECLARE reserved numeric;
      BEGIN
        reserved := public.reserve_for_move(l.id);
        IF reserved < l.quantity THEN
          shortage := l.quantity - reserved;
          SELECT can_be_purchased, auto_purchase INTO prod FROM public.products WHERE id = l.product_id;
          IF public.is_module_installed('purchase') AND COALESCE(prod.can_be_purchased, true) AND COALESCE(prod.auto_purchase, true) THEN
            SELECT partner_id INTO pref_supplier FROM public.product_suppliers WHERE product_id = l.product_id ORDER BY priority LIMIT 1;
            IF pref_supplier IS NOT NULL THEN
              SELECT id INTO po_id FROM public.purchase_orders
              WHERE partner_id = pref_supplier AND state = 'draft' AND warehouse_id = wh AND origin = o.name
              ORDER BY created_at DESC LIMIT 1;
              IF po_id IS NULL THEN
                po_name := public.next_sequence('purchase_order');
                expected := current_date + COALESCE((SELECT min(lead_time_days) FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier),7);
                INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
                VALUES(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) RETURNING id INTO po_id;
                INSERT INTO public.module_events(source_module, event_type, payload)
                VALUES('purchase','auto_po_created', jsonb_build_object('po_id', po_id, 'so_id', _order, 'partner_id', pref_supplier));
                PERFORM public.log_record_event('sale_order', _order,
                  format('Ordem de compra %s criada automaticamente', po_name), '{}'::jsonb);
              END IF;
              INSERT INTO public.purchase_order_origins(po_id, sale_order_id) VALUES(po_id,_order) ON CONFLICT DO NOTHING;
              INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              SELECT po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0),
                     shortage * COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0);
              UPDATE public.purchase_orders po SET
                amount_untaxed = (SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id = po.id),
                amount_total = (SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id = po.id) + COALESCE(po.amount_tax,0)
              WHERE po.id = po_id;
            END IF;
          END IF;
        END IF;
      END;
    END LOOP;
    UPDATE public.sale_orders SET state='confirmed' WHERE id = _order;
    PERFORM public.seed_default_schedule(_order);
    PERFORM public.recalc_payment_status(_order);
    PERFORM public.recalc_so_fulfillment(_order);
    PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, cadeia de transferências (%s) criada', wh_mode), '{}'::jsonb);
    IF o.salesperson_id IS NOT NULL THEN
      PERFORM public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
        format('%s para %s', o.name, (SELECT name FROM public.partners WHERE id=o.partner_id)), '/sales/orders');
    END IF;
    RETURN;
  END IF;

  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();
  picking_name := public.next_sequence('picking_out');
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by, step_label)
  VALUES(picking_name,'outgoing'::picking_kind,'draft'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid(),'Entrega (Stock → Cliente)')
  RETURNING id INTO v_picking_id;

  FOR l IN SELECT * FROM public.sale_order_lines WHERE order_id = _order AND line_kind = 'product' LOOP
    SELECT id INTO phantom_bom FROM public.boms WHERE product_id = l.product_id AND type='phantom' AND active LIMIT 1;
    IF phantom_bom IS NOT NULL THEN
      FOR comp IN SELECT * FROM public.bom_lines WHERE bom_id = phantom_bom LOOP
        INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
        VALUES (v_picking_id, comp.component_product_id, comp.component_variant_id, comp.uom_id, src, dst,
                comp.quantity * l.quantity, 'draft'::picking_state, o.name);
      END LOOP;
    ELSE
      INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
      VALUES (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft'::picking_state, o.name);
    END IF;
  END LOOP;

  UPDATE public.stock_pickings SET state='waiting'::picking_state WHERE id = v_picking_id;
  FOR l IN SELECT sm.* FROM public.stock_moves sm WHERE sm.picking_id = v_picking_id LOOP
    DECLARE reserved numeric;
    BEGIN
      reserved := public.reserve_for_move(l.id);
      IF reserved < l.quantity THEN
        shortage := l.quantity - reserved;
        SELECT can_be_purchased, auto_purchase INTO prod FROM public.products WHERE id = l.product_id;
        IF public.is_module_installed('purchase') AND COALESCE(prod.can_be_purchased, true) AND COALESCE(prod.auto_purchase, true) THEN
          SELECT partner_id INTO pref_supplier FROM public.product_suppliers WHERE product_id = l.product_id ORDER BY priority LIMIT 1;
          IF pref_supplier IS NOT NULL THEN
            SELECT id INTO po_id FROM public.purchase_orders
            WHERE partner_id = pref_supplier AND state='draft' AND warehouse_id = wh AND origin = o.name
            ORDER BY created_at DESC LIMIT 1;
            IF po_id IS NULL THEN
              po_name := public.next_sequence('purchase_order');
              expected := current_date + COALESCE((SELECT min(lead_time_days) FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier),7);
              INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
              VALUES(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) RETURNING id INTO po_id;
              INSERT INTO public.module_events(source_module, event_type, payload)
              VALUES('purchase','auto_po_created', jsonb_build_object('po_id', po_id, 'so_id', _order, 'partner_id', pref_supplier));
              PERFORM public.log_record_event('sale_order', _order,
                format('Ordem de compra %s criada automaticamente', po_name), '{}'::jsonb);
            END IF;
            INSERT INTO public.purchase_order_origins(po_id, sale_order_id)
            VALUES(po_id, _order) ON CONFLICT DO NOTHING;
            INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
            SELECT po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                   COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0),
                   shortage * COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0);
            UPDATE public.purchase_orders po SET
              amount_untaxed = (SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id = po.id),
              amount_total = (SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id = po.id) + COALESCE(po.amount_tax,0)
            WHERE po.id = po_id;
          END IF;
        END IF;
      END IF;
    END;
  END LOOP;

  UPDATE public.sale_orders SET state='confirmed' WHERE id = _order;
  PERFORM public.seed_default_schedule(_order);
  PERFORM public.recalc_payment_status(_order);
  PERFORM public.recalc_so_fulfillment(_order);
  PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
  IF o.salesperson_id IS NOT NULL THEN
    PERFORM public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (SELECT name FROM public.partners WHERE id=o.partner_id)), '/sales/orders');
  END IF;
END $$;