-- Track which sale order originated each purchase order line
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS source_sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pol_source_so ON public.purchase_order_lines(source_sale_order_id);

-- Backfill existing lines from the parent PO origin (if it matches a SO name)
UPDATE public.purchase_order_lines pol
   SET source_sale_order_id = so.id
  FROM public.purchase_orders po
  JOIN public.sale_orders so ON so.name = po.origin
 WHERE pol.order_id = po.id
   AND pol.source_sale_order_id IS NULL;

-- Update confirm_sale_order to populate source_sale_order_id on auto-generated PO lines
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
              INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal, source_sale_order_id)
                VALUES(po_id, l.product_id, l.variant_id, l.uom_id, shortage, 0, 0, _order);
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

-- Update merge_purchase_orders so each line keeps its source_sale_order_id.
-- Lines from different sale orders are NEVER merged together (so the user can see the origin per row).
CREATE OR REPLACE FUNCTION public.merge_purchase_orders(_target uuid, _sources uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t record;
  s record;
  l record;
  src_so uuid;
  existing_line uuid;
  untaxed numeric;
BEGIN
  SELECT * INTO t FROM public.purchase_orders WHERE id = _target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido destino não encontrado'; END IF;
  IF t.state <> 'draft' THEN RAISE EXCEPTION 'Apenas pedidos em rascunho podem ser fundidos'; END IF;

  FOR s IN SELECT * FROM public.purchase_orders WHERE id = ANY(_sources) AND id <> _target LOOP
    IF s.state <> 'draft' THEN
      RAISE EXCEPTION 'Pedido % não está em rascunho', s.name;
    END IF;
    IF s.partner_id <> t.partner_id THEN
      RAISE EXCEPTION 'Fornecedores diferentes — não é possível agrupar';
    END IF;
    IF COALESCE(s.warehouse_id::text,'') <> COALESCE(t.warehouse_id::text,'') THEN
      RAISE EXCEPTION 'Armazéns diferentes — não é possível agrupar';
    END IF;

    -- Backfill source on source PO lines from its origin if missing
    SELECT id INTO src_so FROM public.sale_orders WHERE name = s.origin;
    IF src_so IS NOT NULL THEN
      UPDATE public.purchase_order_lines
         SET source_sale_order_id = src_so
       WHERE order_id = s.id AND source_sale_order_id IS NULL;
    END IF;

    -- Move/merge lines: only collapse when same product/variant/price AND same source SO
    FOR l IN SELECT * FROM public.purchase_order_lines WHERE order_id = s.id LOOP
      SELECT id INTO existing_line FROM public.purchase_order_lines
        WHERE order_id = _target
          AND product_id = l.product_id
          AND COALESCE(variant_id::text,'') = COALESCE(l.variant_id::text,'')
          AND unit_price = l.unit_price
          AND COALESCE(source_sale_order_id::text,'') = COALESCE(l.source_sale_order_id::text,'')
        LIMIT 1;
      IF existing_line IS NOT NULL THEN
        UPDATE public.purchase_order_lines
           SET quantity = quantity + l.quantity,
               subtotal = (quantity + l.quantity) * unit_price
         WHERE id = existing_line;
      ELSE
        INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, description, quantity, uom_id, unit_price, tax_pct, subtotal, sequence, source_sale_order_id)
          VALUES(_target, l.product_id, l.variant_id, l.description, l.quantity, l.uom_id, l.unit_price, l.tax_pct, l.subtotal, l.sequence, l.source_sale_order_id);
      END IF;
    END LOOP;

    -- Copy origins (merge)
    INSERT INTO public.purchase_order_origins(po_id, sale_order_id)
      SELECT _target, sale_order_id FROM public.purchase_order_origins WHERE po_id = s.id
    ON CONFLICT DO NOTHING;
    IF s.origin IS NOT NULL THEN
      INSERT INTO public.purchase_order_origins(po_id, sale_order_id)
        SELECT _target, so.id FROM public.sale_orders so WHERE so.name = s.origin
      ON CONFLICT DO NOTHING;
    END IF;

    PERFORM public.log_record_event('purchase_order', _target,
      format('Pedido %s fundido neste pedido', s.name), '{}'::jsonb);

    DELETE FROM public.purchase_orders WHERE id = s.id;
  END LOOP;

  -- Recalc totals
  SELECT COALESCE(SUM(subtotal),0) INTO untaxed FROM public.purchase_order_lines WHERE order_id = _target;
  UPDATE public.purchase_orders
     SET amount_untaxed = untaxed,
         amount_total = untaxed + COALESCE(amount_tax,0)
   WHERE id = _target;
END $function$;