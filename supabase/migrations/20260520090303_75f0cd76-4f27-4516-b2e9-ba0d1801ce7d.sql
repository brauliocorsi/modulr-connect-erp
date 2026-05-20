
-- ============ product_package_template_upsert ============
CREATE OR REPLACE FUNCTION public.product_package_template_upsert(
  _template_id uuid,
  _product_id uuid,
  _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_len numeric;
  v_wid numeric;
  v_hei numeric;
  v_weight numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_name := COALESCE(_payload->>'name', '');
  IF length(trim(v_name)) = 0 THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;

  v_len := NULLIF(_payload->>'default_length_cm','')::numeric;
  v_wid := NULLIF(_payload->>'default_width_cm','')::numeric;
  v_hei := NULLIF(_payload->>'default_height_cm','')::numeric;
  v_weight := NULLIF(_payload->>'default_weight_kg','')::numeric;

  IF v_len IS NOT NULL AND v_len <= 0 THEN RAISE EXCEPTION 'invalid_length' USING ERRCODE='P0001'; END IF;
  IF v_wid IS NOT NULL AND v_wid <= 0 THEN RAISE EXCEPTION 'invalid_width' USING ERRCODE='P0001'; END IF;
  IF v_hei IS NOT NULL AND v_hei <= 0 THEN RAISE EXCEPTION 'invalid_height' USING ERRCODE='P0001'; END IF;
  IF v_weight IS NOT NULL AND v_weight < 0 THEN RAISE EXCEPTION 'invalid_weight' USING ERRCODE='P0001'; END IF;

  IF _template_id IS NULL THEN
    INSERT INTO product_package_templates (
      product_id, name, description,
      package_sequence, package_total, package_group,
      default_length_cm, default_width_cm, default_height_cm,
      default_weight_kg, default_assembly_minutes,
      stackable, fragile, requires_flat_transport, requires_assembly,
      is_required, barcode_pattern, active
    ) VALUES (
      _product_id,
      v_name,
      _payload->>'description',
      COALESCE((_payload->>'package_sequence')::int, 1),
      COALESCE((_payload->>'package_total')::int, 1),
      _payload->>'package_group',
      v_len, v_wid, v_hei,
      v_weight,
      NULLIF(_payload->>'default_assembly_minutes','')::int,
      COALESCE((_payload->>'stackable')::boolean, false),
      COALESCE((_payload->>'fragile')::boolean, false),
      COALESCE((_payload->>'requires_flat_transport')::boolean, false),
      COALESCE((_payload->>'requires_assembly')::boolean, false),
      COALESCE((_payload->>'is_required')::boolean, true),
      _payload->>'barcode_pattern',
      COALESCE((_payload->>'active')::boolean, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE product_package_templates SET
      name = v_name,
      description = COALESCE(_payload->>'description', description),
      package_sequence = COALESCE((_payload->>'package_sequence')::int, package_sequence),
      package_total = COALESCE((_payload->>'package_total')::int, package_total),
      package_group = COALESCE(_payload->>'package_group', package_group),
      default_length_cm = COALESCE(v_len, default_length_cm),
      default_width_cm = COALESCE(v_wid, default_width_cm),
      default_height_cm = COALESCE(v_hei, default_height_cm),
      default_weight_kg = COALESCE(v_weight, default_weight_kg),
      default_assembly_minutes = COALESCE(NULLIF(_payload->>'default_assembly_minutes','')::int, default_assembly_minutes),
      stackable = COALESCE((_payload->>'stackable')::boolean, stackable),
      fragile = COALESCE((_payload->>'fragile')::boolean, fragile),
      requires_flat_transport = COALESCE((_payload->>'requires_flat_transport')::boolean, requires_flat_transport),
      requires_assembly = COALESCE((_payload->>'requires_assembly')::boolean, requires_assembly),
      is_required = COALESCE((_payload->>'is_required')::boolean, is_required),
      barcode_pattern = COALESCE(_payload->>'barcode_pattern', barcode_pattern),
      active = COALESCE((_payload->>'active')::boolean, active),
      updated_at = now()
    WHERE id = _template_id AND product_id = _product_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ============ product_package_template_delete ============
CREATE OR REPLACE FUNCTION public.product_package_template_delete(
  _template_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_used int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_package_templates WHERE id = _template_id) THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_used FROM stock_packages WHERE package_template_id = _template_id;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'template_in_use' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM product_package_templates WHERE id = _template_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============ product_template_attribute_upsert ============
CREATE OR REPLACE FUNCTION public.product_template_attribute_upsert(
  _attribute_id uuid,
  _product_id uuid,
  _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_attr uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;
  v_attr := NULLIF(_payload->>'attribute_id','')::uuid;
  IF _attribute_id IS NULL THEN
    IF v_attr IS NULL THEN RAISE EXCEPTION 'attribute_id_required' USING ERRCODE='P0001'; END IF;
    IF EXISTS (SELECT 1 FROM product_template_attributes WHERE product_id=_product_id AND attribute_id=v_attr) THEN
      SELECT id INTO v_id FROM product_template_attributes WHERE product_id=_product_id AND attribute_id=v_attr;
      RETURN v_id;
    END IF;
    INSERT INTO product_template_attributes (product_id, attribute_id) VALUES (_product_id, v_attr) RETURNING id INTO v_id;
  ELSE
    -- only attribute_id can change; rare
    UPDATE product_template_attributes SET attribute_id = COALESCE(v_attr, attribute_id)
    WHERE id = _attribute_id AND product_id = _product_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'template_attribute_not_found' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ============ product_template_attribute_delete ============
CREATE OR REPLACE FUNCTION public.product_template_attribute_delete(
  _attribute_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_used int;
  v_attr_id uuid;
  v_product_id uuid;
BEGIN
  SELECT attribute_id, product_id INTO v_attr_id, v_product_id
  FROM product_template_attributes WHERE id = _attribute_id;
  IF v_attr_id IS NULL THEN RAISE EXCEPTION 'template_attribute_not_found' USING ERRCODE='P0001'; END IF;

  SELECT count(*) INTO v_used FROM product_variant_values pvv
    JOIN product_attribute_values pav ON pav.id = pvv.value_id
    JOIN product_variants pv ON pv.id = pvv.variant_id
    WHERE pv.product_id = v_product_id AND pav.attribute_id = v_attr_id;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'attribute_in_use_by_variants' USING ERRCODE='P0001';
  END IF;

  DELETE FROM product_template_attribute_values WHERE template_attribute_id = _attribute_id;
  DELETE FROM product_template_attributes WHERE id = _attribute_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============ product_template_attribute_value_upsert ============
CREATE OR REPLACE FUNCTION public.product_template_attribute_value_upsert(
  _value_id uuid,
  _template_attribute_id uuid,
  _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_value uuid;
  v_price numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_template_attributes WHERE id = _template_attribute_id) THEN
    RAISE EXCEPTION 'template_attribute_not_found' USING ERRCODE='P0001';
  END IF;
  v_value := NULLIF(_payload->>'value_id','')::uuid;
  v_price := COALESCE(NULLIF(_payload->>'price_extra','')::numeric, 0);

  IF _value_id IS NULL THEN
    IF v_value IS NULL THEN RAISE EXCEPTION 'value_id_required' USING ERRCODE='P0001'; END IF;
    IF EXISTS (SELECT 1 FROM product_template_attribute_values WHERE template_attribute_id=_template_attribute_id AND value_id=v_value) THEN
      SELECT id INTO v_id FROM product_template_attribute_values WHERE template_attribute_id=_template_attribute_id AND value_id=v_value;
      UPDATE product_template_attribute_values SET price_extra = v_price WHERE id = v_id;
      RETURN v_id;
    END IF;
    INSERT INTO product_template_attribute_values (template_attribute_id, value_id, price_extra)
    VALUES (_template_attribute_id, v_value, v_price) RETURNING id INTO v_id;
  ELSE
    UPDATE product_template_attribute_values SET
      price_extra = v_price
    WHERE id = _value_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'attribute_value_not_found' USING ERRCODE='P0001'; END IF;
  END IF;
  RETURN v_id;
END $$;

-- ============ product_template_attribute_value_delete ============
CREATE OR REPLACE FUNCTION public.product_template_attribute_value_delete(
  _value_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_used int;
  v_ta_id uuid;
  v_val uuid;
  v_product uuid;
BEGIN
  SELECT template_attribute_id, value_id INTO v_ta_id, v_val
  FROM product_template_attribute_values WHERE id = _value_id;
  IF v_ta_id IS NULL THEN RAISE EXCEPTION 'attribute_value_not_found' USING ERRCODE='P0001'; END IF;
  SELECT product_id INTO v_product FROM product_template_attributes WHERE id = v_ta_id;

  SELECT count(*) INTO v_used FROM product_variant_values pvv
    JOIN product_variants pv ON pv.id = pvv.variant_id
    WHERE pv.product_id = v_product AND pvv.value_id = v_val;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'value_in_use_by_variants' USING ERRCODE='P0001';
  END IF;

  DELETE FROM product_template_attribute_values WHERE id = _value_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============ product_template_attribute_value_delete_pair (helper for legacy toggle) ============
CREATE OR REPLACE FUNCTION public.product_template_attribute_value_delete_pair(
  _template_attribute_id uuid,
  _value_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row uuid;
BEGIN
  SELECT id INTO v_row FROM product_template_attribute_values
    WHERE template_attribute_id = _template_attribute_id AND value_id = _value_id;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok', true); END IF;
  RETURN public.product_template_attribute_value_delete(v_row);
END $$;

-- ============ product_stock_summary (read-only) ============
CREATE OR REPLACE FUNCTION public.product_stock_summary(_product_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (
    SELECT
      COALESCE(SUM(quantity),0) AS total_on_hand,
      COALESCE(SUM(reserved_quantity),0) AS total_reserved,
      COUNT(DISTINCT variant_id) FILTER (WHERE quantity > 0 AND variant_id IS NOT NULL) AS variants_with_stock
    FROM stock_quants WHERE product_id = _product_id
  ),
  p AS (
    SELECT
      COUNT(*) AS packages_count,
      COUNT(*) FILTER (WHERE condition = 'damaged') AS damaged_count,
      COUNT(*) FILTER (WHERE condition = 'quarantine') AS quarantine_count,
      COUNT(*) FILTER (WHERE condition = 'repaired') AS repaired_count,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS scrap_count
    FROM stock_packages WHERE product_id = _product_id AND is_virtual = false
  )
  SELECT jsonb_build_object(
    'total_on_hand', q.total_on_hand,
    'total_reserved', q.total_reserved,
    'total_available', GREATEST(q.total_on_hand - q.total_reserved, 0),
    'variants_with_stock', q.variants_with_stock,
    'packages_count', p.packages_count,
    'damaged_count', p.damaged_count,
    'quarantine_count', p.quarantine_count,
    'repaired_count', p.repaired_count,
    'scrap_count', p.scrap_count
  ) FROM q, p;
$$;

GRANT EXECUTE ON FUNCTION public.product_package_template_upsert(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_package_template_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_template_attribute_upsert(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_template_attribute_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_template_attribute_value_upsert(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_template_attribute_value_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_template_attribute_value_delete_pair(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_stock_summary(uuid) TO authenticated;
