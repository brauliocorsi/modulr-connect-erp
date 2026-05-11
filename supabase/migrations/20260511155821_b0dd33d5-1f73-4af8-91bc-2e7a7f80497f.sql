
ALTER TABLE public.reordering_rules
  ADD COLUMN IF NOT EXISTS check_interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.run_reordering_rules()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; available numeric; needed numeric; pref uuid; po_id uuid; po_name text; created int := 0;
begin
  if not public.is_module_installed('purchase') then return 0; end if;
  for r in
    select * from public.reordering_rules
    where active and (next_run_at is null or next_run_at <= now())
  loop
    available := public.product_available_qty(r.product_id, r.warehouse_id);
    if available < r.min_qty then
      needed := r.max_qty - available;
      if r.multiple_qty > 0 then
        needed := ceil(needed / r.multiple_qty) * r.multiple_qty;
      end if;
      select partner_id into pref from public.product_suppliers where product_id = r.product_id order by priority limit 1;
      if pref is not null then
        select id into po_id from public.purchase_orders
          where partner_id = pref and state='draft' and warehouse_id = r.warehouse_id
          order by created_at desc limit 1;
        if po_id is null then
          po_name := public.next_sequence('purchase_order');
          insert into public.purchase_orders(name, partner_id, state, warehouse_id, origin)
            values(po_name, pref, 'draft', r.warehouse_id, 'reordering') returning id into po_id;
          created := created + 1;
        end if;
        insert into public.purchase_order_lines(order_id, product_id, variant_id, quantity, unit_price, subtotal)
          select po_id, r.product_id, r.variant_id, needed,
            coalesce((select price from public.product_suppliers where product_id=r.product_id and partner_id=pref order by priority limit 1),0),
            needed * coalesce((select price from public.product_suppliers where product_id=r.product_id and partner_id=pref order by priority limit 1),0);
      end if;
    end if;
    update public.reordering_rules
      set last_run_at = now(),
          next_run_at = now() + (coalesce(r.check_interval_minutes, 60) || ' minutes')::interval
      where id = r.id;
  end loop;
  return created;
end $function$;
