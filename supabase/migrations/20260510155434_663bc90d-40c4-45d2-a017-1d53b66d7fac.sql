CREATE OR REPLACE FUNCTION public.reserve_for_move(_move uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m record; q record; remaining numeric; take numeric; reserved_total numeric := 0;
begin
  select * into m from public.stock_moves where id = _move;
  if not found or m.state in ('done','cancelled','ready') then
    -- idempotent: already reserved or finalized; do nothing, do not touch reservations
    return 0;
  end if;
  remaining := m.quantity;
  for q in
    select sq.* from public.stock_quants sq
    join public.stock_locations l on l.id = sq.location_id
    where sq.product_id = m.product_id
      and l.id = m.source_location_id
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
     set state = case when reserved_total >= m.quantity then 'ready'::picking_state else 'waiting'::picking_state end
   where id = _move;
  return reserved_total;
end $function$;