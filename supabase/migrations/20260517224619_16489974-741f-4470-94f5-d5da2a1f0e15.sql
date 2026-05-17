-- P0 #2a: eliminar bypass do planner legado em _so_ensure_mo_for_line.
-- A função antiga criava MO sem mo_components e fazia flatten direto da BOM
-- para purchase_needs, ignorando can_be_manufactured/supply_route e impedindo
-- a materialização de MO filha para submontagens fabricáveis.
-- Agora delega ao motor validado em F16-C.5: mfg_create_mo_for_line, que:
--   * insere mo_components via resolve_bom_for_variant,
--   * chama mfg_plan_components(mo, 0),
--   * cria MO filha para componentes manufacture,
--   * cria purchase_needs apenas para componentes buy (folhas),
--   * respeita supply_route e gera AMBIGUOUS_SUPPLY_ROUTE quando necessário.

CREATE OR REPLACE FUNCTION public._so_ensure_mo_for_line(_line_id uuid, _qty numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line sale_order_lines%ROWTYPE;
  v_mo uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT * INTO v_line FROM public.sale_order_lines WHERE id=_line_id;
  IF v_line.id IS NULL THEN RETURN NULL; END IF;

  -- Reusa MO existente para esta SOL se houver (idempotente)
  SELECT id INTO v_mo
    FROM public.manufacturing_orders
   WHERE sale_order_line_id = _line_id
     AND parent_mo_id IS NULL
     AND state NOT IN ('cancelled','done')
   ORDER BY created_at ASC LIMIT 1;

  IF v_mo IS NOT NULL THEN
    -- Garante planeamento dos componentes mesmo se a MO já existia
    PERFORM public.mfg_plan_components(v_mo, 0);
    RETURN v_mo;
  END IF;

  -- Delega ao planner validado (cria MO, mo_components, MO filha, needs de folhas)
  v_mo := public.mfg_create_mo_for_line(v_line.order_id, _line_id);
  RETURN v_mo;
END
$function$;