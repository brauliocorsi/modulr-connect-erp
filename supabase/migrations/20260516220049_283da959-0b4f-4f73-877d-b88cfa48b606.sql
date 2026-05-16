
CREATE OR REPLACE FUNCTION public.product_manufacturing_configuration_check(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prod record;
  v_has_bom boolean := false;
  v_has_routing boolean := false;
  v_has_default boolean := false;
  v_has_wc boolean := false;
  v_has_ops boolean := false;
  v_blockers text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_ready boolean := false;
BEGIN
  SELECT id, can_be_manufactured, supply_route INTO v_prod
    FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','product_not_found');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.boms WHERE product_id = _product_id AND active = true) INTO v_has_bom;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_routings WHERE product_id = _product_id AND active = true) INTO v_has_routing;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_routings WHERE product_id = _product_id AND active = true AND is_default = true) INTO v_has_default;
  SELECT EXISTS(SELECT 1 FROM public.work_centers WHERE active = true) INTO v_has_wc;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_operations WHERE active = true) INTO v_has_ops;

  IF v_prod.can_be_manufactured = false THEN
    v_blockers := v_blockers || 'product_not_manufacturable';
  END IF;
  IF NOT v_has_routing THEN v_warnings := v_warnings || 'no_active_routing'; END IF;
  IF v_has_routing AND NOT v_has_default THEN v_warnings := v_warnings || 'no_default_routing'; END IF;
  IF NOT v_has_wc THEN v_warnings := v_warnings || 'no_active_work_centers'; END IF;
  IF NOT v_has_ops THEN v_warnings := v_warnings || 'no_active_operations'; END IF;
  IF v_prod.supply_route = 'manual' THEN v_warnings := v_warnings || 'supply_route_manual_undecided'; END IF;

  v_ready := array_length(v_blockers,1) IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', _product_id,
    'has_bom', v_has_bom,
    'has_routing', v_has_routing,
    'has_default_routing', v_has_default,
    'has_work_centers', v_has_wc,
    'has_operations', v_has_ops,
    'supply_route', v_prod.supply_route,
    'can_be_manufactured', v_prod.can_be_manufactured,
    'manufacturing_ready', v_ready,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings)
  );
END
$fn$;
