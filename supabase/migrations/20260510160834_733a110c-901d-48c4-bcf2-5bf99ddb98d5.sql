
-- 1) sale_orders.delivery_mode
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'delivery'
  CHECK (delivery_mode IN ('delivery','pickup','direct'));

-- 2) delivery_carriers
CREATE TABLE IF NOT EXISTS public.delivery_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text,
  phone text,
  tracking_url_template text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "carriers_select" ON public.delivery_carriers;
DROP POLICY IF EXISTS "carriers_modify" ON public.delivery_carriers;
CREATE POLICY "carriers_select" ON public.delivery_carriers FOR SELECT TO authenticated USING (true);
CREATE POLICY "carriers_modify" ON public.delivery_carriers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS tg_carriers_updated ON public.delivery_carriers;
CREATE TRIGGER tg_carriers_updated BEFORE UPDATE ON public.delivery_carriers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3) stock_pickings new columns
ALTER TABLE public.stock_pickings
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id),
  ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.delivery_carriers(id),
  ADD COLUMN IF NOT EXISTS tracking_ref text,
  ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_reason text,
  ADD COLUMN IF NOT EXISTS is_reschedule boolean NOT NULL DEFAULT false;

-- 4) Rename Zona Carrinha -> Em Entrega
UPDATE public.stock_locations
   SET name='Em Entrega',
       full_path = regexp_replace(full_path, 'Zona Carrinha$', 'Em Entrega')
 WHERE name='Zona Carrinha';

-- 5) Update create_outgoing_chain to use sale_orders.delivery_mode
CREATE OR REPLACE FUNCTION public.create_outgoing_chain(_order uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  o record; wh uuid; mode text; steps int;
  loc_stock uuid; loc_dock uuid; loc_van uuid; loc_cust uuid;
  prev_pick uuid; first_pick uuid; pick_id uuid;
  l record; phantom_bom uuid; comp record;
  src uuid; dst uuid; nm text; lbl text;
BEGIN
  SELECT * INTO o FROM sale_orders WHERE id=_order;
  wh := coalesce(o.warehouse_id, default_warehouse_id());
  mode := coalesce(o.delivery_mode,'delivery');
  loc_stock := default_location(wh,'Stock');
  loc_cust := customer_location_id();
  loc_dock := ensure_step_location(wh,'Cais de Carga');
  loc_van := ensure_step_location(wh,'Em Entrega');

  steps := CASE mode WHEN 'direct' THEN 1 WHEN 'pickup' THEN 2 ELSE 3 END;

  FOR i IN 1..steps LOOP
    IF mode='direct' THEN
      src := loc_stock; dst := loc_cust; lbl := 'Saída (Stock → Cliente)';
    ELSIF mode='pickup' THEN
      IF i=1 THEN src:=loc_stock; dst:=loc_dock; lbl:='Pick (Stock → Cais)';
      ELSE src:=loc_dock; dst:=loc_cust; lbl:='Levantamento (Cais → Cliente)'; END IF;
    ELSE -- delivery
      IF i=1 THEN src:=loc_stock; dst:=loc_dock; lbl:='Pick (Stock → Cais)';
      ELSIF i=2 THEN src:=loc_dock; dst:=loc_van; lbl:='Carregamento (Cais → Em Entrega)';
      ELSE src:=loc_van; dst:=loc_cust; lbl:='Entrega (Em Entrega → Cliente)'; END IF;
    END IF;
    nm := next_sequence('picking_out');
    INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id,
        destination_location_id, partner_id, origin, created_by, previous_picking_id, step_label)
      VALUES (nm,'outgoing'::picking_kind,'draft'::picking_state, wh, src, dst, o.partner_id,
              o.name, auth.uid(), prev_pick, lbl)
      RETURNING id INTO pick_id;
    IF first_pick IS NULL THEN first_pick := pick_id; END IF;

    FOR l IN SELECT * FROM sale_order_lines WHERE order_id=_order AND line_kind='product' LOOP
      SELECT id INTO phantom_bom FROM boms WHERE product_id=l.product_id AND type='phantom' AND active LIMIT 1;
      IF phantom_bom IS NOT NULL THEN
        FOR comp IN SELECT * FROM bom_lines WHERE bom_id=phantom_bom LOOP
          INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
                  source_location_id, destination_location_id, quantity, state, reference)
            VALUES(pick_id, comp.component_product_id, comp.component_variant_id, comp.uom_id,
                   src, dst, comp.quantity * l.quantity, 'draft'::picking_state, o.name);
        END LOOP;
      ELSE
        INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
                source_location_id, destination_location_id, quantity, state, reference)
          VALUES(pick_id, l.product_id, l.variant_id, l.uom_id, src, dst,
                 l.quantity, 'draft'::picking_state, o.name);
      END IF;
    END LOOP;
    UPDATE stock_pickings SET state='waiting'::picking_state WHERE id=pick_id;
    prev_pick := pick_id;
  END LOOP;

  RETURN first_pick;
END $function$;

-- 6) confirm_sale_order: trigger chain whenever delivery_mode produces > 1 step OR explicit pickup/delivery
-- We adjust the "wh_mode" guard to also use delivery_mode
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record; prod record;
  use_chain boolean;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.state <> 'draft' AND o.state <> 'sent' THEN RAISE EXCEPTION 'Order must be draft/sent'; END IF;

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  use_chain := COALESCE(o.delivery_mode,'delivery') IN ('delivery','pickup');

  IF use_chain THEN
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
    PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, cadeia (%s) criada', o.delivery_mode), '{}'::jsonb);
    IF o.salesperson_id IS NOT NULL THEN
      PERFORM public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
        format('%s para %s', o.name, (SELECT name FROM public.partners WHERE id=o.partner_id)), '/sales/orders');
    END IF;
    RETURN;
  END IF;

  -- direct mode (1 step)
  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();
  picking_name := public.next_sequence('picking_out');
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by, step_label)
  VALUES(picking_name,'outgoing'::picking_kind,'draft'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid(),'Saída (Stock → Cliente)')
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
    PERFORM public.reserve_for_move(l.id);
  END LOOP;

  UPDATE public.sale_orders SET state='confirmed' WHERE id = _order;
  PERFORM public.seed_default_schedule(_order);
  PERFORM public.recalc_payment_status(_order);
  PERFORM public.recalc_so_fulfillment(_order);
  PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
END $function$;

-- 7) reallocate_freed_stock: ORDER BY date_order then created_at
CREATE OR REPLACE FUNCTION public.reallocate_freed_stock(_product uuid, _warehouse uuid, _exclude_so uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  reserved numeric;
  total_reserved numeric := 0;
  affected jsonb := '[]'::jsonb;
  src_so_name text;
BEGIN
  IF _exclude_so IS NOT NULL THEN
    SELECT name INTO src_so_name FROM public.sale_orders WHERE id = _exclude_so;
  END IF;

  FOR m IN
    SELECT sm.id AS move_id, sm.picking_id, sm.quantity, sm.reserved_quantity,
           so.id AS so_id, so.name AS so_name, so.salesperson_id, so.partner_id
    FROM public.stock_moves sm
    JOIN public.stock_pickings sp ON sp.id = sm.picking_id
    JOIN public.sale_orders so ON so.name = sp.origin
    WHERE sm.product_id = _product
      AND sp.kind = 'outgoing'
      AND sp.state NOT IN ('done','cancelled')
      AND sm.state IN ('draft','waiting')
      AND sp.warehouse_id = _warehouse
      AND (_exclude_so IS NULL OR so.id <> _exclude_so)
      AND so.state IN ('confirmed','sent')
      AND so.fulfillment_status IN ('pending','ordered','purchased','partial_available','backordered')
    ORDER BY so.date_order NULLS LAST, so.created_at, sm.created_at
  LOOP
    reserved := public.reserve_for_move(m.move_id);
    IF reserved > 0 THEN
      total_reserved := total_reserved + reserved;
      PERFORM public.recalc_picking_state(m.picking_id);
      PERFORM public.recalc_so_fulfillment(m.so_id);
      affected := affected || jsonb_build_object('so_id', m.so_id, 'so_name', m.so_name, 'qty', reserved);
      IF m.salesperson_id IS NOT NULL THEN
        PERFORM public.notify_user(
          m.salesperson_id, 'sales'::app_module, 'reservation_reallocated',
          'Stock libertado atribuído à sua venda',
          format('A venda %s (mais antiga em espera) recebeu %s unid. libertadas de %s',
                 m.so_name, reserved, COALESCE(src_so_name,'outra venda')),
          '/sales/orders/' || m.so_id);
      END IF;
    END IF;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.stock_quants q
      JOIN public.stock_locations l ON l.id = q.location_id
      WHERE q.product_id = _product AND l.warehouse_id = _warehouse
        AND (q.quantity - q.reserved_quantity) > 0
    );
  END LOOP;

  RETURN jsonb_build_object('total_reserved', total_reserved, 'allocated', affected);
END $function$;

-- 8) tg_chain_advance_on_done: skip is_reschedule pickings
CREATE OR REPLACE FUNCTION public.tg_chain_advance_on_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE nxt record; m record; reserved numeric; short numeric; needed numeric;
BEGIN
  IF NEW.is_reschedule THEN
    RETURN NEW;
  END IF;
  IF NEW.state = 'done' AND coalesce(OLD.state::text,'') <> 'done' THEN
    FOR nxt IN SELECT * FROM stock_pickings WHERE previous_picking_id = NEW.id AND state NOT IN ('done','cancelled') LOOP
      short := 0;
      FOR m IN SELECT * FROM stock_moves WHERE picking_id = nxt.id AND state IN ('draft','waiting') LOOP
        needed := coalesce(m.quantity,0) - coalesce(m.reserved_quantity,0);
        IF needed > 0 THEN
          reserved := reserve_for_move(m.id);
          IF reserved < needed THEN
            short := short + (needed - reserved);
          END IF;
        END IF;
      END LOOP;
      PERFORM recalc_picking_state(nxt.id);
      IF short > 0 AND nxt.user_id IS NOT NULL THEN
        PERFORM notify_user(nxt.user_id, 'inventory'::app_module, 'picking_shortage',
          'Falta de stock na próxima etapa',
          format('Transferência %s tem %s unid. em falta após replaneamento', nxt.name, short),
          '/inventory/transfers/' || nxt.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

-- 9) reschedule_picking
CREATE OR REPLACE FUNCTION public.reschedule_picking(_picking uuid, _new_date timestamptz, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  pk record; m record; ret_pick uuid; ret_name text;
  loc_stock uuid;
BEGIN
  SELECT * INTO pk FROM public.stock_pickings WHERE id=_picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;
  IF pk.state IN ('done','cancelled') THEN
    RAISE EXCEPTION 'Não é possível reagendar uma transferência % ', pk.state;
  END IF;
  IF pk.kind <> 'outgoing' THEN
    RAISE EXCEPTION 'Reagendamento só se aplica a saídas';
  END IF;

  loc_stock := public.default_location(pk.warehouse_id,'Stock');

  -- Build a return picking from current source_location -> Stock for items already at the dock/van
  IF pk.source_location_id <> loc_stock THEN
    ret_name := public.next_sequence('picking_int');
    INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id,
            destination_location_id, partner_id, origin, created_by, is_reschedule, step_label)
      VALUES(ret_name, 'internal'::picking_kind, 'draft'::picking_state, pk.warehouse_id,
             pk.source_location_id, loc_stock, pk.partner_id, pk.origin, auth.uid(),
             true, 'Retorno reagendamento')
      RETURNING id INTO ret_pick;
    INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id,
            source_location_id, destination_location_id, quantity, quantity_done, state, reference)
      SELECT ret_pick, product_id, variant_id, uom_id,
             pk.source_location_id, loc_stock,
             quantity, quantity, 'draft'::picking_state, pk.origin
        FROM public.stock_moves WHERE picking_id=_picking;
    -- Validate the return immediately to physically move stock back
    PERFORM public.validate_picking(ret_pick);
  END IF;

  -- Reset original moves to waiting and keep reservation in Stock
  UPDATE public.stock_moves
     SET state='waiting'::picking_state,
         source_location_id = loc_stock,
         quantity_done = 0
   WHERE picking_id = _picking;

  UPDATE public.stock_pickings
     SET state='waiting'::picking_state,
         source_location_id = loc_stock,
         scheduled_at = _new_date,
         reschedule_count = reschedule_count + 1,
         reschedule_reason = _reason,
         updated_at = now()
   WHERE id = _picking;

  -- Re-reserve in Stock
  FOR m IN SELECT id FROM public.stock_moves WHERE picking_id=_picking LOOP
    PERFORM public.reserve_for_move(m.id);
  END LOOP;
  PERFORM public.recalc_picking_state(_picking);

  PERFORM public.log_record_event('stock_picking', _picking,
    format('Transferência reagendada para %s. Motivo: %s', _new_date, COALESCE(_reason,'—')),
    jsonb_build_object('reason', _reason, 'new_date', _new_date));

  -- Notify salesperson if linked to a SO
  DECLARE so_id uuid; sp uuid;
  BEGIN
    SELECT id, salesperson_id INTO so_id, sp FROM public.sale_orders WHERE name=pk.origin;
    IF sp IS NOT NULL THEN
      PERFORM public.notify_user(sp, 'sales'::app_module, 'picking_rescheduled',
        'Entrega reagendada',
        format('%s reagendada para %s', pk.name, to_char(_new_date,'DD/MM/YYYY HH24:MI')),
        '/sales/orders/' || so_id);
    END IF;
  END;

  RETURN _picking;
END $function$;
