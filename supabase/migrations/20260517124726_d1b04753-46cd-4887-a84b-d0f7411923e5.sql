-- =========================================================================
-- UI-16.BC.2 (retry) — same as previous attempt, RAISE format fixed
-- =========================================================================

CREATE OR REPLACE FUNCTION public.bom_upsert_variant_rule(
  p_id                   uuid,
  p_bom_id               uuid,
  p_product_id           uuid,
  p_variant_id           uuid,
  p_attribute_name       text,
  p_attribute_value      text,
  p_rule_type            text,
  p_source_component_id  uuid,
  p_target_component_id  uuid,
  p_qty                  numeric,
  p_uom_id               uuid,
  p_formula              text,
  p_priority             integer,
  p_active               boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_has_criterion boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: not authenticated' USING ERRCODE='28000';
  END IF;
  IF p_id IS NULL THEN
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'create'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_variant_rule: missing permission products.boms.create' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'edit'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_variant_rule: missing permission products.boms.edit' USING ERRCODE='42501';
    END IF;
  END IF;

  IF p_bom_id IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: bom_id is required' USING ERRCODE='22023';
  END IF;
  IF p_priority IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: priority is required' USING ERRCODE='22023';
  END IF;
  IF p_rule_type IS NULL OR p_rule_type NOT IN (
    'add_component','replace_component','remove_component','change_qty','change_formula','change_operation'
  ) THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: invalid rule_type %', p_rule_type USING ERRCODE='22023';
  END IF;

  v_has_criterion := (
    p_variant_id IS NOT NULL
    OR (p_attribute_name IS NOT NULL AND length(trim(p_attribute_name)) > 0
        AND p_attribute_value IS NOT NULL AND length(trim(p_attribute_value)) > 0)
    OR p_source_component_id IS NOT NULL
    OR p_target_component_id IS NOT NULL
  );
  IF NOT v_has_criterion THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: at least one criterion required (variant_id, attribute_name+value or source/target component)' USING ERRCODE='22023';
  END IF;

  IF p_qty IS NOT NULL AND p_qty < 0 THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: qty cannot be negative' USING ERRCODE='22023';
  END IF;

  IF p_formula IS NOT NULL AND length(trim(p_formula)) > 0 AND p_formula ~ '[;]|--' THEN
    RAISE EXCEPTION 'bom_upsert_variant_rule: formula contains forbidden tokens' USING ERRCODE='22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.bom_variant_rules(
      bom_id, product_id, variant_id,
      attribute_name, attribute_value, rule_type,
      source_component_id, target_component_id,
      qty, uom_id, formula, priority, active
    ) VALUES (
      p_bom_id, p_product_id, p_variant_id,
      NULLIF(p_attribute_name,''), NULLIF(p_attribute_value,''), p_rule_type,
      p_source_component_id, p_target_component_id,
      p_qty, p_uom_id, NULLIF(p_formula,''), p_priority, COALESCE(p_active,true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.bom_variant_rules SET
      bom_id              = p_bom_id,
      product_id          = p_product_id,
      variant_id          = p_variant_id,
      attribute_name      = NULLIF(p_attribute_name,''),
      attribute_value     = NULLIF(p_attribute_value,''),
      rule_type           = p_rule_type,
      source_component_id = p_source_component_id,
      target_component_id = p_target_component_id,
      qty                 = p_qty,
      uom_id              = p_uom_id,
      formula             = NULLIF(p_formula,''),
      priority            = p_priority,
      active              = COALESCE(p_active,true),
      updated_at          = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_variant_rule: rule % not found', p_id USING ERRCODE='P0002';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bom_upsert_variant_rule(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,numeric,uuid,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_upsert_variant_rule(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,numeric,uuid,text,integer,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.bom_delete_variant_rule(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_delete_variant_rule: not authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'delete'::permission_action) THEN
    RAISE EXCEPTION 'bom_delete_variant_rule: missing permission products.boms.delete' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'bom_delete_variant_rule: id is required' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.bom_variant_rules WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_delete_variant_rule: rule % not found', p_id USING ERRCODE='P0002';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bom_delete_variant_rule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_delete_variant_rule(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bom_upsert_output(
  p_id              uuid,
  p_bom_id          uuid,
  p_bom_line_id     uuid,
  p_product_id      uuid,
  p_output_type     text,
  p_qty             numeric,
  p_uom_id          uuid,
  p_formula         text,
  p_cost_allocation_percent numeric,
  p_stockable       boolean,
  p_condition       text,
  p_operation_id    uuid,
  p_work_center_id  uuid,
  p_active          boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_sum_others numeric;
  v_total numeric;
  v_active boolean := COALESCE(p_active, true);
  v_stockable boolean := COALESCE(p_stockable, false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_output: not authenticated' USING ERRCODE='28000';
  END IF;
  IF p_id IS NULL THEN
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'create'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_output: missing permission products.boms.create' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'edit'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_output: missing permission products.boms.edit' USING ERRCODE='42501';
    END IF;
  END IF;

  IF p_bom_id IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_output: bom_id is required' USING ERRCODE='22023';
  END IF;
  IF p_output_type IS NULL OR p_output_type NOT IN (
    'main_product','co_product','byproduct','reusable_scrap','waste'
  ) THEN
    RAISE EXCEPTION 'bom_upsert_output: invalid output_type %', p_output_type USING ERRCODE='22023';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_output: product_id is required (schema NOT NULL)' USING ERRCODE='22023';
  END IF;
  IF p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'bom_upsert_output: qty must be >= 0' USING ERRCODE='22023';
  END IF;
  IF p_output_type = 'waste' AND v_stockable IS TRUE THEN
    RAISE EXCEPTION 'bom_upsert_output: waste outputs cannot be stockable' USING ERRCODE='22023';
  END IF;
  IF p_cost_allocation_percent IS NOT NULL
     AND (p_cost_allocation_percent < 0 OR p_cost_allocation_percent > 100) THEN
    RAISE EXCEPTION 'bom_upsert_output: cost_allocation_percent must be between 0 and 100' USING ERRCODE='22023';
  END IF;
  IF p_formula IS NOT NULL AND length(trim(p_formula)) > 0 AND p_formula ~ '[;]|--' THEN
    RAISE EXCEPTION 'bom_upsert_output: formula contains forbidden tokens' USING ERRCODE='22023';
  END IF;

  IF v_active AND p_cost_allocation_percent IS NOT NULL THEN
    SELECT COALESCE(SUM(cost_allocation_percent),0)
      INTO v_sum_others
      FROM public.manufacturing_bom_outputs
     WHERE bom_id = p_bom_id
       AND active = true
       AND (p_id IS NULL OR id <> p_id)
       AND cost_allocation_percent IS NOT NULL;
    v_total := v_sum_others + p_cost_allocation_percent;
    IF v_total > 100.00001 THEN
      RAISE EXCEPTION 'bom_upsert_output: total cost_allocation_percent would be % (max 100)', v_total USING ERRCODE='22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.manufacturing_bom_outputs(
      bom_id, bom_line_id, product_id, output_type,
      qty, uom_id, formula, cost_allocation_percent,
      stockable, condition, operation_id, work_center_id, active
    ) VALUES (
      p_bom_id, p_bom_line_id, p_product_id, p_output_type,
      p_qty, p_uom_id, NULLIF(p_formula,''), p_cost_allocation_percent,
      v_stockable, COALESCE(NULLIF(p_condition,''),'always'),
      p_operation_id, p_work_center_id, v_active
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.manufacturing_bom_outputs SET
      bom_id                  = p_bom_id,
      bom_line_id             = p_bom_line_id,
      product_id              = p_product_id,
      output_type             = p_output_type,
      qty                     = p_qty,
      uom_id                  = p_uom_id,
      formula                 = NULLIF(p_formula,''),
      cost_allocation_percent = p_cost_allocation_percent,
      stockable               = v_stockable,
      condition               = COALESCE(NULLIF(p_condition,''),'always'),
      operation_id            = p_operation_id,
      work_center_id          = p_work_center_id,
      active                  = v_active,
      updated_at              = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_output: output % not found', p_id USING ERRCODE='P0002';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bom_upsert_output(uuid,uuid,uuid,uuid,text,numeric,uuid,text,numeric,boolean,text,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_upsert_output(uuid,uuid,uuid,uuid,text,numeric,uuid,text,numeric,boolean,text,uuid,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.bom_delete_output(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_delete_output: not authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'delete'::permission_action) THEN
    RAISE EXCEPTION 'bom_delete_output: missing permission products.boms.delete' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'bom_delete_output: id is required' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.manufacturing_bom_outputs WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_delete_output: output % not found', p_id USING ERRCODE='P0002';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bom_delete_output(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_delete_output(uuid) TO authenticated;