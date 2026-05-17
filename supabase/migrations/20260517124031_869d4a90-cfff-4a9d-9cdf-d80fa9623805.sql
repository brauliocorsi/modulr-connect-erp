-- =========================================================================
-- UI-16.BC.1 — Additive migration: 3 nullable columns + indexes on bom_lines
-- + 3 secure RPCs for BOM editing (replace direct frontend writes).
-- No triggers. No backfill. No defaults. No changes to close_mo,
-- mfg_create_mo_for_line, purchase_needs, stock or reservations.
-- =========================================================================

ALTER TABLE public.bom_lines
  ADD COLUMN IF NOT EXISTS operation_id    uuid NULL REFERENCES public.bom_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_center_id  uuid NULL REFERENCES public.work_centers(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_critical     boolean NULL;

CREATE INDEX IF NOT EXISTS idx_bom_lines_operation_id    ON public.bom_lines(operation_id)   WHERE operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bom_lines_work_center_id  ON public.bom_lines(work_center_id) WHERE work_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bom_lines_is_critical     ON public.bom_lines(is_critical)    WHERE is_critical IS TRUE;

-- =========================================================================
-- RPC: bom_upsert_master
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bom_upsert_master(
  p_id                     uuid,
  p_product_id             uuid,
  p_variant_id             uuid,
  p_code                   text,
  p_type                   text,
  p_quantity               numeric,
  p_uom_id                 uuid,
  p_active                 boolean,
  p_parent_bom_id          uuid,
  p_inheritance_mode       text,
  p_is_master              boolean,
  p_applies_to_product_id  uuid,
  p_applies_to_variant_id  uuid,
  p_variant_rule           jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_cur   uuid;
  v_depth int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_master: not authenticated' USING ERRCODE='28000';
  END IF;

  IF p_id IS NULL THEN
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'create'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_master: missing permission products.boms.create' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'edit'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_master: missing permission products.boms.edit' USING ERRCODE='42501';
    END IF;
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_master: product_id is required' USING ERRCODE='22023';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('normal','phantom','subcontract') THEN
    RAISE EXCEPTION 'bom_upsert_master: invalid type %', p_type USING ERRCODE='22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'bom_upsert_master: quantity must be > 0' USING ERRCODE='22023';
  END IF;
  IF p_inheritance_mode IS NULL OR p_inheritance_mode NOT IN ('inherit','override','extend') THEN
    RAISE EXCEPTION 'bom_upsert_master: invalid inheritance_mode %', p_inheritance_mode USING ERRCODE='22023';
  END IF;

  -- Cycle check on parent chain (depth limit 5)
  IF p_parent_bom_id IS NOT NULL THEN
    IF p_id IS NOT NULL AND p_parent_bom_id = p_id THEN
      RAISE EXCEPTION 'bom_upsert_master: parent_bom_id cannot equal id' USING ERRCODE='22023';
    END IF;
    v_cur := p_parent_bom_id;
    WHILE v_cur IS NOT NULL AND v_depth < 6 LOOP
      IF p_id IS NOT NULL AND v_cur = p_id THEN
        RAISE EXCEPTION 'bom_upsert_master: cycle detected in parent chain' USING ERRCODE='22023';
      END IF;
      SELECT parent_bom_id INTO v_cur FROM public.boms WHERE id = v_cur;
      v_depth := v_depth + 1;
    END LOOP;
    IF v_depth >= 6 THEN
      RAISE EXCEPTION 'bom_upsert_master: parent chain exceeds max depth 5' USING ERRCODE='22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.boms(
      product_id, variant_id, code, type, quantity, uom_id, active,
      parent_bom_id, inheritance_mode, is_master,
      applies_to_product_id, applies_to_variant_id, variant_rule
    ) VALUES (
      p_product_id, p_variant_id, NULLIF(p_code,''), p_type::bom_type, p_quantity, p_uom_id, COALESCE(p_active,true),
      p_parent_bom_id, p_inheritance_mode, COALESCE(p_is_master,false),
      p_applies_to_product_id, p_applies_to_variant_id, p_variant_rule
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.boms SET
      product_id            = p_product_id,
      variant_id            = p_variant_id,
      code                  = NULLIF(p_code,''),
      type                  = p_type::bom_type,
      quantity              = p_quantity,
      uom_id                = p_uom_id,
      active                = COALESCE(p_active,true),
      parent_bom_id         = p_parent_bom_id,
      inheritance_mode      = p_inheritance_mode,
      is_master             = COALESCE(p_is_master,false),
      applies_to_product_id = p_applies_to_product_id,
      applies_to_variant_id = p_applies_to_variant_id,
      variant_rule          = p_variant_rule
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_master: bom % not found', p_id USING ERRCODE='P0002';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bom_upsert_master(uuid,uuid,uuid,text,text,numeric,uuid,boolean,uuid,text,boolean,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_upsert_master(uuid,uuid,uuid,text,text,numeric,uuid,boolean,uuid,text,boolean,uuid,uuid,jsonb) TO authenticated;

-- =========================================================================
-- RPC: bom_upsert_line
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bom_upsert_line(
  p_id                  uuid,
  p_bom_id              uuid,
  p_component_product_id uuid,
  p_component_variant_id uuid,
  p_quantity            numeric,
  p_uom_id              uuid,
  p_sequence            integer,
  p_parent_bom_line_id  uuid,
  p_inheritance_action  text,
  p_is_optional         boolean,
  p_is_critical         boolean,
  p_formula             text,
  p_qty_formula         text,
  p_formula_variables   jsonb,
  p_consumption_uom_id  uuid,
  p_conversion_factor   numeric,
  p_rounding_method     text,
  p_operation_id        uuid,
  p_work_center_id      uuid,
  p_applies_to_variant_rule jsonb,
  p_component_selector  jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_parent_component uuid;
  v_parent_uom       uuid;
  v_eff_component    uuid;
  v_eff_quantity     numeric;
  v_eff_uom          uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_line: not authenticated' USING ERRCODE='28000';
  END IF;

  IF p_id IS NULL THEN
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'create'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_line: missing permission products.boms.create' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'edit'::permission_action) THEN
      RAISE EXCEPTION 'bom_upsert_line: missing permission products.boms.edit' USING ERRCODE='42501';
    END IF;
  END IF;

  IF p_bom_id IS NULL THEN
    RAISE EXCEPTION 'bom_upsert_line: bom_id is required' USING ERRCODE='22023';
  END IF;

  IF p_inheritance_action IS NULL OR p_inheritance_action NOT IN ('own','add','override','remove') THEN
    RAISE EXCEPTION 'bom_upsert_line: inheritance_action must be one of own/add/override/remove (got %)', p_inheritance_action USING ERRCODE='22023';
  END IF;

  IF p_rounding_method IS NOT NULL
     AND p_rounding_method NOT IN ('exact','round_up','round_down','package_multiple') THEN
    RAISE EXCEPTION 'bom_upsert_line: invalid rounding_method %', p_rounding_method USING ERRCODE='22023';
  END IF;

  IF p_inheritance_action IN ('override','remove') THEN
    IF p_parent_bom_line_id IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_line: parent_bom_line_id required for action %', p_inheritance_action USING ERRCODE='22023';
    END IF;
    SELECT component_product_id, uom_id
      INTO v_parent_component, v_parent_uom
      FROM public.bom_lines WHERE id = p_parent_bom_line_id;
    IF v_parent_component IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_line: parent line % not found', p_parent_bom_line_id USING ERRCODE='P0002';
    END IF;
  END IF;

  -- Resolve effective component / qty / uom by action
  IF p_inheritance_action = 'remove' THEN
    v_eff_component := v_parent_component;     -- satisfies NOT NULL; resolver ignores remove lines
    v_eff_quantity  := 0;
    v_eff_uom       := COALESCE(p_uom_id, v_parent_uom);
  ELSE
    v_eff_component := p_component_product_id;
    v_eff_quantity  := COALESCE(p_quantity, 0);
    v_eff_uom       := p_uom_id;
    IF v_eff_component IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_line: component_product_id is required for action %', p_inheritance_action USING ERRCODE='22023';
    END IF;
    IF v_eff_quantity < 0 THEN
      RAISE EXCEPTION 'bom_upsert_line: quantity cannot be negative' USING ERRCODE='22023';
    END IF;
  END IF;

  -- Light formula syntax check
  IF p_formula IS NOT NULL AND length(trim(p_formula)) > 0 THEN
    IF p_formula ~ '[;]|--' THEN
      RAISE EXCEPTION 'bom_upsert_line: formula contains forbidden tokens' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_qty_formula IS NOT NULL AND length(trim(p_qty_formula)) > 0 THEN
    IF p_qty_formula ~ '[;]|--' THEN
      RAISE EXCEPTION 'bom_upsert_line: qty_formula contains forbidden tokens' USING ERRCODE='22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.bom_lines(
      bom_id, component_product_id, component_variant_id,
      quantity, uom_id, sequence,
      parent_bom_line_id, inheritance_action, is_inherited,
      is_optional, is_critical,
      formula, qty_formula, formula_variables,
      consumption_uom_id, conversion_factor, rounding_method,
      operation_id, work_center_id,
      applies_to_variant_rule, component_selector
    ) VALUES (
      p_bom_id, v_eff_component, p_component_variant_id,
      v_eff_quantity, v_eff_uom, COALESCE(p_sequence, 10),
      p_parent_bom_line_id, p_inheritance_action, false,
      COALESCE(p_is_optional, false), p_is_critical,
      NULLIF(p_formula,''), NULLIF(p_qty_formula,''), p_formula_variables,
      p_consumption_uom_id, p_conversion_factor, COALESCE(p_rounding_method,'exact'),
      p_operation_id, p_work_center_id,
      p_applies_to_variant_rule, p_component_selector
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.bom_lines SET
      bom_id                  = p_bom_id,
      component_product_id    = v_eff_component,
      component_variant_id    = p_component_variant_id,
      quantity                = v_eff_quantity,
      uom_id                  = v_eff_uom,
      sequence                = COALESCE(p_sequence, sequence),
      parent_bom_line_id      = p_parent_bom_line_id,
      inheritance_action      = p_inheritance_action,
      is_optional             = COALESCE(p_is_optional, false),
      is_critical             = p_is_critical,
      formula                 = NULLIF(p_formula,''),
      qty_formula             = NULLIF(p_qty_formula,''),
      formula_variables       = p_formula_variables,
      consumption_uom_id      = p_consumption_uom_id,
      conversion_factor       = p_conversion_factor,
      rounding_method         = COALESCE(p_rounding_method, rounding_method),
      operation_id            = p_operation_id,
      work_center_id          = p_work_center_id,
      applies_to_variant_rule = p_applies_to_variant_rule,
      component_selector      = p_component_selector
    WHERE id = p_id AND is_inherited = false
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'bom_upsert_line: line % not found or is inherited (read-only)', p_id USING ERRCODE='P0002';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bom_upsert_line(uuid,uuid,uuid,uuid,numeric,uuid,integer,uuid,text,boolean,boolean,text,text,jsonb,uuid,numeric,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_upsert_line(uuid,uuid,uuid,uuid,numeric,uuid,integer,uuid,text,boolean,boolean,text,text,jsonb,uuid,numeric,text,uuid,uuid,jsonb,jsonb) TO authenticated;

-- =========================================================================
-- RPC: bom_delete_line
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bom_delete_line(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inherited boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_delete_line: not authenticated' USING ERRCODE='28000';
  END IF;
  IF NOT public.has_permission(v_uid, 'products'::app_module, 'boms', 'delete'::permission_action) THEN
    RAISE EXCEPTION 'bom_delete_line: missing permission products.boms.delete' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'bom_delete_line: id is required' USING ERRCODE='22023';
  END IF;

  SELECT is_inherited INTO v_inherited FROM public.bom_lines WHERE id = p_id;
  IF v_inherited IS NULL THEN
    RAISE EXCEPTION 'bom_delete_line: line % not found', p_id USING ERRCODE='P0002';
  END IF;
  IF v_inherited THEN
    RAISE EXCEPTION 'bom_delete_line: cannot delete inherited line %', p_id USING ERRCODE='42501';
  END IF;

  DELETE FROM public.bom_lines WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bom_delete_line(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bom_delete_line(uuid) TO authenticated;