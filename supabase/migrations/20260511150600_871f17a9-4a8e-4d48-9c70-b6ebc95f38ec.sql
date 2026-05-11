-- Fix transfer_reservation: swap reservation directly between moves to avoid
-- the auto-reserve trigger giving the released stock back to the source move.

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
  src_new_reserved numeric;
  dst_new_reserved numeric;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'sales'::app_module, 'orders'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão para transferir reservas';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva'; END IF;

  SELECT * INTO src_move FROM stock_moves WHERE id = _from_move FOR UPDATE;
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
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda destino não tem linha pendente compatível (mesmo produto/variante/armazém com falta de % unid.)', _qty;
  END IF;
  dst_picking_id := dst_move.pid;

  -- Same source location: swap reservation directly between moves.
  -- Quant total reserved stays the same so no quant write -> no auto-reserve trigger storm.
  src_new_reserved := coalesce(src_move.reserved_quantity,0) - _qty;
  dst_new_reserved := coalesce(dst_move.reserved_quantity,0) + _qty;

  UPDATE stock_moves
     SET reserved_quantity = src_new_reserved,
         state = CASE WHEN src_new_reserved >= quantity AND quantity > 0 THEN 'ready'::picking_state
                      ELSE 'waiting'::picking_state END
   WHERE id = _from_move;

  UPDATE stock_moves
     SET reserved_quantity = dst_new_reserved,
         state = CASE WHEN dst_new_reserved >= quantity AND quantity > 0 THEN 'ready'::picking_state
                      ELSE 'waiting'::picking_state END
   WHERE id = dst_move.id;

  UPDATE stock_pickings SET reservation_transfer_count = coalesce(reservation_transfer_count,0) + 1
   WHERE id IN (src_picking.id, dst_picking_id);

  PERFORM public.recalc_picking_state(src_picking.id);
  PERFORM public.recalc_picking_state(dst_picking_id);
  PERFORM public.recalc_so_fulfillment(src_so.id);
  PERFORM public.recalc_so_fulfillment(dst_so.id);

  -- Re-sync quant reserved against actual move reservations on this location/product/variant
  PERFORM public.release_orphan_reservations();

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

  RETURN jsonb_build_object(
    'qty', _qty,
    'from_so', src_so.name,
    'to_so', dst_so.name,
    'src_move_reserved', src_new_reserved,
    'dst_move_reserved', dst_new_reserved,
    'dst_move', dst_move.id,
    'dst_picking', dst_picking_id
  );
END $$;

-- Cleanup of the broken state caused by the previous version:
-- 1) Re-sync any source moves that are 'ready' but have reserved < quantity
UPDATE public.stock_moves
   SET state = 'waiting'::picking_state
 WHERE state = 'ready'
   AND coalesce(reserved_quantity,0) < quantity
   AND quantity > 0;

-- 2) For pickings where total reserved across moves exceeds quant.quantity,
--    reduce the OLDEST move's reservation to bring it back in line.
DO $cleanup$
DECLARE q record; over numeric; m record; take numeric;
BEGIN
  FOR q IN
    SELECT sq.id AS quant_id, sq.product_id, sq.variant_id, sq.location_id,
           sq.quantity, sq.reserved_quantity,
           COALESCE((
             SELECT SUM(sm.reserved_quantity) FROM stock_moves sm
             WHERE sm.product_id = sq.product_id
               AND sm.source_location_id = sq.location_id
               AND COALESCE(sm.variant_id::text,'') = COALESCE(sq.variant_id::text,'')
               AND sm.state IN ('waiting','ready','draft')
           ),0) AS moves_reserved
    FROM stock_quants sq
  LOOP
    over := q.moves_reserved - q.quantity;
    IF over > 0 THEN
      FOR m IN
        SELECT sm.id, sm.reserved_quantity, sm.quantity, sp.created_at AS pcreated
        FROM stock_moves sm
        JOIN stock_pickings sp ON sp.id = sm.picking_id
        WHERE sm.product_id = q.product_id
          AND sm.source_location_id = q.location_id
          AND COALESCE(sm.variant_id::text,'') = COALESCE(q.variant_id::text,'')
          AND sm.state IN ('waiting','ready','draft')
          AND COALESCE(sm.reserved_quantity,0) > 0
        ORDER BY sp.created_at ASC, sm.created_at ASC
      LOOP
        EXIT WHEN over <= 0;
        take := LEAST(over, m.reserved_quantity);
        UPDATE stock_moves
           SET reserved_quantity = reserved_quantity - take,
               state = CASE WHEN (reserved_quantity - take) >= quantity AND quantity > 0
                            THEN 'ready'::picking_state
                            ELSE 'waiting'::picking_state END
         WHERE id = m.id;
        over := over - take;
      END LOOP;
    END IF;
  END LOOP;
END $cleanup$;

-- 3) Resync quants from move reservations (canonical source of truth)
SELECT public.release_orphan_reservations();

-- 4) Recalc all non-final pickings
DO $r$
DECLARE p record;
BEGIN
  FOR p IN SELECT id FROM stock_pickings WHERE state NOT IN ('done','cancelled','draft') LOOP
    PERFORM public.recalc_picking_state(p.id);
  END LOOP;
END $r$;