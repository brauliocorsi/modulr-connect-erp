
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record; prod record;
  wh_mode text;
begin
  select * into o from public.sale_orders where id = _order;
  if not found then raise exception 'Order not found'; end if;
  if o.state <> 'draft' and o.state <> 'sent' then raise exception 'Order must be draft/sent'; end if;
  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  select coalesce(delivery_steps,'one_step') into wh_mode from public.warehouses where id=wh;

  if wh_mode <> 'one_step' then
    -- Multi-step chain: build pickings, then run reservation/PO logic on first picking moves
    v_picking_id := public.create_outgoing_chain(_order);
    -- Try to reserve every move in every chained picking; first one feeds the rest
    for l in select sm.* from public.stock_moves sm
             join public.stock_pickings sp on sp.id = sm.picking_id
             where sp.origin = o.name and sp.kind='outgoing'
             and sm.source_location_id = public.default_location(wh,'Stock') loop
      declare reserved numeric;
      begin
        reserved := public.reserve_for_move(l.id);
        if reserved < l.quantity then
          shortage := l.quantity - reserved;
          select can_be_purchased, auto_purchase into prod from public.products where id = l.product_id;
          if public.is_module_installed('purchase') and coalesce(prod.can_be_purchased, true) then
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
              insert into public.purchase_order_origins(po_id, sale_order_id) values(po_id,_order) on conflict do nothing;
              insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
                select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                       coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                       shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
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
    perform public.log_record_event('sale_order', _order, format('Pedido confirmado, cadeia de transferências (%s) criada', wh_mode), '{}'::jsonb);
    if o.salesperson_id is not null then
      perform public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
        format('%s para %s', o.name, (select name from public.partners where id=o.partner_id)), '/sales/orders');
    end if;
    return;
  end if;

  -- one_step (legacy path) ---------------------------------------------
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
            insert into public.purchase_order_origins(po_id, sale_order_id)
              values(po_id, _order) on conflict do nothing;
            insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                     shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
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
end $$;
