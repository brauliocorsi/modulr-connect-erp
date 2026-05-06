
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  l record;
  wh uuid;
  src uuid;
  dst uuid;
  v_picking_id uuid;
  picking_name text;
  shortage numeric;
  available numeric;
  pref_supplier uuid;
  po_id uuid;
  po_name text;
  expected date;
begin
  select * into o from public.sale_orders where id = _order;
  if not found then raise exception 'Order not found'; end if;
  if o.state <> 'draft' and o.state <> 'sent' then raise exception 'Order must be draft/sent'; end if;

  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();

  picking_name := public.next_sequence('picking_out');
  insert into public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by)
  values(picking_name,'outgoing','draft',wh,src,dst,o.partner_id,o.name,auth.uid())
  returning id into v_picking_id;

  for l in select * from public.sale_order_lines where order_id = _order loop
    insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
    values (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft', o.name);
  end loop;

  update public.stock_pickings set state='waiting' where id = v_picking_id;

  for l in select * from public.sale_order_lines where order_id = _order loop
    declare mv uuid; reserved numeric;
    begin
      select id into mv from public.stock_moves where stock_moves.picking_id = v_picking_id and stock_moves.product_id = l.product_id limit 1;
      reserved := public.reserve_for_move(mv);
      if reserved < l.quantity then
        shortage := l.quantity - reserved;
        available := public.product_available_qty(l.product_id, wh);
        insert into public.module_events(source_module, event_type, payload)
          values('sales','stock.shortage',
            jsonb_build_object('product_id',l.product_id,'qty',shortage,'sale_order',o.id,'warehouse',wh));
        if public.is_module_installed('purchase') then
          select partner_id into pref_supplier from public.product_suppliers where product_id = l.product_id order by priority limit 1;
          if pref_supplier is not null then
            select id into po_id from public.purchase_orders
              where partner_id = pref_supplier and state='draft' and warehouse_id = wh
              order by created_at desc limit 1;
            if po_id is null then
              po_name := public.next_sequence('purchase_order');
              expected := current_date + coalesce((select min(lead_time_days) from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier),7);
              insert into public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
                values(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) returning id into po_id;
            end if;
            insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                     shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
            perform public.log_record_event('sale_order', o.id,
              format('RFQ %s gerada automaticamente para falta de stock', po_name), '{}'::jsonb);
          end if;
        end if;
      end if;
    end;
  end loop;

  update public.sale_orders set state='confirmed' where id = _order;
  perform public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
  if o.salesperson_id is not null then
    perform public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (select name from public.partners where id=o.partner_id)), '/sales/orders');
  end if;
end $function$;
