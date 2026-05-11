-- Fix 1: trigger referenced non-existent column user_id on stock_pickings
CREATE OR REPLACE FUNCTION public.tg_chain_advance_on_done()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      IF short > 0 AND nxt.created_by IS NOT NULL THEN
        PERFORM notify_user(nxt.created_by, 'inventory'::app_module, 'picking_shortage',
          'Falta de stock na próxima etapa',
          format('Transferência %s tem %s unid. em falta após replaneamento', nxt.name, short),
          '/inventory/transfers/' || nxt.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

-- Fix 2: when transferring reservation, source move must drop from 'ready' back to 'waiting' if it lost stock
CREATE OR REPLACE FUNCTION public.transfer_reservation(
  _from_move uuid,
  _to_so uuid,
  _qty numeric,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  src_move record;
  src_picking record;
  src_so record;
  dst_so record;
  dst_move record;
  dst_picking_id uuid;
  released numeric;
  re_reserved numeric;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'sales'::app_module, 'orders'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão para transferir reservas';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva'; END IF;

  SELECT * INTO src_move FROM stock_moves WHERE id = _from_move;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimento de origem não encontrado'; END IF;
  IF coalesce(src_move.reserved_quantity, 0) < _qty THEN
    RAISE EXCEPTION 'Reserva insuficiente no movimento origem (% disponível)', coalesce(src_move.reserved_quantity,0);
  END IF;

  SELECT * INTO src_picking FROM stock_pickings WHERE id = src_move.picking_id;
  IF src_picking.state IN ('done','cancelled') THEN
    RAISE EXCEPTION 'Picking de origem já está % — não é possível transferir', src_picking.state;
  END IF;

  SELECT so.* INTO src_so FROM sale_orders so WHERE so.name = src_picking.origin;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda de origem não encontrada'; END IF;

  SELECT * INTO dst_so FROM sale_orders WHERE id = _to_so;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda de destino não encontrada'; END IF;
  IF dst_so.id = src_so.id THEN RAISE EXCEPTION 'Origem e destino são a mesma venda'; END IF;
  IF dst_so.state NOT IN ('confirmed','sent') THEN
    RAISE EXCEPTION 'Venda destino deve estar confirmada (estado atual: %)', dst_so.state;
  END IF;

  SELECT sm.*, sp.id AS pid INTO dst_move
  FROM stock_moves sm
  JOIN stock_pickings sp ON sp.id = sm.picking_id
  WHERE sp.origin = dst_so.name
    AND sp.kind = 'outgoing'
    AND sp.state NOT IN ('done','cancelled')
    AND sp.warehouse_id = src_picking.warehouse_id
    AND sm.product_id = src_move.product_id
    AND sm.source_location_id = src_move.source_location_id
    AND coalesce(sm.variant_id::text,'') = coalesce(src_move.variant_id::text,'')
    AND sm.state IN ('draft','waiting','ready')
    AND (sm.quantity - coalesce(sm.reserved_quantity,0)) >= _qty
  ORDER BY sm.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda destino não tem linha pendente compatível (mesmo produto/variante/armazém com falta de % unid.)', _qty;
  END IF;
  dst_picking_id := dst_move.pid;

  released := public.release_move_reservation_partial(_from_move, _qty);
  IF released < _qty THEN
    RAISE EXCEPTION 'Não foi possível libertar a quantidade pedida (libertou %)', released;
  END IF;

  -- Update source move state based on new reserved quantity
  UPDATE stock_moves
     SET state = CASE
                   WHEN coalesce(reserved_quantity,0) >= quantity AND quantity > 0 THEN 'ready'::picking_state
                   WHEN coalesce(reserved_quantity,0) > 0 THEN 'waiting'::picking_state
                   ELSE 'waiting'::picking_state
                 END
   WHERE id = _from_move;

  DECLARE
    remaining numeric := _qty;
    take numeric;
    q record;
  BEGIN
    FOR q IN
      SELECT sq.* FROM stock_quants sq
      WHERE sq.product_id = dst_move.product_id
        AND sq.location_id = dst_move.source_location_id
        AND coalesce(sq.variant_id::text,'') = coalesce(dst_move.variant_id::text,'')
        AND (sq.quantity - sq.reserved_quantity) > 0
      ORDER BY sq.updated_at
    LOOP
      EXIT WHEN remaining <= 0;
      take := least(remaining, q.quantity - q.reserved_quantity);
      UPDATE stock_quants
         SET reserved_quantity = reserved_quantity + take, updated_at = now()
       WHERE id = q.id;
      remaining := remaining - take;
    END LOOP;
    re_reserved := _qty - remaining;
  END;

  IF re_reserved < _qty THEN
    RAISE EXCEPTION 'Stock insuficiente no destino para reservar (reservou %)', re_reserved;
  END IF;

  UPDATE stock_moves
     SET reserved_quantity = coalesce(reserved_quantity,0) + re_reserved,
         state = CASE WHEN (coalesce(reserved_quantity,0) + re_reserved) >= quantity
                      THEN 'ready'::picking_state
                      ELSE 'waiting'::picking_state END
   WHERE id = dst_move.id;

  UPDATE stock_pickings SET reservation_transfer_count = reservation_transfer_count + 1
   WHERE id IN (src_picking.id, dst_picking_id);

  PERFORM public.recalc_picking_state(src_picking.id);
  PERFORM public.recalc_picking_state(dst_picking_id);
  PERFORM public.recalc_so_fulfillment(src_so.id);
  PERFORM public.recalc_so_fulfillment(dst_so.id);

  IF src_so.salesperson_id IS NOT NULL THEN
    PERFORM public.notify_user(
      src_so.salesperson_id, 'sales'::app_module, 'reservation_transferred_out',
      'Reserva transferida para outra venda',
      format('%s unid. da venda %s foram transferidas para %s%s',
             _qty, src_so.name, dst_so.name,
             CASE WHEN _reason IS NOT NULL THEN ' — ' || _reason ELSE '' END),
      '/sales/orders/' || src_so.id
    );
  END IF;
  IF dst_so.salesperson_id IS NOT NULL AND dst_so.salesperson_id IS DISTINCT FROM src_so.salesperson_id THEN
    PERFORM public.notify_user(
      dst_so.salesperson_id, 'sales'::app_module, 'reservation_transferred_in',
      'Reserva recebida de outra venda',
      format('%s unid. da venda %s foram atribuídas a %s%s',
             _qty, src_so.name, dst_so.name,
             CASE WHEN _reason IS NOT NULL THEN ' — ' || _reason ELSE '' END),
      '/sales/orders/' || dst_so.id
    );
  END IF;

  RETURN jsonb_build_object('released', released, 'reserved', re_reserved, 'dst_move', dst_move.id, 'dst_picking', dst_picking_id);
END $$;

-- Re-sync any existing source moves that are 'ready' but reserved < quantity
UPDATE public.stock_moves
   SET state = 'waiting'::picking_state
 WHERE state = 'ready'
   AND coalesce(reserved_quantity,0) < quantity
   AND quantity > 0;