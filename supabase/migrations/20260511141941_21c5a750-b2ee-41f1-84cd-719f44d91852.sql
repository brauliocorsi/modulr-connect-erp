
CREATE OR REPLACE FUNCTION public.reserve_for_move(_move uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare m record; q record; remaining numeric; take numeric; reserved_total numeric := 0;
begin
  select * into m from public.stock_moves where id = _move;
  if not found or m.state in ('done','cancelled','ready') then
    return 0;
  end if;
  remaining := m.quantity;
  for q in
    select sq.* from public.stock_quants sq
    join public.stock_locations l on l.id = sq.location_id
    where sq.product_id = m.product_id
      and l.id = m.source_location_id
      and coalesce(sq.variant_id::text,'') = coalesce(m.variant_id::text,'')
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
     set reserved_quantity = reserved_total,
         state = case when reserved_total >= m.quantity then 'ready'::picking_state else 'waiting'::picking_state end
   where id = _move;
  return reserved_total;
end $$;

CREATE OR REPLACE FUNCTION public.release_move_reservation(_move uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE m record; remaining numeric; take numeric; q record;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = _move;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(m.reserved_quantity,0) <= 0 THEN RETURN; END IF;
  remaining := m.reserved_quantity;
  FOR q IN SELECT * FROM stock_quants
            WHERE product_id = m.product_id
              AND location_id = m.source_location_id
              AND coalesce(variant_id::text,'') = coalesce(m.variant_id::text,'')
              AND reserved_quantity > 0
            ORDER BY updated_at DESC LOOP
    EXIT WHEN remaining <= 0;
    take := least(remaining, q.reserved_quantity);
    UPDATE stock_quants SET reserved_quantity = greatest(0, reserved_quantity - take), updated_at = now()
      WHERE id = q.id;
    remaining := remaining - take;
  END LOOP;
  UPDATE stock_moves SET reserved_quantity = 0 WHERE id = _move;
END $$;

-- Fix the existing wrongly-ready move on the broken sale: set back to waiting (shortage)
UPDATE public.stock_moves
  SET reserved_quantity = 0,
      state = 'waiting'::picking_state
  WHERE state = 'ready'
    AND reserved_quantity = 0
    AND quantity > 0;

-- Recompute picking states based on their moves
UPDATE public.stock_pickings sp
   SET state = 'waiting'::picking_state
  WHERE state = 'ready'
    AND EXISTS (
      SELECT 1 FROM public.stock_moves sm
      WHERE sm.picking_id = sp.id AND sm.state = 'waiting'
    );
