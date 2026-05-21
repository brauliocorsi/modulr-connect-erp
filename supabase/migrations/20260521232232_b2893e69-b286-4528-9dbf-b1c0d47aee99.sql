CREATE OR REPLACE FUNCTION public.sale_order_set_services(_order_id uuid, _include_assembly boolean, _include_delivery boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state text; v_mode text;
  v_changed text[] := ARRAY[]::text[]; v_old_a boolean; v_old_d boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT state, delivery_mode, include_assembly, include_delivery
    INTO v_state, v_mode, v_old_a, v_old_d
    FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  IF v_mode = 'pickup' THEN
    IF COALESCE(_include_delivery,false) = true THEN RAISE EXCEPTION 'pickup_cannot_include_delivery'; END IF;
    IF COALESCE(_include_assembly,false) = true THEN RAISE EXCEPTION 'pickup_cannot_include_assembly'; END IF;
  END IF;

  UPDATE sale_orders
     SET include_assembly = COALESCE(_include_assembly, include_assembly),
         include_delivery = COALESCE(_include_delivery, include_delivery)
   WHERE id = _order_id;

  IF v_old_a IS DISTINCT FROM _include_assembly THEN v_changed := array_append(v_changed, 'include_assembly'::text); END IF;
  IF v_old_d IS DISTINCT FROM _include_delivery THEN v_changed := array_append(v_changed, 'include_delivery'::text); END IF;

  IF array_length(v_changed, 1) > 0 THEN
    PERFORM activity_log_event(
      'sale_order', _order_id, 'sale_order_services_updated',
      'Serviços atualizados',
      jsonb_build_object('include_assembly', _include_assembly, 'include_delivery', _include_delivery),
      'internal'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'order_id', _order_id, 'changed_fields', to_jsonb(v_changed));
END $function$;