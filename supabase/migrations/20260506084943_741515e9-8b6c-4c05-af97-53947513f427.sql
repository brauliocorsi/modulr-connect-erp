
-- ========== sequences for human-friendly numbering ==========
create table if not exists public.number_sequences (
  code text primary key,
  prefix text not null,
  padding int not null default 5,
  next_number bigint not null default 1
);
alter table public.number_sequences enable row level security;
create policy "seq_read" on public.number_sequences for select to authenticated using (true);
create policy "seq_admin" on public.number_sequences for all to authenticated
  using (public.has_group(auth.uid(),'system_admin')) with check (public.has_group(auth.uid(),'system_admin'));

insert into public.number_sequences(code, prefix, padding) values
  ('sale_order','SO',5),
  ('purchase_order','PO',5),
  ('picking_in','WH/IN/',5),
  ('picking_out','WH/OUT/',5),
  ('picking_int','WH/INT/',5),
  ('inventory_adj','INV/ADJ/',5)
on conflict do nothing;

create or replace function public.next_sequence(_code text)
returns text language plpgsql security definer set search_path=public as $$
declare r record; out text;
begin
  update public.number_sequences set next_number = next_number + 1
   where code = _code returning prefix, padding, next_number-1 as n into r;
  if not found then raise exception 'Sequence % not found', _code; end if;
  out := r.prefix || lpad(r.n::text, r.padding, '0');
  return out;
end $$;

-- ========== chatter log helper ==========
create or replace function public.log_record_event(_record_type text, _record_id uuid, _body text, _payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.record_messages(record_type, record_id, author_id, kind, body, payload)
  values(_record_type, _record_id, auth.uid(), 'log', _body, _payload);
end $$;

-- ========== notify users helper ==========
create or replace function public.notify_user(_user uuid, _module app_module, _type text, _title text, _body text, _link text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id, module, type, title, body, link)
  values (_user, _module, _type, _title, _body, _link);
end $$;

-- ========== get default warehouse ==========
create or replace function public.default_warehouse_id()
returns uuid language sql stable as $$
  select id from public.warehouses where active = true order by created_at limit 1;
$$;

create or replace function public.default_location(_warehouse uuid, _name text)
returns uuid language sql stable as $$
  select id from public.stock_locations where warehouse_id = _warehouse and name = _name limit 1;
$$;

create or replace function public.supplier_location_id()
returns uuid language sql stable as $$
  select id from public.stock_locations where type='supplier' order by created_at limit 1;
$$;
create or replace function public.customer_location_id()
returns uuid language sql stable as $$
  select id from public.stock_locations where type='customer' order by created_at limit 1;
$$;

-- ========== compute available qty (on hand - reserved) at internal locs of a warehouse ==========
create or replace function public.product_available_qty(_product uuid, _warehouse uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(q.quantity - q.reserved_quantity),0)
  from public.stock_quants q
  join public.stock_locations l on l.id = q.location_id
  where q.product_id = _product
    and l.type = 'internal'
    and l.warehouse_id = _warehouse;
$$;

-- ========== reserve a quantity for a move ==========
create or replace function public.reserve_for_move(_move uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare
  m record;
  q record;
  remaining numeric;
  take numeric;
  reserved_total numeric := 0;
begin
  select * into m from public.stock_moves where id = _move;
  if not found or m.state in ('done','cancelled') then return 0; end if;

  remaining := m.quantity;
  for q in
    select sq.* from public.stock_quants sq
    join public.stock_locations l on l.id = sq.location_id
    where sq.product_id = m.product_id
      and l.id = m.source_location_id
      and (sq.quantity - sq.reserved_quantity) > 0
    order by sq.updated_at
  loop
    exit when remaining <= 0;
    take := least(remaining, q.quantity - q.reserved_quantity);
    update public.stock_quants set reserved_quantity = reserved_quantity + take, updated_at = now() where id = q.id;
    remaining := remaining - take;
    reserved_total := reserved_total + take;
  end loop;

  update public.stock_moves
     set state = case when reserved_total >= m.quantity then 'ready' else 'waiting' end
   where id = _move;
  return reserved_total;
end $$;

-- ========== validate picking: apply moves to quants ==========
create or replace function public.validate_picking(_picking uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  m record;
  done_qty numeric;
  src record;
  dst_q record;
begin
  for m in select * from public.stock_moves where picking_id = _picking and state <> 'cancelled' loop
    done_qty := coalesce(nullif(m.quantity_done,0), m.quantity);

    -- decrement source (release reservation as we consume)
    declare remaining numeric := done_qty;
    begin
      for src in
        select * from public.stock_quants
        where product_id = m.product_id and location_id = m.source_location_id
        order by updated_at
      loop
        exit when remaining <= 0;
        if src.quantity <= 0 and src.reserved_quantity <= 0 then continue; end if;
        declare take numeric := least(remaining, src.quantity);
        begin
          update public.stock_quants
             set quantity = quantity - take,
                 reserved_quantity = greatest(0, reserved_quantity - take),
                 updated_at = now()
           where id = src.id;
          remaining := remaining - take;
        end;
      end loop;
      -- if source is internal and remaining > 0, allow negative
      if remaining > 0 then
        insert into public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        values (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -remaining);
      end if;
    end;

    -- increment destination
    select * into dst_q from public.stock_quants
      where product_id = m.product_id and location_id = m.destination_location_id and coalesce(lot_id::text,'') = coalesce(m.lot_id::text,'')
      limit 1;
    if found then
      update public.stock_quants set quantity = quantity + done_qty, updated_at=now() where id = dst_q.id;
    else
      insert into public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
      values (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, done_qty);
    end if;

    update public.stock_moves set state='done', quantity_done = done_qty where id = m.id;
  end loop;

  update public.stock_pickings set state='done', done_at=now() where id = _picking;
  perform public.log_record_event('stock_picking', _picking, 'Transferência validada', '{}'::jsonb);
end $$;

-- ========== confirm sale order ==========
create or replace function public.confirm_sale_order(_order uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record;
  l record;
  wh uuid;
  src uuid;
  dst uuid;
  picking_id uuid;
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
  returning id into picking_id;

  for l in select * from public.sale_order_lines where order_id = _order loop
    insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
    values (picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft', o.name);
  end loop;

  update public.stock_pickings set state='waiting' where id = picking_id;

  -- try to reserve, detect shortage, eventually generate purchase
  for l in select * from public.sale_order_lines where order_id = _order loop
    declare mv uuid; reserved numeric;
    begin
      select id into mv from public.stock_moves where picking_id = picking_id and product_id = l.product_id limit 1;
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
end $$;

-- ========== confirm purchase order ==========
create or replace function public.confirm_purchase_order(_order uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record; l record; wh uuid; src uuid; dst uuid; picking_id uuid; picking_name text;
begin
  select * into o from public.purchase_orders where id = _order;
  if not found then raise exception 'PO not found'; end if;
  if o.state not in ('draft','rfq_sent') then raise exception 'PO must be draft/rfq'; end if;

  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  src := public.supplier_location_id();
  dst := public.default_location(wh,'Recebimento');

  picking_name := public.next_sequence('picking_in');
  insert into public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by)
  values(picking_name,'incoming','ready',wh,src,dst,o.partner_id,o.name,auth.uid())
  returning id into picking_id;

  for l in select * from public.purchase_order_lines where order_id = _order loop
    insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
    values (picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity,'ready', o.name);
  end loop;

  update public.purchase_orders set state='confirmed' where id = _order;
  perform public.log_record_event('purchase_order', _order, format('Compra confirmada, recebimento %s criado', picking_name),'{}'::jsonb);
  if o.buyer_id is not null then
    perform public.notify_user(o.buyer_id,'purchase','po_confirmed','Compra confirmada',
      format('%s para %s', o.name,(select name from public.partners where id=o.partner_id)),'/purchase/orders');
  end if;
end $$;

create or replace function public.cancel_sale_order(_order uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.sale_orders set state='cancelled' where id=_order;
  -- cancel related outgoing pickings
  update public.stock_pickings set state='cancelled' where origin = (select name from public.sale_orders where id=_order) and state <> 'done';
  perform public.log_record_event('sale_order',_order,'Pedido cancelado','{}'::jsonb);
end $$;

create or replace function public.cancel_purchase_order(_order uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.purchase_orders set state='cancelled' where id=_order;
  update public.stock_pickings set state='cancelled' where origin = (select name from public.purchase_orders where id=_order) and state <> 'done';
  perform public.log_record_event('purchase_order',_order,'Compra cancelada','{}'::jsonb);
end $$;

-- ========== run reordering rules ==========
create or replace function public.run_reordering_rules()
returns int language plpgsql security definer set search_path=public as $$
declare r record; available numeric; needed numeric; pref uuid; po_id uuid; po_name text; created int := 0;
begin
  if not public.is_module_installed('purchase') then return 0; end if;
  for r in select * from public.reordering_rules where active loop
    available := public.product_available_qty(r.product_id, r.warehouse_id);
    if available < r.min_qty then
      needed := r.max_qty - available;
      if r.multiple_qty > 0 then
        needed := ceil(needed / r.multiple_qty) * r.multiple_qty;
      end if;
      select partner_id into pref from public.product_suppliers where product_id = r.product_id order by priority limit 1;
      if pref is null then continue; end if;
      select id into po_id from public.purchase_orders
        where partner_id = pref and state='draft' and warehouse_id = r.warehouse_id
        order by created_at desc limit 1;
      if po_id is null then
        po_name := public.next_sequence('purchase_order');
        insert into public.purchase_orders(name, partner_id, state, warehouse_id, origin)
          values(po_name, pref, 'draft', r.warehouse_id, 'reordering') returning id into po_id;
        created := created + 1;
      end if;
      insert into public.purchase_order_lines(order_id, product_id, variant_id, quantity, unit_price, subtotal)
        select po_id, r.product_id, r.variant_id, needed,
          coalesce((select price from public.product_suppliers where product_id=r.product_id and partner_id=pref order by priority limit 1),0),
          needed * coalesce((select price from public.product_suppliers where product_id=r.product_id and partner_id=pref order by priority limit 1),0);
    end if;
  end loop;
  return created;
end $$;
