-- 1. Auditoria
ALTER TABLE public.stock_pickings
  ADD COLUMN IF NOT EXISTS reservation_transfer_count int NOT NULL DEFAULT 0;

-- 2. Liberta parcialmente reserva de um move
CREATE OR REPLACE FUNCTION public.release_move_reservation_partial(_move uuid, _qty numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  m record;
  remaining numeric;
  take numeric;
  q record;
  released numeric := 0;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = _move;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF coalesce(m.reserved_quantity,0) <= 0 OR _qty <= 0 THEN RETURN 0; END IF;

  remaining := least(_qty, m.reserved_quantity);

  FOR q IN
    SELECT * FROM stock_quants
    WHERE product_id = m.product_id
      AND location_id = m.source_location_id
      AND reserved_quantity > 0
    ORDER BY updated_at DESC
  LOOP
    EXIT WHEN remaining <= 0;
    take := least(remaining, q.reserved_quantity);
    UPDATE stock_quants
       SET reserved_quantity = greatest(0, reserved_quantity - take), updated_at = now()
     WHERE id = q.id;
    remaining := remaining - take;
    released := released + take;
  END LOOP;

  UPDATE stock_moves
     SET reserved_quantity = greatest(0, reserved_quantity - released),
         state = CASE
           WHEN greatest(0, reserved_quantity - released) >= quantity THEN 'ready'::picking_state
           WHEN greatest(0, reserved_quantity - released) > 0 THEN 'waiting'::picking_state
           ELSE 'waiting'::picking_state
         END
   WHERE id = _move;

  RETURN released;
END $$;

-- 3. Transferência manual de reserva entre vendas
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
  -- Permissão
  IF NOT public.has_permission(auth.uid(), 'sales'::app_module, 'orders'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão para transferir reservas';
  END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva';
  END IF;

  -- Origem
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

  -- Destino
  SELECT * INTO dst_so FROM sale_orders WHERE id = _to_so;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda de destino não encontrada'; END IF;
  IF dst_so.id = src_so.id THEN RAISE EXCEPTION 'Origem e destino são a mesma venda'; END IF;
  IF dst_so.state NOT IN ('confirmed','sent') THEN
    RAISE EXCEPTION 'Venda destino deve estar confirmada (estado atual: %)', dst_so.state;
  END IF;

  -- Procurar move compatível na SO destino
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
    AND sm.state IN ('draft','waiting')
    AND (sm.quantity - coalesce(sm.reserved_quantity,0)) >= _qty
  ORDER BY sm.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda destino não tem linha pendente compatível (mesmo produto/variante/armazém com falta de % unid.)', _qty;
  END IF;

  dst_picking_id := dst_move.pid;

  -- 1) Liberta na origem
  released := public.release_move_reservation_partial(_from_move, _qty);
  IF released < _qty THEN
    RAISE EXCEPTION 'Não foi possível libertar a quantidade pedida (libertou %)', released;
  END IF;

  -- 2) Reserva no destino
  -- reserve_for_move tenta reservar a quantidade total do move; usamos lógica direta aqui
  DECLARE
    remaining numeric := _qty;
    take numeric;
    q record;
  BEGIN
    FOR q IN
      SELECT sq.* FROM stock_quants sq
      WHERE sq.product_id = dst_move.product_id
        AND sq.location_id = dst_move.source_location_id
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

  -- Auditoria
  UPDATE stock_pickings SET reservation_transfer_count = reservation_transfer_count + 1
   WHERE id IN (src_picking.id, dst_picking_id);

  -- Recalcular estados
  PERFORM public.recalc_picking_state(src_picking.id);
  PERFORM public.recalc_picking_state(dst_picking_id);
  PERFORM public.recalc_so_fulfillment(src_so.id);
  PERFORM public.recalc_so_fulfillment(dst_so.id);

  -- Notificações
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
    'from_so', src_so.name, 'from_so_id', src_so.id,
    'to_so', dst_so.name, 'to_so_id', dst_so.id,
    'qty', _qty, 'reason', _reason
  );
END $$;