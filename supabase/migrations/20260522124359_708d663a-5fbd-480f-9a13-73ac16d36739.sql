
-- F28-FIN B.2: cost center RPCs + attachment RPCs to eliminate finance bypasses
CREATE OR REPLACE FUNCTION public.cost_center_upsert(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text := nullif(_payload->>'code','');
  v_name text := nullif(_payload->>'name','');
  v_parent uuid := nullif(_payload->>'parent_id','')::uuid;
  v_active boolean := coalesce((_payload->>'active')::boolean, true);
BEGIN
  IF NOT (has_permission(auth.uid(), 'finance'::app_module, 'cost_centers'::text, 'edit'::permission_action)) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF v_code IS NULL OR v_name IS NULL THEN
    RETURN jsonb_build_object('error','code_and_name_required');
  END IF;
  v_id := nullif(_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.cost_centers(code,name,parent_id,active)
    VALUES (v_code, v_name, v_parent, v_active)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.cost_centers
       SET code = v_code, name = v_name, parent_id = v_parent, active = v_active
     WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cost_center_archive(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (has_permission(auth.uid(), 'finance'::app_module, 'cost_centers'::text, 'edit'::permission_action)) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  UPDATE public.cost_centers SET active = false WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_bill_set_attachments(_bill_id uuid, _attachments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state FROM public.supplier_bills WHERE id = _bill_id;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF v_state = 'cancelled' THEN
    RETURN jsonb_build_object('error','bill_cancelled');
  END IF;
  UPDATE public.supplier_bills
     SET attachments = coalesce(_attachments, '[]'::jsonb)
   WHERE id = _bill_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_payment_set_attachments(_payment_id uuid, _attachments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state FROM public.supplier_payments WHERE id = _payment_id;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  UPDATE public.supplier_payments
     SET attachments = coalesce(_attachments, '[]'::jsonb)
   WHERE id = _payment_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
