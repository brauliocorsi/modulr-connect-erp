
-- Adicionar coluna em falta (várias funções já a referenciam)
ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS reserved_quantity numeric NOT NULL DEFAULT 0;

-- A. validate_picking
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  m record; prod record; pk record;
  bo_id uuid; bo_name text; seq_code text;
  has_shortage boolean := false;
  total_done numeric := 0; total_requested numeric := 0; move_count int := 0;
  src_type location_type; dst_type location_type;
  release_qty numeric; short_qty numeric;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking not found'; END IF;
  IF pk.state = 'done' THEN RAISE EXCEPTION 'Picking já validado'; END IF;

  SELECT COUNT(*), COALESCE(SUM(COALESCE(quantity_done,0)),0), COALESCE(SUM(COALESCE(quantity,0)),0)
    INTO move_count, total_done, total_requested
    FROM stock_moves WHERE picking_id = _picking AND state <> 'cancelled';

  IF move_count = 0 THEN
    RAISE EXCEPTION 'Picking sem linhas; adicione produtos antes de validar' USING ERRCODE='check_violation';
  END IF;
  IF total_requested > 0 AND total_done = 0 THEN
    RAISE EXCEPTION 'Não é possível validar: todas as quantidades movimentadas estão a 0. Informe a quantidade efetivamente movimentada antes de validar.' USING ERRCODE='check_violation';
  END IF;

  FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking AND state NOT IN ('done','cancelled') LOOP
    SELECT tracking INTO prod FROM products WHERE id = m.product_id;
    IF prod.tracking IS DISTINCT FROM 'none' AND m.lot_id IS NULL AND COALESCE(m.quantity_done,0) > 0 THEN
      RAISE EXCEPTION 'Produto rastreado por % requer lote/série no movimento', prod.tracking;
    END IF;

    SELECT type INTO src_type FROM stock_locations WHERE id = m.source_location_id;
    SELECT type INTO dst_type FROM stock_locations WHERE id = m.destination_location_id;

    IF COALESCE(m.quantity_done,0) > 0 THEN
      IF src_type IN ('internal','transit') THEN
        UPDATE stock_quants
          SET quantity = quantity - m.quantity_done,
              reserved_quantity = GREATEST(0, reserved_quantity - LEAST(reserved_quantity, m.quantity_done)),
              updated_at = now()
          WHERE product_id = m.product_id
            AND location_id = m.source_location_id
            AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
        IF NOT FOUND THEN
          INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
          VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -m.quantity_done);
        END IF;
      END IF;

      IF dst_type IN ('internal','transit') THEN
        UPDATE stock_quants
          SET quantity = quantity + m.quantity_done, updated_at = now()
          WHERE product_id = m.product_id
            AND location_id = m.destination_location_id
            AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
        IF NOT FOUND THEN
          INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
          VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, m.quantity_done);
        END IF;
      END IF;
    END IF;

    short_qty := m.quantity - COALESCE(m.quantity_done,0);
    IF short_qty > 0 THEN
      has_shortage := true;
      release_qty := LEAST(COALESCE(m.reserved_quantity,0), short_qty);
      IF release_qty > 0 THEN
        PERFORM public.release_move_reservation_partial(m.id, release_qty);
      END IF;
    END IF;

    UPDATE stock_moves SET state='done' WHERE id = m.id;
  END LOOP;

  IF has_shortage THEN
    seq_code := CASE pk.kind WHEN 'incoming' THEN 'picking_in' WHEN 'outgoing' THEN 'picking_out' ELSE 'picking_int' END;
    bo_name := public.next_sequence(seq_code);
    INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, scheduled_at, backorder_id, created_by)
    VALUES (bo_name, pk.kind, 'ready'::picking_state, pk.warehouse_id, pk.source_location_id, pk.destination_location_id, pk.partner_id, pk.origin, now(), pk.id, pk.created_by)
    RETURNING id INTO bo_id;

    INSERT INTO public.stock_moves(picking_id, product_id, variant_id, source_location_id, destination_location_id, quantity, quantity_done, state)
    SELECT bo_id, product_id, variant_id, source_location_id, destination_location_id,
           (quantity - COALESCE(quantity_done,0)), 0, 'ready'::stock_move_state
    FROM stock_moves
    WHERE picking_id = _picking AND COALESCE(quantity_done,0) < quantity AND state='done';
  END IF;

  UPDATE stock_pickings SET state='done', done_at=now() WHERE id = _picking;
END $function$;

-- B. confirm_purchase_order
CREATE OR REPLACE FUNCTION public.confirm_purchase_order(_order uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

-- C. assert helper + confirm_sale_order
CREATE OR REPLACE FUNCTION public.assert_so_has_lines(_order uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c int;
BEGIN
  SELECT COUNT(*) INTO c FROM public.sale_order_lines WHERE order_id=_order AND line_kind='product' AND COALESCE(quantity,0) > 0;
  IF c=0 THEN
    RAISE EXCEPTION 'A venda não tem linhas de produto com quantidade > 0; adicione produtos antes de confirmar' USING ERRCODE='check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid; comp record; prod record; use_chain boolean;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.state <> 'draft' AND o.state <> 'sent' THEN RAISE EXCEPTION 'Order must be draft/sent'; END IF;

  PERFORM public.assert_so_has_lines(_order);

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
              SELECT id INTO po_id FROM public.purchase_orders
              WHERE partner_id=pref_supplier AND state='draft' AND warehouse_id=wh AND origin=o.name
              ORDER BY created_at DESC LIMIT 1;
              IF po_id IS NULL THEN
                po_name := public.next_sequence('purchase_order');
                expected := current_date + COALESCE((SELECT min(lead_time_days) FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier),7);
                INSERT INTO public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
                VALUES(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) RETURNING id INTO po_id;
                INSERT INTO public.module_events(source_module, event_type, payload)
                VALUES('purchase','auto_po_created', jsonb_build_object('po_id', po_id, 'so_id', _order, 'partner_id', pref_supplier));
                PERFORM public.log_record_event('sale_order', _order, format('Ordem de compra %s criada automaticamente', po_name), '{}'::jsonb);
              END IF;
              INSERT INTO public.purchase_order_origins(po_id, sale_order_id) VALUES(po_id,_order) ON CONFLICT DO NOTHING;
              INSERT INTO public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              SELECT po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0),
                     shortage * COALESCE((SELECT price FROM public.product_suppliers WHERE product_id=l.product_id AND partner_id=pref_supplier ORDER BY priority LIMIT 1),0);
              UPDATE public.purchase_orders po SET
                amount_untaxed=(SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id=po.id),
                amount_total=(SELECT COALESCE(sum(subtotal),0) FROM public.purchase_order_lines WHERE order_id=po.id) + COALESCE(po.amount_tax,0)
              WHERE po.id=po_id;
            END IF;
          END IF;
        END IF;
      END;
    END LOOP;
    UPDATE public.sale_orders SET state='confirmed' WHERE id=_order;
    PERFORM public.seed_default_schedule(_order);
    PERFORM public.recalc_payment_status(_order);
    PERFORM public.recalc_so_fulfillment(_order);
    PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, cadeia (%s) criada', o.delivery_mode), '{}'::jsonb);
    IF o.salesperson_id IS NOT NULL THEN
      PERFORM public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
        format('%s para %s', o.name,(SELECT name FROM public.partners WHERE id=o.partner_id)), '/sales/orders');
    END IF;
    RETURN;
  END IF;

  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();
  picking_name := public.next_sequence('picking_out');
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by, step_label)
  VALUES(picking_name,'outgoing'::picking_kind,'draft'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid(),'Saída (Stock → Cliente)')
  RETURNING id INTO v_picking_id;

  FOR l IN SELECT * FROM public.sale_order_lines WHERE order_id=_order AND line_kind='product' AND COALESCE(quantity,0) > 0 LOOP
    SELECT id INTO phantom_bom FROM public.boms WHERE product_id=l.product_id AND type='phantom' AND active LIMIT 1;
    IF phantom_bom IS NOT NULL THEN
      FOR comp IN SELECT * FROM public.bom_lines WHERE bom_id=phantom_bom LOOP
        INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
        VALUES (v_picking_id, comp.component_product_id, comp.component_variant_id, comp.uom_id, src, dst, comp.quantity*l.quantity, 'draft'::picking_state, o.name);
      END LOOP;
    ELSE
      INSERT INTO public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
      VALUES (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft'::picking_state, o.name);
    END IF;
  END LOOP;

  UPDATE public.stock_pickings SET state='waiting'::picking_state WHERE id=v_picking_id;
  FOR l IN SELECT sm.* FROM public.stock_moves sm WHERE sm.picking_id=v_picking_id LOOP
    PERFORM public.reserve_for_move(l.id);
  END LOOP;

  UPDATE public.sale_orders SET state='confirmed' WHERE id=_order;
  PERFORM public.seed_default_schedule(_order);
  PERFORM public.recalc_payment_status(_order);
  PERFORM public.recalc_so_fulfillment(_order);
  PERFORM public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
END $function$;

-- D. create_internal_transfer
CREATE OR REPLACE FUNCTION public.create_internal_transfer(_source uuid, _destination uuid, _lines jsonb, _scheduled_at timestamptz DEFAULT now(), _partner uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pk_id uuid; pk_name text; wh uuid; ln jsonb; mv record; line_count int := 0;
BEGIN
  IF _source IS NULL OR _destination IS NULL THEN RAISE EXCEPTION 'Origem e destino obrigatórios'; END IF;
  IF _source=_destination THEN RAISE EXCEPTION 'Origem e destino devem ser diferentes'; END IF;
  SELECT warehouse_id INTO wh FROM public.stock_locations WHERE id=_source;
  pk_name := public.next_sequence('picking_int');
  INSERT INTO public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, scheduled_at, created_by)
  VALUES (pk_name,'internal'::picking_kind,'draft'::picking_state, wh, _source, _destination, _partner, _scheduled_at, auth.uid())
  RETURNING id INTO pk_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    IF COALESCE((ln->>'quantity')::numeric,0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.stock_moves(picking_id, product_id, uom_id, source_location_id, destination_location_id, quantity, state)
    VALUES (pk_id, (ln->>'product_id')::uuid, NULLIF(ln->>'uom_id','')::uuid, _source, _destination, (ln->>'quantity')::numeric, 'draft'::picking_state);
    line_count := line_count + 1;
  END LOOP;

  IF line_count=0 THEN
    DELETE FROM public.stock_pickings WHERE id=pk_id;
    RAISE EXCEPTION 'Transferência interna sem linhas válidas';
  END IF;

  FOR mv IN SELECT id FROM stock_moves WHERE picking_id=pk_id LOOP
    PERFORM public.reserve_for_move(mv.id);
  END LOOP;
  PERFORM public.recalc_picking_state(pk_id);

  RETURN pk_id;
END $function$;

-- E. tg_quant_try_reserve: incluir internal
CREATE OR REPLACE FUNCTION public.tg_quant_try_reserve()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE m record; old_avail numeric; new_avail numeric;
BEGIN
  new_avail := COALESCE(NEW.quantity,0) - COALESCE(NEW.reserved_quantity,0);
  IF TG_OP='UPDATE' THEN old_avail := COALESCE(OLD.quantity,0) - COALESCE(OLD.reserved_quantity,0); ELSE old_avail := 0; END IF;
  IF new_avail <= old_avail THEN RETURN NEW; END IF;

  FOR m IN
    SELECT sm.id, sm.picking_id FROM stock_moves sm
    JOIN stock_pickings p ON p.id=sm.picking_id
    WHERE sm.product_id=NEW.product_id AND sm.source_location_id=NEW.location_id
      AND sm.state IN ('draft','waiting')
      AND p.kind IN ('outgoing','internal')
      AND p.state NOT IN ('done','cancelled')
    ORDER BY p.created_at, sm.created_at
  LOOP
    PERFORM public.reserve_for_move(m.id);
    PERFORM public.recalc_picking_state(m.picking_id);
  END LOOP;
  RETURN NEW;
END $function$;

-- F. apply_inventory_adjustment
CREATE OR REPLACE FUNCTION public.apply_inventory_adjustment(_adj uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a record; l record; diff numeric; q record; remaining numeric; take numeric;
  null_lot uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  SELECT * INTO a FROM public.inventory_adjustments WHERE id=_adj;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF a.state='done' THEN RAISE EXCEPTION 'Already validated'; END IF;

  FOR l IN SELECT * FROM public.inventory_adjustment_lines WHERE adjustment_id=_adj LOOP
    diff := COALESCE(l.counted_qty,0) - COALESCE(l.theoretical_qty,0);
    IF diff=0 THEN CONTINUE; END IF;

    IF diff > 0 THEN
      SELECT * INTO q FROM public.stock_quants
        WHERE product_id=l.product_id AND location_id=l.location_id
          AND COALESCE(lot_id, null_lot) = COALESCE(l.lot_id, null_lot) LIMIT 1;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity=quantity+diff, updated_at=now() WHERE id=q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (l.product_id, l.variant_id, l.location_id, l.lot_id, diff);
      END IF;
    ELSE
      remaining := -diff;
      FOR q IN
        SELECT * FROM public.stock_quants
        WHERE product_id=l.product_id AND location_id=l.location_id
          AND COALESCE(lot_id, null_lot) = COALESCE(l.lot_id, null_lot)
        ORDER BY updated_at
      LOOP
        EXIT WHEN remaining <= 0;
        take := LEAST(remaining, q.quantity);
        UPDATE public.stock_quants SET quantity=quantity-take, updated_at=now() WHERE id=q.id;
        remaining := remaining - take;
      END LOOP;
      IF remaining > 0 THEN
        INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (l.product_id, l.variant_id, l.location_id, l.lot_id, -remaining);
      END IF;
    END IF;
    UPDATE public.inventory_adjustment_lines SET difference=diff WHERE id=l.id;
  END LOOP;

  UPDATE public.inventory_adjustments SET state='done', done_at=now() WHERE id=_adj;
  PERFORM public.log_record_event('inventory_adjustment', _adj, 'Ajuste validado', '{}'::jsonb);
END $function$;

-- LIMPEZA: zerar reservas órfãs em stock_quants
UPDATE public.stock_quants q
   SET reserved_quantity=0, updated_at=now()
 WHERE reserved_quantity > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.stock_moves m
     JOIN public.stock_pickings p ON p.id=m.picking_id
     WHERE m.product_id=q.product_id AND m.source_location_id=q.location_id
       AND m.state IN ('draft','waiting') AND p.state NOT IN ('done','cancelled')
   );

-- LIMPEZA: zerar reserved_quantity em stock_moves de pickings já done/cancelled
UPDATE public.stock_moves
   SET reserved_quantity=0
 WHERE state IN ('done','cancelled') AND reserved_quantity <> 0;

-- LIMPEZA: zerar quantidades negativas em supplier/customer
UPDATE public.stock_quants q
   SET quantity=0, updated_at=now()
  FROM public.stock_locations l
 WHERE l.id=q.location_id AND l.type IN ('supplier','customer') AND q.quantity < 0;

-- Re-tentar reservas de moves pendentes
DO $$
DECLARE m record;
BEGIN
  FOR m IN
    SELECT sm.id, sm.picking_id FROM public.stock_moves sm
    JOIN public.stock_pickings p ON p.id=sm.picking_id
    WHERE sm.state IN ('draft','waiting')
      AND p.kind IN ('outgoing','internal')
      AND p.state NOT IN ('done','cancelled')
    ORDER BY p.created_at, sm.created_at
  LOOP
    PERFORM public.reserve_for_move(m.id);
    PERFORM public.recalc_picking_state(m.picking_id);
  END LOOP;
END $$;
