
-- 1) New function: when an incoming picking is validated, reserve received qty
--    on the matching outgoing picking of the originating sale order.
CREATE OR REPLACE FUNCTION public.reserve_incoming_to_origin_so(_picking uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pk record;
  po record;
  so record;
  out_pk uuid;
  m record;
  outm record;
  remaining numeric;
  reserved numeric;
BEGIN
  SELECT * INTO pk FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND OR pk.kind <> 'incoming' OR pk.origin IS NULL THEN RETURN; END IF;

  SELECT * INTO po FROM public.purchase_orders WHERE name = pk.origin;
  IF NOT FOUND OR po.origin IS NULL THEN RETURN; END IF;

  SELECT * INTO so FROM public.sale_orders WHERE name = po.origin;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO out_pk FROM public.stock_pickings
    WHERE origin = so.name AND kind = 'outgoing'
      AND state NOT IN ('done','cancelled')
    ORDER BY created_at LIMIT 1;
  IF out_pk IS NULL THEN RETURN; END IF;

  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = _picking AND COALESCE(quantity_done,0) > 0 LOOP
    remaining := m.quantity_done;
    FOR outm IN
      SELECT * FROM public.stock_moves
       WHERE picking_id = out_pk
         AND product_id = m.product_id
         AND state IN ('draft','waiting','ready')
       ORDER BY created_at
    LOOP
      EXIT WHEN remaining <= 0;
      reserved := public.reserve_for_move(outm.id);
      remaining := remaining - LEAST(remaining, reserved);
    END LOOP;
  END LOOP;

  PERFORM public.log_record_event('stock_picking', out_pk,
    format('Stock recebido via %s e reservado automaticamente', pk.name), '{}'::jsonb);
  PERFORM public.log_record_event('sale_order', so.id,
    format('Recebimento %s validado — stock reservado para esta venda', pk.name), '{}'::jsonb);
END $$;

-- 2) Patch validate_picking to call reservation hook for incoming pickings
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  prod record;
  pk_kind picking_kind;
BEGIN
  FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking LOOP
    SELECT tracking INTO prod FROM products WHERE id = m.product_id;
    IF prod.tracking IS DISTINCT FROM 'none' AND m.lot_id IS NULL AND COALESCE(m.quantity_done,0) > 0 THEN
      RAISE EXCEPTION 'Produto rastreado por % requer lote/série no movimento', prod.tracking;
    END IF;

    IF COALESCE(m.quantity_done,0) > 0 THEN
      UPDATE stock_quants
        SET quantity = quantity - m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.source_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -m.quantity_done);
      END IF;

      UPDATE stock_quants
        SET quantity = quantity + m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.destination_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);

      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, m.quantity_done);
      END IF;
    END IF;

    UPDATE stock_moves SET state = 'done' WHERE id = m.id;
  END LOOP;

  UPDATE stock_pickings SET state = 'done', done_at = now() WHERE id = _picking;

  SELECT kind INTO pk_kind FROM stock_pickings WHERE id = _picking;
  IF pk_kind = 'incoming' THEN
    PERFORM public.reserve_incoming_to_origin_so(_picking);
  END IF;
END;
$function$;

-- 3) Patch confirm_purchase_order so receipt picking inherits expected_date
CREATE OR REPLACE FUNCTION public.confirm_purchase_order(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o record; l record; wh uuid; src uuid; dst uuid; v_picking_id uuid; picking_name text;
begin
  select * into o from public.purchase_orders where id = _order;
  if not found then raise exception 'PO not found'; end if;
  if o.state not in ('draft','rfq_sent') then raise exception 'PO must be draft/rfq'; end if;

  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  src := public.supplier_location_id();
  dst := public.default_location(wh,'Recebimento');

  picking_name := public.next_sequence('picking_in');
  insert into public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by, scheduled_at)
  values(picking_name,'incoming'::picking_kind,'ready'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid(),
         coalesce(o.expected_date::timestamptz, now()))
  returning id into v_picking_id;

  for l in select * from public.purchase_order_lines where order_id = _order loop
    insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
    values (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity,'ready'::picking_state, o.name);
  end loop;

  update public.purchase_orders set state='confirmed' where id = _order;
  perform public.log_record_event('purchase_order', _order, format('Compra confirmada, recebimento %s criado', picking_name),'{}'::jsonb);
  if o.buyer_id is not null then
    perform public.notify_user(o.buyer_id,'purchase','po_confirmed','Compra confirmada',
      format('%s para %s', o.name,(select name from public.partners where id=o.partner_id)),'/purchase/orders');
  end if;
end $function$;
