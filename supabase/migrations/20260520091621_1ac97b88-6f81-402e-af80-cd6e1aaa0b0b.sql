
-- F22-R6.1: product_upsert + product_archive RPCs

create or replace function public.product_upsert(
  _product_id uuid default null,
  _payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rec public.products%rowtype;
  v_name text;
  v_sku text;
  v_ean text;
  v_can_mfg boolean;
  v_requires_bom boolean;
  v_pkg_tracking boolean;
  v_pkg_existing boolean;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  -- Strip fields we never want callers to write directly.
  _payload := _payload
    - 'id' - 'created_at' - 'updated_at'
    - 'woo_product_id' - 'woo_last_sync_at' - 'woo_sync_status';

  v_name := nullif(trim(coalesce(_payload->>'name','')), '');
  if v_name is null then
    raise exception 'name_required';
  end if;

  v_sku := nullif(trim(coalesce(_payload->>'internal_ref','')), '');
  v_ean := nullif(trim(coalesce(_payload->>'barcode','')), '');
  _payload := jsonb_set(_payload, '{internal_ref}', to_jsonb(v_sku));
  _payload := jsonb_set(_payload, '{barcode}', to_jsonb(v_ean));

  -- Uniqueness pre-check (also enforced by indexes).
  if v_sku is not null and exists (
    select 1 from public.products
    where internal_ref = v_sku
      and (_product_id is null or id <> _product_id)
  ) then
    raise exception 'sku_conflict';
  end if;
  if v_ean is not null and exists (
    select 1 from public.products
    where barcode = v_ean
      and (_product_id is null or id <> _product_id)
  ) then
    raise exception 'ean_conflict';
  end if;

  -- Flag coherence: requires_bom only if can_be_manufactured.
  v_can_mfg := coalesce((_payload->>'can_be_manufactured')::boolean,
                        case when _product_id is not null then
                          (select can_be_manufactured from public.products where id = _product_id)
                        else false end);
  v_requires_bom := coalesce((_payload->>'requires_bom')::boolean, false);
  if v_requires_bom and not v_can_mfg then
    _payload := jsonb_set(_payload, '{requires_bom}', 'false'::jsonb);
  end if;

  -- package_tracking cannot be turned off while active packages exist.
  if _product_id is not null and (_payload ? 'package_tracking_enabled') then
    v_pkg_tracking := (_payload->>'package_tracking_enabled')::boolean;
    if not v_pkg_tracking then
      select exists(
        select 1 from public.stock_packages
        where product_id = _product_id
          and coalesce(status,'') not in ('returned','consumed','cancelled')
      ) into v_pkg_existing;
      if v_pkg_existing then
        raise exception 'has_active_packages';
      end if;
    end if;
  end if;

  if _product_id is null then
    select * into v_rec from jsonb_populate_record(null::public.products, _payload);
    insert into public.products select v_rec.*;
    v_id := v_rec.id;
    if v_id is null then
      select id into v_id from public.products
       where name = v_name
       order by created_at desc limit 1;
    end if;
  else
    if not exists(select 1 from public.products where id = _product_id) then
      raise exception 'product_not_found';
    end if;
    select * into v_rec from public.products where id = _product_id;
    select * into v_rec from jsonb_populate_record(v_rec, _payload);
    v_rec.id := _product_id;
    v_rec.updated_at := now();
    update public.products set
      name = v_rec.name,
      internal_ref = v_rec.internal_ref,
      barcode = v_rec.barcode,
      type = v_rec.type,
      category_id = v_rec.category_id,
      uom_id = v_rec.uom_id,
      purchase_uom_id = v_rec.purchase_uom_id,
      list_price = v_rec.list_price,
      standard_cost = v_rec.standard_cost,
      weight = v_rec.weight,
      gross_weight = v_rec.gross_weight,
      net_weight = v_rec.net_weight,
      volume = v_rec.volume,
      height = v_rec.height,
      width = v_rec.width,
      depth = v_rec.depth,
      description = v_rec.description,
      short_description = v_rec.short_description,
      sales_description = v_rec.sales_description,
      purchase_description = v_rec.purchase_description,
      image_url = v_rec.image_url,
      can_be_sold = v_rec.can_be_sold,
      can_be_purchased = v_rec.can_be_purchased,
      can_be_manufactured = v_rec.can_be_manufactured,
      active = v_rec.active,
      tracking = v_rec.tracking,
      published_woo = v_rec.published_woo,
      woo_slug = v_rec.woo_slug,
      woo_status = v_rec.woo_status,
      auto_purchase = v_rec.auto_purchase,
      assembly_fee = v_rec.assembly_fee,
      delivery_surcharge = v_rec.delivery_surcharge,
      assembly_minutes = v_rec.assembly_minutes,
      product_kind = v_rec.product_kind,
      requires_bom = v_rec.requires_bom,
      mfg_lead_time_days = v_rec.mfg_lead_time_days,
      purchase_lead_time_days = v_rec.purchase_lead_time_days,
      min_stock = v_rec.min_stock,
      max_stock = v_rec.max_stock,
      package_tracking_enabled = v_rec.package_tracking_enabled,
      allocation_policy = v_rec.allocation_policy,
      allocation_priority_weights = v_rec.allocation_priority_weights,
      supply_route = v_rec.supply_route,
      supply_priority = v_rec.supply_priority,
      component_allocation_policy = v_rec.component_allocation_policy,
      updated_at = now()
    where id = _product_id;
    v_id := _product_id;
  end if;

  return v_id;
exception
  when unique_violation then
    if sqlerrm ilike '%internal_ref%' then raise exception 'sku_conflict';
    elsif sqlerrm ilike '%barcode%' then raise exception 'ean_conflict';
    else raise; end if;
end;
$$;

create or replace function public.product_archive(
  _product_id uuid,
  _reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
  v_pkgs int;
  v_boms int;
  v_mos int;
  v_pns int;
  v_sols int;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;
  if not exists(select 1 from public.products where id = _product_id) then
    raise exception 'product_not_found';
  end if;

  select coalesce(sum(qty),0) into v_stock
    from public.stock_quants where product_id = _product_id;
  if v_stock > 0 then raise exception 'has_stock'; end if;

  select count(*) into v_pkgs from public.stock_packages
    where product_id = _product_id
      and coalesce(status,'') not in ('returned','consumed','cancelled');
  if v_pkgs > 0 then raise exception 'has_active_packages'; end if;

  select count(*) into v_boms from public.boms
    where product_id = _product_id and active = true;
  if v_boms > 0 then raise exception 'has_active_bom'; end if;

  select count(*) into v_mos from public.manufacturing_orders
    where product_id = _product_id and state not in ('done','cancelled');
  if v_mos > 0 then raise exception 'has_open_mo'; end if;

  select count(*) into v_pns from public.purchase_needs
    where product_id = _product_id and state not in ('received','cancelled');
  if v_pns > 0 then raise exception 'has_open_purchase'; end if;

  select count(*) into v_sols
    from public.sale_order_lines sol
    join public.sale_orders so on so.id = sol.order_id
   where sol.product_id = _product_id
     and so.state not in ('done','cancelled');
  if v_sols > 0 then raise exception 'has_open_sales'; end if;

  update public.products
    set active = false, updated_at = now()
    where id = _product_id;

  return jsonb_build_object('id', _product_id, 'archived', true, 'reason', _reason);
end;
$$;

grant execute on function public.product_upsert(uuid, jsonb) to authenticated;
grant execute on function public.product_archive(uuid, text) to authenticated;
