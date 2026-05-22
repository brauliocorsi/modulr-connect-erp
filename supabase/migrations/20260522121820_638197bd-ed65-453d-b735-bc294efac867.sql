CREATE OR REPLACE FUNCTION public.product_upsert(_product_id uuid DEFAULT NULL::uuid, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_can_mfg := coalesce((_payload->>'can_be_manufactured')::boolean,
                        case when _product_id is not null then
                          (select can_be_manufactured from public.products where id = _product_id)
                        else false end);
  v_requires_bom := coalesce((_payload->>'requires_bom')::boolean, false);
  if v_requires_bom and not v_can_mfg then
    _payload := jsonb_set(_payload, '{requires_bom}', 'false'::jsonb);
  end if;

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
    if v_rec.id is null then
      v_rec.id := gen_random_uuid();
    end if;
    if v_rec.created_at is null then
      v_rec.created_at := now();
    end if;
    v_rec.updated_at := now();
    insert into public.products select v_rec.*;
    v_id := v_rec.id;
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
      updated_at = v_rec.updated_at
    where id = _product_id;
    v_id := _product_id;
  end if;

  return v_id;
end;
$function$;