CREATE OR REPLACE FUNCTION public.assert_lines_have_variant(_table text, _order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  missing_name text;
BEGIN
  IF _table = 'sale_order_lines' THEN
    SELECT p.name INTO missing_name
    FROM public.sale_order_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.order_id = _order
      AND l.variant_id IS NULL
      AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = l.product_id AND pv.active)
    LIMIT 1;
  ELSE
    SELECT p.name INTO missing_name
    FROM public.purchase_order_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.order_id = _order
      AND l.variant_id IS NULL
      AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = l.product_id AND pv.active)
    LIMIT 1;
  END IF;

  IF missing_name IS NOT NULL THEN
    RAISE EXCEPTION 'O produto "%" tem variantes; selecione a variante na linha antes de confirmar', missing_name
      USING ERRCODE='check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o record; l record; wh uuid;
  v_picking_id uuid;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  prod record; use_chain boolean;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.state <> 'draft' AND o.state <> 'sent' THEN RAISE EXCEPTION 'Order must be draft/sent'; END IF;

  PERFORM public.assert_so_has_lines(_order);
  PERFORM public.assert_lines_have_variant('sale_order_lines', _order);

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  use_chain := COALESCE(o.delivery_mode,'delivery') IN ('delivery','pickup');

  IF use_chain THEN
    v_picking_id := public.create_outgoing_chain(_order);
    FOR l IN
      SELECT sm.* FROM public.stock_moves sm
      JOIN public.stock_pickings sp ON sp.id=sm.picking_id
      WHERE sp.origin=o.name AND sp.kind='outgoing'
        AND sm.source_location_id = public.default_location(wh,'Stock')
    LOOP
      DECLARE reserved numeric;
      BEGIN
        reserved := public.reserve_for_move(l.id);
        IF reserved < l.quantity THEN
          shortage := l.quantity - reserved;
          SELECT can_be_purchased, auto_purchase INTO prod FROM public.products WHERE id=l.product_id;
          IF public.is_module_installed('purchase') AND COALESCE(prod.can_be_purchased,true) AND COALESCE(prod.auto_purchase,true) THEN
            SELECT partner_id INTO pref_supplier FROM public.product_suppliers WHERE product_id=l.product_id ORDER BY priority LIMIT 1;
            IF pref_supplier IS NOT NULL THEN
              po_name := public.next_sequence('purchase_order');
              expected := (now() + interval '7 days')::date;
              INSERT INTO public.purchase_orders(name, state, partner_id, warehouse_id, expected_date, origin, created_by, buyer_id)
                VALUES(po_name,'draft', pref_supplier, wh, expected, o.name, auth.uid(), auth.uid())
                RETURNING id INTO po_id;
              INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
                VALUES(po_id, l.product_id, l.variant_id, l.uom_id, shortage, 0, 0);
              INSERT INTO public.purchase_order_origins(po_id, sale_order_id) VALUES (po_id, _order) ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  UPDATE public.sale_orders SET state='confirmed' WHERE id=_order;
  PERFORM public.log_record_event('sale_order',_order,'Pedido confirmado','{}'::jsonb);
  IF o.salesperson_id IS NOT NULL THEN
    PERFORM public.notify_user(o.salesperson_id,'sales','so_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (SELECT name FROM public.partners WHERE id=o.partner_id)),'/sales/orders');
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.confirm_purchase_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text; reception_mode text; so_id uuid; line_count int;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF o.state NOT IN ('draft','rfq_sent') THEN RAISE EXCEPTION 'PO must be draft/rfq'; END IF;

  SELECT COUNT(*) INTO line_count FROM public.purchase_order_lines WHERE order_id=_order AND COALESCE(quantity,0) > 0;
  IF line_count = 0 THEN
    RAISE EXCEPTION 'A compra não tem linhas com quantidade > 0; adicione produtos antes de confirmar' USING ERRCODE='check_violation';
  END IF;

  PERFORM public.assert_lines_have_variant('purchase_order_lines', _order);

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  SELECT COALESCE(reception_steps,'one_step') INTO reception_mode FROM public.warehouses WHERE id=wh;
  src := public.supplier_location_id();
  dst := CASE WHEN reception_mode='one_step' THEN public.default_location(wh,'Stock') ELSE public.default_location(wh,'Recebimento') END;

  picking_name := public.next_sequence('picking_in');
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by, scheduled_at, step_label)
  VALUES (picking_name,'incoming'::picking_kind,'ready'::picking_state, wh, src, dst, o.partner_id, o.name, auth.uid(), COALESCE(o.expected_date::timestamptz, now()),
    CASE WHEN reception_mode='one_step' THEN 'Receção (Fornecedor → Stock)' ELSE 'Receção (Fornecedor → Recebimento)' END)
  RETURNING id INTO v_picking_id;

  FOR l IN SELECT * FROM public.purchase_order_lines WHERE order_id=_order AND COALESCE(quantity,0) > 0 LOOP
    INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
    VALUES (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'ready'::picking_state, o.name);
  END LOOP;

  UPDATE public.purchase_orders SET state='confirmed' WHERE id=_order;
  PERFORM public.log_record_event('purchase_order',_order, format('Compra confirmada, recebimento %s criado', picking_name),'{}'::jsonb);
  IF o.buyer_id IS NOT NULL THEN
    PERFORM public.notify_user(o.buyer_id,'purchase','po_confirmed','Compra confirmada',
      format('%s para %s', o.name,(SELECT name FROM public.partners WHERE id=o.partner_id)),'/purchase/orders');
  END IF;

  FOR so_id IN
    SELECT DISTINCT s.id FROM public.sale_orders s
    LEFT JOIN public.purchase_order_origins poo ON poo.sale_order_id=s.id AND poo.po_id=_order
    WHERE poo.sale_order_id IS NOT NULL OR s.name=o.origin
  LOOP PERFORM public.recalc_so_fulfillment(so_id); END LOOP;
END $function$;