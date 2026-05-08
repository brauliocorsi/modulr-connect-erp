
-- Product fees
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS assembly_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_surcharge numeric NOT NULL DEFAULT 0;

-- Sale order toggles
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS include_assembly boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_zone_label text;

-- Line kind & make product_id nullable for service lines
ALTER TABLE public.sale_order_lines
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'product';

ALTER TABLE public.sale_order_lines
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.sale_order_lines
  DROP CONSTRAINT IF EXISTS sale_order_lines_kind_check;
ALTER TABLE public.sale_order_lines
  ADD CONSTRAINT sale_order_lines_kind_check
  CHECK (line_kind IN ('product','delivery','assembly'));

-- Delivery rule tables
CREATE TABLE IF NOT EXISTS public.delivery_zip_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text,
  zip_from text NOT NULL,
  zip_to text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_delivery_zip_rules_updated BEFORE UPDATE ON public.delivery_zip_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.delivery_region_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  country text NOT NULL DEFAULT 'PT',
  price numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_delivery_region_rules_updated BEFORE UPDATE ON public.delivery_region_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.delivery_zip_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_region_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_zip_rules_view" ON public.delivery_zip_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "delivery_zip_rules_insert" ON public.delivery_zip_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'sales'::app_module,'orders','edit'));
CREATE POLICY "delivery_zip_rules_update" ON public.delivery_zip_rules FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'sales'::app_module,'orders','edit'));
CREATE POLICY "delivery_zip_rules_delete" ON public.delivery_zip_rules FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(),'sales'::app_module,'orders','delete'));

CREATE POLICY "delivery_region_rules_view" ON public.delivery_region_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "delivery_region_rules_insert" ON public.delivery_region_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'sales'::app_module,'orders','edit'));
CREATE POLICY "delivery_region_rules_update" ON public.delivery_region_rules FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'sales'::app_module,'orders','edit'));
CREATE POLICY "delivery_region_rules_delete" ON public.delivery_region_rules FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(),'sales'::app_module,'orders','delete'));

-- Calculate delivery base price for partner
CREATE OR REPLACE FUNCTION public.calc_delivery_price(_partner uuid)
RETURNS TABLE(price numeric, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; pref text; r record;
BEGIN
  SELECT zip, state, country INTO p FROM public.partners WHERE id = _partner;
  IF NOT FOUND THEN RETURN; END IF;
  pref := regexp_replace(COALESCE(p.zip,''), '[^0-9]', '', 'g');
  IF length(pref) >= 4 THEN
    pref := substring(pref from 1 for 4);
    SELECT * INTO r FROM public.delivery_zip_rules
      WHERE active AND pref BETWEEN zip_from AND zip_to
      ORDER BY (zip_to::int - zip_from::int) ASC LIMIT 1;
    IF FOUND THEN
      price := r.price; label := COALESCE(r.label, r.zip_from || '-' || r.zip_to);
      RETURN NEXT; RETURN;
    END IF;
  END IF;
  IF p.state IS NOT NULL THEN
    SELECT * INTO r FROM public.delivery_region_rules
      WHERE active AND lower(region) = lower(p.state) AND country = COALESCE(p.country,'PT')
      LIMIT 1;
    IF FOUND THEN
      price := r.price; label := r.region;
      RETURN NEXT; RETURN;
    END IF;
  END IF;
  price := 0; label := NULL;
  RETURN NEXT;
END $$;

-- Refresh service lines (assembly + delivery) for a sale order
CREATE OR REPLACE FUNCTION public.refresh_order_services(_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record;
  asm_total numeric := 0;
  surcharge numeric := 0;
  base_price numeric := 0;
  zone_label text;
  total_delivery numeric := 0;
  untaxed numeric;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RETURN; END IF;

  -- Remove existing service lines
  DELETE FROM public.sale_order_lines WHERE order_id = _order AND line_kind IN ('assembly','delivery');

  IF o.include_assembly THEN
    SELECT COALESCE(SUM(sol.quantity * COALESCE(p.assembly_fee,0)), 0)
      INTO asm_total
      FROM public.sale_order_lines sol
      JOIN public.products p ON p.id = sol.product_id
      WHERE sol.order_id = _order AND sol.line_kind = 'product';
    IF asm_total > 0 THEN
      INSERT INTO public.sale_order_lines(order_id, line_kind, description, quantity, unit_price, subtotal, sequence)
      VALUES (_order, 'assembly', 'Serviço de montagem', 1, asm_total, asm_total, 9000);
    END IF;
  END IF;

  IF o.include_delivery THEN
    SELECT COALESCE(SUM(sol.quantity * COALESCE(p.delivery_surcharge,0)), 0)
      INTO surcharge
      FROM public.sale_order_lines sol
      JOIN public.products p ON p.id = sol.product_id
      WHERE sol.order_id = _order AND sol.line_kind = 'product';
    SELECT cdp.price, cdp.label INTO base_price, zone_label
      FROM public.calc_delivery_price(o.partner_id) cdp;
    base_price := COALESCE(base_price, 0);
    total_delivery := base_price + surcharge;
    UPDATE public.sale_orders SET delivery_zone_label = zone_label WHERE id = _order;
    IF total_delivery > 0 THEN
      INSERT INTO public.sale_order_lines(order_id, line_kind, description, quantity, unit_price, subtotal, sequence)
      VALUES (_order, 'delivery',
              'Entrega' || CASE WHEN zone_label IS NOT NULL THEN ' — ' || zone_label ELSE '' END,
              1, total_delivery, total_delivery, 9100);
    END IF;
  ELSE
    UPDATE public.sale_orders SET delivery_zone_label = NULL WHERE id = _order;
  END IF;

  -- Recalc order totals
  SELECT COALESCE(SUM(subtotal),0) INTO untaxed FROM public.sale_order_lines WHERE order_id = _order;
  UPDATE public.sale_orders
     SET amount_untaxed = untaxed,
         amount_total = untaxed + COALESCE(amount_tax,0)
   WHERE id = _order;
END $$;

-- Skip service lines when confirming sale order (recreate function)
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
            select id into po_id from public.purchase_orders
              where partner_id = pref_supplier and state='draft' and warehouse_id = wh and origin = o.name
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
  perform public.seed_default_schedule(_order);
  perform public.recalc_payment_status(_order);
  perform public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
  if o.salesperson_id is not null then
    perform public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (select name from public.partners where id=o.partner_id)), '/sales/orders');
  end if;
end $function$;
