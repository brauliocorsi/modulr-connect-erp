
-- 1. Origins table
CREATE TABLE IF NOT EXISTS public.purchase_order_origins (
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (po_id, sale_order_id)
);
CREATE INDEX IF NOT EXISTS idx_poo_so ON public.purchase_order_origins(sale_order_id);

ALTER TABLE public.purchase_order_origins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poo_read" ON public.purchase_order_origins
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "poo_write" ON public.purchase_order_origins
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Backfill from existing origin text
INSERT INTO public.purchase_order_origins (po_id, sale_order_id)
SELECT po.id, so.id
FROM public.purchase_orders po
JOIN public.sale_orders so ON so.name = po.origin
ON CONFLICT DO NOTHING;

-- 2. Trigger to mark PO done on receipt validation
CREATE OR REPLACE FUNCTION public.tg_po_done_on_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'incoming' AND NEW.state = 'done'
     AND COALESCE(OLD.state::text,'') <> 'done'
     AND NEW.origin IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET state = 'done'
     WHERE name = NEW.origin
       AND state IN ('confirmed','rfq_sent');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_po_done_on_receipt ON public.stock_pickings;
CREATE TRIGGER trg_po_done_on_receipt
AFTER UPDATE ON public.stock_pickings
FOR EACH ROW EXECUTE FUNCTION public.tg_po_done_on_receipt();

-- 3. Merge function
CREATE OR REPLACE FUNCTION public.merge_purchase_orders(_target uuid, _sources uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  s record;
  l record;
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

    -- Move/merge lines
    FOR l IN SELECT * FROM public.purchase_order_lines WHERE order_id = s.id LOOP
      SELECT id INTO existing_line FROM public.purchase_order_lines
        WHERE order_id = _target
          AND product_id = l.product_id
          AND COALESCE(variant_id::text,'') = COALESCE(l.variant_id::text,'')
          AND unit_price = l.unit_price
        LIMIT 1;
      IF existing_line IS NOT NULL THEN
        UPDATE public.purchase_order_lines
           SET quantity = quantity + l.quantity,
               subtotal = (quantity + l.quantity) * unit_price
         WHERE id = existing_line;
      ELSE
        INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, description, quantity, uom_id, unit_price, tax_pct, subtotal, sequence)
          VALUES(_target, l.product_id, l.variant_id, l.description, l.quantity, l.uom_id, l.unit_price, l.tax_pct, l.subtotal, l.sequence);
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
END $$;

-- 4. Update confirm_sale_order: don't filter by origin when finding draft PO; populate origins table
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record; prod record;
begin
  select * into o from public.sale_orders where id = _order;
  if not found then raise exception 'Order not found'; end if;
  if o.state <> 'draft' and o.state <> 'sent' then raise exception 'Order must be draft/sent'; end if;
  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();
  picking_name := public.next_sequence('picking_out');
  insert into public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by)
  values(picking_name,'outgoing'::picking_kind,'draft'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid())
  returning id into v_picking_id;
  for l in select * from public.sale_order_lines where order_id = _order and line_kind = 'product' loop
    select id into phantom_bom from public.boms where product_id = l.product_id and type='phantom' and active limit 1;
    if phantom_bom is not null then
      for comp in select * from public.bom_lines where bom_id = phantom_bom loop
        insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
        values (v_picking_id, comp.component_product_id, comp.component_variant_id, comp.uom_id, src, dst,
                comp.quantity * l.quantity, 'draft'::picking_state, o.name);
      end loop;
    else
      insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
      values (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft'::picking_state, o.name);
    end if;
  end loop;
  update public.stock_pickings set state='waiting'::picking_state where id = v_picking_id;
  for l in select sm.* from public.stock_moves sm where sm.picking_id = v_picking_id loop
    declare reserved numeric;
    begin
      reserved := public.reserve_for_move(l.id);
      if reserved < l.quantity then
        shortage := l.quantity - reserved;
        select can_be_purchased, auto_purchase into prod from public.products where id = l.product_id;
        if public.is_module_installed('purchase') and coalesce(prod.can_be_purchased, true) then
          select partner_id into pref_supplier from public.product_suppliers where product_id = l.product_id order by priority limit 1;
          if pref_supplier is not null then
            -- Reuse any draft PO for same supplier+warehouse (group across sales)
            select id into po_id from public.purchase_orders
              where partner_id = pref_supplier and state='draft' and warehouse_id = wh
              order by created_at desc limit 1;
            if po_id is null then
              po_name := public.next_sequence('purchase_order');
              expected := current_date + coalesce((select min(lead_time_days) from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier),7);
              insert into public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
                values(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) returning id into po_id;
              insert into public.module_events(source_module, event_type, payload)
                values('purchase','auto_po_created', jsonb_build_object('po_id', po_id, 'so_id', _order, 'partner_id', pref_supplier));
              perform public.log_record_event('sale_order', _order,
                format('Ordem de compra %s criada automaticamente para repor %s', po_name, l.product_id), '{}'::jsonb);
            else
              perform public.log_record_event('sale_order', _order,
                format('Linha adicionada a pedido de compra existente para repor %s', l.product_id), '{}'::jsonb);
            end if;
            -- Track origin
            insert into public.purchase_order_origins(po_id, sale_order_id)
              values(po_id, _order) on conflict do nothing;
            insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                     shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
            -- Recalc totals on PO
            update public.purchase_orders po set
              amount_untaxed = (select coalesce(sum(subtotal),0) from public.purchase_order_lines where order_id = po.id),
              amount_total = (select coalesce(sum(subtotal),0) from public.purchase_order_lines where order_id = po.id) + coalesce(po.amount_tax,0)
              where po.id = po_id;
          end if;
        end if;
      end if;
    end;
  end loop;
  update public.sale_orders set state='confirmed' where id = _order;
  perform public.seed_default_schedule(_order);
  perform public.recalc_payment_status(_order);
  perform public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
  if o.salesperson_id is not null then
    perform public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (select name from public.partners where id=o.partner_id)), '/sales/orders');
  end if;
end $function$;
