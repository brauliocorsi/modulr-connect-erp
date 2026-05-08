
-- Tables
CREATE TABLE IF NOT EXISTS public.account_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'cash',
  currency text NOT NULL DEFAULT 'EUR',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  default_journal_id uuid REFERENCES public.account_journals(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 10,
  label text NOT NULL DEFAULT 'Parcela',
  due_kind text NOT NULL DEFAULT 'on_delivery',
  due_date date,
  due_days integer,
  percent numeric NOT NULL DEFAULT 100,
  amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sps_order ON public.sale_payment_schedules(order_id);

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_id uuid REFERENCES public.partners(id),
  order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES public.sale_payment_schedules(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL CHECK (amount > 0),
  method_id uuid REFERENCES public.payment_methods(id),
  journal_id uuid REFERENCES public.account_journals(id),
  reference text,
  notes text,
  state text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cp_order ON public.customer_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_cp_date ON public.customer_payments(payment_date);

ALTER TABLE public.sale_orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

INSERT INTO public.number_sequences(code, prefix, padding, next_number)
VALUES ('customer_payment', 'PAY/', 5, 1)
ON CONFLICT (code) DO NOTHING;

-- Functions
CREATE OR REPLACE FUNCTION public.recalc_payment_status(_so uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total numeric; paid numeric; status text; has_deposit_done boolean;
BEGIN
  SELECT amount_total INTO total FROM public.sale_orders WHERE id = _so;
  IF total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.customer_payments
   WHERE order_id = _so AND state = 'posted';
  SELECT EXISTS(SELECT 1 FROM public.sale_payment_schedules
   WHERE order_id = _so AND state='paid' AND due_kind='on_confirm') INTO has_deposit_done;
  IF total = 0 OR paid = 0 THEN status := 'unpaid';
  ELSIF paid >= total THEN status := CASE WHEN paid > total THEN 'overpaid' ELSE 'paid' END;
  ELSIF has_deposit_done THEN status := 'deposit_paid';
  ELSE status := 'partial'; END IF;
  UPDATE public.sale_orders SET payment_status = status WHERE id = _so;
END $$;

CREATE OR REPLACE FUNCTION public.allocate_payment_to_schedules(_so uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paid_total numeric; s record; remaining numeric; apply numeric;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO paid_total FROM public.customer_payments
   WHERE order_id = _so AND state='posted';
  UPDATE public.sale_payment_schedules SET paid_amount=0, state='pending' WHERE order_id = _so;
  remaining := paid_total;
  FOR s IN SELECT * FROM public.sale_payment_schedules WHERE order_id = _so ORDER BY sequence, created_at LOOP
    EXIT WHEN remaining <= 0;
    apply := LEAST(remaining, s.amount);
    UPDATE public.sale_payment_schedules
     SET paid_amount = apply,
         state = CASE WHEN apply >= s.amount THEN 'paid' WHEN apply > 0 THEN 'partial' ELSE 'pending' END
     WHERE id = s.id;
    remaining := remaining - apply;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tg_payment_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE so uuid;
BEGIN
  so := COALESCE(NEW.order_id, OLD.order_id);
  IF so IS NOT NULL THEN
    PERFORM public.allocate_payment_to_schedules(so);
    PERFORM public.recalc_payment_status(so);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_payment_after_change ON public.customer_payments;
CREATE TRIGGER trg_payment_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_after_change();

CREATE OR REPLACE FUNCTION public.seed_default_schedule(_so uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total numeric; existing int;
BEGIN
  SELECT amount_total INTO total FROM public.sale_orders WHERE id = _so;
  IF total IS NULL OR total <= 0 THEN RETURN; END IF;
  SELECT COUNT(*) INTO existing FROM public.sale_payment_schedules WHERE order_id = _so;
  IF existing > 0 THEN
    UPDATE public.sale_payment_schedules
     SET amount = round(total * (percent/100)::numeric, 2) WHERE order_id = _so;
    RETURN;
  END IF;
  INSERT INTO public.sale_payment_schedules(order_id, sequence, label, due_kind, percent, amount)
   VALUES (_so, 10, 'Total na entrega', 'on_delivery', 100, total);
END $$;

-- Patch confirm_sale_order
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  for l in select * from public.sale_order_lines where order_id = _order loop
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

-- Patch recalc_so_fulfillment to detect delivered when all outgoing pickings done
CREATE OR REPLACE FUNCTION public.recalc_so_fulfillment(_so uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; new_status text; out_count int; out_done int; so_name text;
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
  IF out_count > 0 AND out_done = out_count THEN new_status := 'delivered';
  ELSIF r.qty_total = 0 THEN new_status := 'pending';
  ELSIF r.qty_done >= r.qty_total THEN new_status := 'delivered';
  ELSIF r.qty_reserved >= r.qty_total THEN new_status := 'ready';
  ELSIF (r.qty_reserved + r.qty_done) > 0 AND r.qty_incoming > 0 THEN new_status := 'partial';
  ELSIF r.qty_incoming > 0 AND r.po_any_confirmed THEN new_status := 'purchased';
  ELSIF r.qty_incoming > 0 AND r.po_any_draft THEN new_status := 'backordered';
  ELSE new_status := 'pending'; END IF;
  UPDATE public.sale_orders SET fulfillment_status = new_status
   WHERE id = _so AND fulfillment_status IS DISTINCT FROM new_status;
END $function$;

-- RLS
ALTER TABLE public.account_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journals_view" ON public.account_journals FOR SELECT TO authenticated USING (has_permission(auth.uid(),'finance','journals','view'));
CREATE POLICY "journals_insert" ON public.account_journals FOR INSERT TO authenticated WITH CHECK (has_permission(auth.uid(),'finance','journals','create'));
CREATE POLICY "journals_update" ON public.account_journals FOR UPDATE TO authenticated USING (has_permission(auth.uid(),'finance','journals','edit'));
CREATE POLICY "journals_delete" ON public.account_journals FOR DELETE TO authenticated USING (has_permission(auth.uid(),'finance','journals','delete'));

CREATE POLICY "methods_view" ON public.payment_methods FOR SELECT TO authenticated USING (has_permission(auth.uid(),'finance','methods','view'));
CREATE POLICY "methods_insert" ON public.payment_methods FOR INSERT TO authenticated WITH CHECK (has_permission(auth.uid(),'finance','methods','create'));
CREATE POLICY "methods_update" ON public.payment_methods FOR UPDATE TO authenticated USING (has_permission(auth.uid(),'finance','methods','edit'));
CREATE POLICY "methods_delete" ON public.payment_methods FOR DELETE TO authenticated USING (has_permission(auth.uid(),'finance','methods','delete'));

CREATE POLICY "sps_view" ON public.sale_payment_schedules FOR SELECT TO authenticated
 USING (has_permission(auth.uid(),'finance','schedules','view') OR has_permission(auth.uid(),'sales','orders','view'));
CREATE POLICY "sps_insert" ON public.sale_payment_schedules FOR INSERT TO authenticated
 WITH CHECK (has_permission(auth.uid(),'finance','schedules','create') OR has_permission(auth.uid(),'sales','orders','edit'));
CREATE POLICY "sps_update" ON public.sale_payment_schedules FOR UPDATE TO authenticated
 USING (has_permission(auth.uid(),'finance','schedules','edit') OR has_permission(auth.uid(),'sales','orders','edit'));
CREATE POLICY "sps_delete" ON public.sale_payment_schedules FOR DELETE TO authenticated
 USING (has_permission(auth.uid(),'finance','schedules','delete') OR has_permission(auth.uid(),'sales','orders','edit'));

CREATE POLICY "payments_view" ON public.customer_payments FOR SELECT TO authenticated
 USING (has_permission(auth.uid(),'finance','payments','view') OR has_permission(auth.uid(),'sales','orders','view'));
CREATE POLICY "payments_insert" ON public.customer_payments FOR INSERT TO authenticated
 WITH CHECK (has_permission(auth.uid(),'finance','payments','create') OR has_permission(auth.uid(),'sales','orders','edit'));
CREATE POLICY "payments_update" ON public.customer_payments FOR UPDATE TO authenticated
 USING (has_permission(auth.uid(),'finance','payments','edit') OR has_permission(auth.uid(),'sales','orders','edit'));
CREATE POLICY "payments_delete" ON public.customer_payments FOR DELETE TO authenticated
 USING (has_permission(auth.uid(),'finance','payments','delete'));

CREATE TRIGGER trg_aj_updated BEFORE UPDATE ON public.account_journals FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_pm_updated BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
