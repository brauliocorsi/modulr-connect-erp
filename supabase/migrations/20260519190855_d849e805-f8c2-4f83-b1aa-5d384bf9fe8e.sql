
-- ============================================================
-- F22 / Bloco B — Sale Order metadata RPCs (zero-bypass)
-- ============================================================

-- 1) Toggle services (assembly/delivery)
CREATE OR REPLACE FUNCTION public.sale_order_set_services(
  _order_id uuid,
  _include_assembly boolean,
  _include_delivery boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state text;
  v_changed text[] := ARRAY[]::text[];
  v_old_a boolean;
  v_old_d boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT state, include_assembly, include_delivery
    INTO v_state, v_old_a, v_old_d
    FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  UPDATE sale_orders
     SET include_assembly = COALESCE(_include_assembly, include_assembly),
         include_delivery = COALESCE(_include_delivery, include_delivery)
   WHERE id = _order_id;

  IF v_old_a IS DISTINCT FROM _include_assembly THEN v_changed := v_changed || 'include_assembly'; END IF;
  IF v_old_d IS DISTINCT FROM _include_delivery THEN v_changed := v_changed || 'include_delivery'; END IF;

  IF array_length(v_changed, 1) > 0 THEN
    PERFORM activity_log_event(
      'sale_order', _order_id, 'sale_order_services_updated',
      'Serviços atualizados',
      jsonb_build_object('include_assembly', _include_assembly, 'include_delivery', _include_delivery),
      'internal'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id, 'changed_fields', to_jsonb(v_changed));
END $$;

-- 2) Set delivery mode
CREATE OR REPLACE FUNCTION public.sale_order_set_delivery_mode(
  _order_id uuid,
  _delivery_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text; v_old text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _delivery_mode NOT IN ('delivery','pickup','direct') THEN RAISE EXCEPTION 'invalid_delivery_mode:%', _delivery_mode; END IF;
  SELECT state, delivery_mode INTO v_state, v_old FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  UPDATE sale_orders SET delivery_mode = _delivery_mode WHERE id = _order_id;

  IF v_old IS DISTINCT FROM _delivery_mode THEN
    PERFORM activity_log_event(
      'sale_order', _order_id, 'sale_order_delivery_mode_updated',
      'Modo de entrega: '||_delivery_mode,
      jsonb_build_object('from', v_old, 'to', _delivery_mode),
      'internal'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id, 'changed_fields', jsonb_build_array('delivery_mode'));
END $$;

-- 3) Set delivery zone
CREATE OR REPLACE FUNCTION public.sale_order_set_delivery_zone(
  _order_id uuid,
  _delivery_zip_rule_id uuid DEFAULT NULL,
  _delivery_region_rule_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _delivery_zip_rule_id IS NOT NULL AND _delivery_region_rule_id IS NOT NULL THEN
    RAISE EXCEPTION 'zone_rules_mutually_exclusive';
  END IF;
  SELECT state INTO v_state FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  UPDATE sale_orders
     SET delivery_zip_rule_id = _delivery_zip_rule_id,
         delivery_region_rule_id = _delivery_region_rule_id
   WHERE id = _order_id;

  PERFORM activity_log_event(
    'sale_order', _order_id, 'sale_order_delivery_zone_updated',
    'Zona de entrega atualizada',
    jsonb_build_object('zip_rule_id', _delivery_zip_rule_id, 'region_rule_id', _delivery_region_rule_id),
    'internal'
  );

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id,
    'changed_fields', jsonb_build_array('delivery_zip_rule_id','delivery_region_rule_id'));
END $$;

-- 4) Mark invoiced
CREATE OR REPLACE FUNCTION public.sale_order_mark_invoiced(
  _order_id uuid,
  _invoice_number text DEFAULT NULL,
  _invoice_date date DEFAULT NULL,
  _invoice_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text; v_inv text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT state, invoice_status INTO v_state, v_inv FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;
  IF v_inv = 'invoiced' THEN RAISE EXCEPTION 'already_invoiced'; END IF;

  UPDATE sale_orders
     SET invoice_status = 'invoiced',
         invoice_number = NULLIF(_invoice_number,''),
         invoice_date   = COALESCE(_invoice_date, CURRENT_DATE),
         invoice_notes  = NULLIF(_invoice_notes,'')
   WHERE id = _order_id;

  PERFORM activity_log_event(
    'sale_order', _order_id, 'sale_order_invoiced',
    'Pedido marcado como faturado',
    jsonb_build_object('invoice_number', _invoice_number, 'invoice_date', _invoice_date),
    'internal'
  );

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id,
    'changed_fields', jsonb_build_array('invoice_status','invoice_number','invoice_date','invoice_notes'));
END $$;

-- 5) Revert invoice status
CREATE OR REPLACE FUNCTION public.sale_order_revert_invoice_status(
  _order_id uuid,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT invoice_status INTO v_inv FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_inv IS DISTINCT FROM 'invoiced' THEN RAISE EXCEPTION 'not_invoiced'; END IF;

  UPDATE sale_orders
     SET invoice_status = 'not_invoiced',
         invoice_number = NULL,
         invoice_date   = NULL
   WHERE id = _order_id;

  PERFORM activity_log_event(
    'sale_order', _order_id, 'sale_order_invoice_reverted',
    COALESCE('Faturação revertida: '||_reason, 'Faturação revertida'),
    jsonb_build_object('reason', _reason),
    'internal'
  );

  RETURN jsonb_build_object('ok', true, 'order_id', _order_id,
    'changed_fields', jsonb_build_array('invoice_status','invoice_number','invoice_date'));
END $$;

GRANT EXECUTE ON FUNCTION public.sale_order_set_services(uuid,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_set_delivery_mode(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_set_delivery_zone(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_mark_invoiced(uuid,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_revert_invoice_status(uuid,text) TO authenticated;
