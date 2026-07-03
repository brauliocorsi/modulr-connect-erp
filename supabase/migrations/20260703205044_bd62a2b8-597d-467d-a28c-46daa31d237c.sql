
CREATE OR REPLACE FUNCTION public.create_purchase_need(
  _product uuid,
  _qty numeric,
  _origin purchase_need_origin,
  _sale uuid DEFAULT NULL::uuid,
  _mo uuid DEFAULT NULL::uuid,
  _needed_by date DEFAULT NULL::date,
  _notes text DEFAULT NULL::text,
  _variant uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid; _supplier uuid; _po_name text;
  _dbg_count int;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  IF _sale IS NOT NULL THEN
    SELECT po.name INTO _po_name
      FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po ON po.id = pol.order_id
     WHERE pol.source_sale_order_id = _sale
       AND pol.product_id = _product
       AND COALESCE(pol.variant_id::text,'') = COALESCE(_variant::text,'')
       AND po.state NOT IN ('cancelled','done')
     ORDER BY po.created_at DESC
     LIMIT 1;
    IF _po_name IS NOT NULL THEN
      BEGIN
        PERFORM public.log_record_event('sale_order', _sale,
          format('supply já em curso via PO %s', _po_name),
          jsonb_build_object('product_id',_product,'variant_id',_variant,'po_name',_po_name));
      EXCEPTION WHEN OTHERS THEN NULL; END;
      RETURN NULL;
    END IF;
  END IF;

  -- Dedupe
  SELECT count(*) INTO _dbg_count FROM public.purchase_needs
   WHERE product_id = _product
     AND COALESCE(product_variant_id::text,'') = COALESCE(_variant::text,'')
     AND origin_kind = _origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(_sale::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(_mo::text,'');

  RAISE NOTICE 'create_purchase_need dedupe: product=% variant=% origin=% sale=% mo=% -> match_count=%',
    _product, _variant, _origin, _sale, _mo, _dbg_count;

  SELECT id INTO _id FROM public.purchase_needs
   WHERE product_id = _product
     AND COALESCE(product_variant_id::text,'') = COALESCE(_variant::text,'')
     AND origin_kind = _origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(_sale::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(_mo::text,'')
   LIMIT 1;
  IF _id IS NOT NULL THEN
    RAISE NOTICE '  -> returning existing id=%', _id;
    RETURN _id;
  END IF;

  SELECT partner_id INTO _supplier FROM public.product_suppliers
    WHERE product_id = _product ORDER BY priority NULLS LAST LIMIT 1;

  RAISE NOTICE '  -> INSERTING new need';
  INSERT INTO public.purchase_needs(product_id, product_variant_id, qty_needed, origin_kind,
       sale_order_id, manufacturing_order_id, suggested_partner_id, needed_by, notes)
  VALUES (_product, _variant, _qty, _origin, _sale, _mo, _supplier, _needed_by, _notes)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;
