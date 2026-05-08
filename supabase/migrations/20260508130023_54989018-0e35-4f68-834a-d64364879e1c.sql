
-- 1. Auto-purchase flag on products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS auto_purchase boolean NOT NULL DEFAULT false;

-- 2. Function to set product stock at a warehouse (creates an inventory adjustment trail via direct quant write to Stock location)
CREATE OR REPLACE FUNCTION public.set_product_stock(_product uuid, _warehouse uuid, _qty numeric, _reason text DEFAULT 'Ajuste manual')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loc uuid;
  current_qty numeric;
  diff numeric;
  q record;
BEGIN
  loc := public.default_location(_warehouse, 'Stock');
  IF loc IS NULL THEN RAISE EXCEPTION 'Localização Stock não encontrada para armazém'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO current_qty
    FROM public.stock_quants WHERE product_id = _product AND location_id = loc;
  diff := _qty - current_qty;
  IF diff = 0 THEN RETURN current_qty; END IF;

  IF diff > 0 THEN
    SELECT * INTO q FROM public.stock_quants
      WHERE product_id = _product AND location_id = loc AND lot_id IS NULL LIMIT 1;
    IF FOUND THEN
      UPDATE public.stock_quants SET quantity = quantity + diff, updated_at = now() WHERE id = q.id;
    ELSE
      INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (_product, loc, diff);
    END IF;
  ELSE
    INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (_product, loc, diff);
  END IF;

  PERFORM public.log_record_event('product', _product,
    format('Stock ajustado para %s (Δ %s) — %s', _qty, diff, _reason), '{}'::jsonb);
  RETURN _qty;
END $$;

-- 3. Update confirm_sale_order to honor auto_purchase flag
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record;
  prod_auto boolean;
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

  for l in select * from public.sale_order_lines where order_id = _order loop
    select id into phantom_bom from public.boms
      where product_id = l.product_id and type='phantom' and active limit 1;
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
        select auto_purchase into prod_auto from public.products where id = l.product_id;
        if public.is_module_installed('purchase') and coalesce(prod_auto,false) then
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
              -- queue email event for auto-PO
              insert into public.module_events(source_module, event_type, payload)
                values('purchase','auto_po_created', jsonb_build_object('po_id', po_id, 'so_id', _order, 'partner_id', pref_supplier));
            end if;
            insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                     shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
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
