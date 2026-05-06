
CREATE OR REPLACE FUNCTION public.apply_inventory_adjustment(_adj uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  a record;
  l record;
  diff numeric;
  q record;
  remaining numeric;
  take numeric;
begin
  select * into a from public.inventory_adjustments where id = _adj;
  if not found then raise exception 'Adjustment not found'; end if;
  if a.state = 'done' then raise exception 'Already validated'; end if;

  for l in select * from public.inventory_adjustment_lines where adjustment_id = _adj loop
    diff := coalesce(l.counted_qty,0) - coalesce(l.theoretical_qty,0);
    if diff = 0 then continue; end if;

    if diff > 0 then
      select * into q from public.stock_quants
        where product_id = l.product_id and location_id = l.location_id
          and coalesce(lot_id::text,'') = coalesce(l.lot_id::text,'')
        limit 1;
      if found then
        update public.stock_quants set quantity = quantity + diff, updated_at = now() where id = q.id;
      else
        insert into public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        values (l.product_id, l.variant_id, l.location_id, l.lot_id, diff);
      end if;
    else
      remaining := -diff;
      for q in
        select * from public.stock_quants
        where product_id = l.product_id and location_id = l.location_id
          and coalesce(lot_id::text,'') = coalesce(l.lot_id::text,'')
        order by updated_at
      loop
        exit when remaining <= 0;
        take := least(remaining, q.quantity);
        update public.stock_quants
          set quantity = quantity - take, updated_at = now()
          where id = q.id;
        remaining := remaining - take;
      end loop;
      if remaining > 0 then
        insert into public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        values (l.product_id, l.variant_id, l.location_id, l.lot_id, -remaining);
      end if;
    end if;

    update public.inventory_adjustment_lines set difference = diff where id = l.id;
  end loop;

  update public.inventory_adjustments set state='done', done_at=now() where id = _adj;
  perform public.log_record_event('inventory_adjustment', _adj, 'Ajuste validado', '{}'::jsonb);
end $$;
