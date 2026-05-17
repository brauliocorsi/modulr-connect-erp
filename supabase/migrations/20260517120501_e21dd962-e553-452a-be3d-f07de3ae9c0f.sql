
CREATE OR REPLACE FUNCTION public.update_product_operational_config(
  _product_id uuid,
  _supply_route text,
  _allocation_policy text,
  _component_allocation_policy text,
  _package_tracking_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prod public.products%ROWTYPE;
  v_warnings jsonb := '[]'::jsonb;
  v_has_bom boolean;
  v_diag jsonb;
  v_blockers jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='28000';
  END IF;

  IF NOT public.has_permission(v_uid, 'products'::app_module, 'products', 'edit'::permission_action) THEN
    RAISE EXCEPTION 'forbidden: requires products.edit' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found: %', _product_id USING ERRCODE='P0002';
  END IF;

  -- Enum validation
  IF _supply_route IS NOT NULL AND _supply_route NOT IN ('buy','manufacture','buy_or_manufacture','manual') THEN
    RAISE EXCEPTION 'invalid_supply_route: %', _supply_route USING ERRCODE='22023';
  END IF;
  IF _allocation_policy IS NOT NULL AND _allocation_policy NOT IN (
    'strict_order','stock_pool_first','oldest_order_first','delivery_date_first',
    'paid_priority','manual_allocation','custom_priority'
  ) THEN
    RAISE EXCEPTION 'invalid_allocation_policy: %', _allocation_policy USING ERRCODE='22023';
  END IF;
  IF _component_allocation_policy IS NOT NULL AND _component_allocation_policy NOT IN (
    'manufacturing_first','sales_first','oldest_need_first','manual'
  ) THEN
    RAISE EXCEPTION 'invalid_component_allocation_policy: %', _component_allocation_policy USING ERRCODE='22023';
  END IF;

  -- BOM presence (active)
  SELECT EXISTS(
    SELECT 1 FROM public.boms b
    WHERE b.product_id = _product_id
      AND COALESCE(b.active, true) = true
  ) INTO v_has_bom;

  -- Warnings
  IF _supply_route IN ('manufacture','buy_or_manufacture') AND NOT v_has_bom THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','manufacture_without_bom',
      'message','Produto marcado para fabrico mas não tem BOM ativa.'
    );
  END IF;
  IF _supply_route = 'buy' AND v_has_bom THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','buy_with_active_bom',
      'message','Produto marcado como comprado mas tem BOM ativa.'
    );
  END IF;
  IF _component_allocation_policy IS NOT NULL
     AND COALESCE(v_prod.product_kind,'') NOT IN ('raw','component','mixed') THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code','component_policy_on_non_component',
      'message','Política de componente definida em produto que não é matéria-prima/componente.'
    );
  END IF;

  -- Package tracking guard
  IF _package_tracking_enabled IS TRUE AND COALESCE(v_prod.package_tracking_enabled, false) = false THEN
    BEGIN
      v_diag := public.package_tracking_diagnostic(_product_id);
    EXCEPTION WHEN OTHERS THEN
      v_diag := NULL;
    END;
    v_blockers := COALESCE(v_diag->'blockers', '[]'::jsonb);
    IF jsonb_array_length(v_blockers) > 0
       OR COALESCE((v_diag->>'ready_for_activation')::boolean, false) = false THEN
      RAISE EXCEPTION 'package_tracking_blocked: %', COALESCE(v_blockers::text, 'not_ready')
        USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Apply update (only the 4 operational fields)
  UPDATE public.products
    SET supply_route                = COALESCE(_supply_route::product_supply_route, supply_route),
        allocation_policy           = COALESCE(_allocation_policy::allocation_policy, allocation_policy),
        component_allocation_policy = COALESCE(_component_allocation_policy::component_allocation_policy, component_allocation_policy),
        package_tracking_enabled    = COALESCE(_package_tracking_enabled, package_tracking_enabled),
        updated_at                  = now()
    WHERE id = _product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', _product_id,
    'warnings', v_warnings,
    'has_bom', v_has_bom
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_operational_config(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_product_operational_config(uuid, text, text, text, boolean) TO authenticated;
