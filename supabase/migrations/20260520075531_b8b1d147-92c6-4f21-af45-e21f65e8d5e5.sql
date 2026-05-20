
-- product_variant_upsert(_variant_id uuid, _product_id uuid, _payload jsonb) returns uuid
CREATE OR REPLACE FUNCTION public.product_variant_upsert(
  _variant_id uuid,
  _product_id uuid,
  _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_sku text := NULLIF(btrim(_payload->>'sku'), '');
  v_barcode text := NULLIF(btrim(_payload->>'barcode'), '');
  v_price_extra numeric := COALESCE((_payload->>'price_extra')::numeric, 0);
  v_active boolean := COALESCE((_payload->>'active')::boolean, true);
  v_weight numeric := NULLIF(_payload->>'weight','')::numeric;
  v_image_url text := NULLIF(btrim(_payload->>'image_url'), '');
  v_has_image_key boolean := _payload ? 'image_url';
BEGIN
  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  -- Uniqueness checks scoped to the same product
  IF v_sku IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE product_id = _product_id
      AND sku = v_sku
      AND (_variant_id IS NULL OR id <> _variant_id)
  ) THEN
    RAISE EXCEPTION 'duplicate_sku';
  END IF;

  IF v_barcode IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE product_id = _product_id
      AND barcode = v_barcode
      AND (_variant_id IS NULL OR id <> _variant_id)
  ) THEN
    RAISE EXCEPTION 'duplicate_barcode';
  END IF;

  IF _variant_id IS NULL THEN
    INSERT INTO public.product_variants (product_id, sku, barcode, price_extra, active, weight, image_url)
    VALUES (_product_id, v_sku, v_barcode, v_price_extra, v_active, v_weight, v_image_url)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.product_variants SET
      sku = CASE WHEN _payload ? 'sku' THEN v_sku ELSE sku END,
      barcode = CASE WHEN _payload ? 'barcode' THEN v_barcode ELSE barcode END,
      price_extra = CASE WHEN _payload ? 'price_extra' THEN v_price_extra ELSE price_extra END,
      active = CASE WHEN _payload ? 'active' THEN v_active ELSE active END,
      weight = CASE WHEN _payload ? 'weight' THEN v_weight ELSE weight END,
      image_url = CASE WHEN v_has_image_key THEN v_image_url ELSE image_url END
    WHERE id = _variant_id AND product_id = _product_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'variant_not_found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- product_variant_delete(_variant_id uuid) returns jsonb
CREATE OR REPLACE FUNCTION public.product_variant_delete(
  _variant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_block text;
BEGIN
  IF _variant_id IS NULL THEN
    RAISE EXCEPTION 'variant_id_required';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.product_variants WHERE id = _variant_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  -- Detect any links that should block deletion
  IF EXISTS (SELECT 1 FROM public.stock_quants WHERE variant_id = _variant_id AND COALESCE(quantity,0) <> 0) THEN
    v_block := 'has_stock';
  ELSIF EXISTS (SELECT 1 FROM public.stock_quants WHERE variant_id = _variant_id AND COALESCE(reserved_quantity,0) <> 0) THEN
    v_block := 'has_reservations';
  ELSIF EXISTS (SELECT 1 FROM public.sale_order_lines WHERE variant_id = _variant_id) THEN
    v_block := 'has_sale_orders';
  ELSIF EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE variant_id = _variant_id) THEN
    v_block := 'has_purchase_orders';
  ELSIF EXISTS (SELECT 1 FROM public.manufacturing_orders WHERE variant_id = _variant_id) THEN
    v_block := 'has_manufacturing_orders';
  ELSIF EXISTS (SELECT 1 FROM public.mo_components WHERE variant_id = _variant_id) THEN
    v_block := 'has_mo_components';
  ELSIF EXISTS (SELECT 1 FROM public.stock_moves WHERE variant_id = _variant_id) THEN
    v_block := 'has_stock_moves';
  ELSIF EXISTS (SELECT 1 FROM public.bom_variant_rules WHERE variant_id = _variant_id) THEN
    v_block := 'has_bom_variant_rules';
  ELSIF EXISTS (SELECT 1 FROM public.boms WHERE variant_id = _variant_id) THEN
    v_block := 'has_boms';
  END IF;

  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block;
  END IF;

  DELETE FROM public.product_variants WHERE id = _variant_id;
  RETURN jsonb_build_object('ok', true, 'variant_id', _variant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.product_variant_upsert(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_variant_delete(uuid) TO authenticated;
