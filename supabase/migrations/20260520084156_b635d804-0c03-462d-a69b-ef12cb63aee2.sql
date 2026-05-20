-- F22-D1: Ad-hoc supplier_bill RPCs (create/update/cancel)

CREATE OR REPLACE FUNCTION public.supplier_bill_create(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner uuid := nullif(_payload->>'partner_id','')::uuid;
  v_po uuid := nullif(_payload->>'purchase_order_id','')::uuid;
  v_bill_date date := COALESCE((_payload->>'bill_date')::date, CURRENT_DATE);
  v_due_date date := nullif(_payload->>'due_date','')::date;
  v_total numeric := COALESCE((_payload->>'amount_total')::numeric, 0);
  v_cc uuid := nullif(_payload->>'cost_center_id','')::uuid;
  v_ref text := _payload->>'reference';
  v_notes text := _payload->>'notes';
  v_state text := COALESCE(_payload->>'state','posted');
  v_name text;
  v_id uuid;
BEGIN
  IF NOT has_permission(auth.uid(), 'finance'::app_module, 'bills', 'create'::permission_action)
     AND NOT has_permission(auth.uid(), 'finance'::app_module, 'bills', 'edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;
  IF v_partner IS NULL THEN
    RETURN jsonb_build_object('error','partner_required');
  END IF;
  IF v_total <= 0 THEN
    RETURN jsonb_build_object('error','total_must_be_positive');
  END IF;
  IF v_due_date IS NOT NULL AND v_due_date < v_bill_date THEN
    RETURN jsonb_build_object('error','due_before_bill');
  END IF;
  IF v_state NOT IN ('draft','posted') THEN
    RETURN jsonb_build_object('error','invalid_initial_state','state',v_state);
  END IF;

  v_name := next_sequence('supplier_bill');

  INSERT INTO supplier_bills(
    name, partner_id, purchase_order_id, bill_date, due_date,
    amount_total, cost_center_id, reference, notes, state, created_by
  ) VALUES (
    COALESCE(v_name,'BILL/'||to_char(now(),'YYYYMMDD/HH24MISSMS')),
    v_partner, v_po, v_bill_date, v_due_date,
    v_total, v_cc, v_ref, v_notes, v_state, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'bill_id',v_id,'name',v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_bill_update(_bill_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill supplier_bills%ROWTYPE;
  v_new_total numeric;
  v_new_due date;
  v_new_bd date;
BEGIN
  IF NOT has_permission(auth.uid(), 'finance'::app_module, 'bills', 'edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;

  SELECT * INTO v_bill FROM supplier_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','bill_not_found');
  END IF;
  IF v_bill.state IN ('paid','cancelled') THEN
    RETURN jsonb_build_object('error','bill_locked','state',v_bill.state);
  END IF;

  v_new_total := COALESCE((_payload->>'amount_total')::numeric, v_bill.amount_total);
  v_new_due := COALESCE(nullif(_payload->>'due_date','')::date, v_bill.due_date);
  v_new_bd := COALESCE((_payload->>'bill_date')::date, v_bill.bill_date);

  IF v_new_total < v_bill.amount_paid THEN
    RETURN jsonb_build_object('error','total_below_paid','amount_paid',v_bill.amount_paid);
  END IF;
  IF v_new_due IS NOT NULL AND v_new_due < v_new_bd THEN
    RETURN jsonb_build_object('error','due_before_bill');
  END IF;

  UPDATE supplier_bills SET
    partner_id        = COALESCE(nullif(_payload->>'partner_id','')::uuid, partner_id),
    purchase_order_id = CASE WHEN _payload ? 'purchase_order_id'
                             THEN nullif(_payload->>'purchase_order_id','')::uuid
                             ELSE purchase_order_id END,
    bill_date         = v_new_bd,
    due_date          = v_new_due,
    amount_total      = v_new_total,
    cost_center_id    = CASE WHEN _payload ? 'cost_center_id'
                             THEN nullif(_payload->>'cost_center_id','')::uuid
                             ELSE cost_center_id END,
    reference         = COALESCE(_payload->>'reference', reference),
    notes             = COALESCE(_payload->>'notes', notes)
  WHERE id = _bill_id;

  PERFORM recalc_bill_state(_bill_id);

  RETURN jsonb_build_object('ok',true,'bill_id',_bill_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_bill_cancel(_bill_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill supplier_bills%ROWTYPE;
BEGIN
  IF NOT has_permission(auth.uid(), 'finance'::app_module, 'bills', 'edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RETURN jsonb_build_object('error','reason_required');
  END IF;

  SELECT * INTO v_bill FROM supplier_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','bill_not_found');
  END IF;
  IF v_bill.state = 'cancelled' THEN
    RETURN jsonb_build_object('error','already_cancelled');
  END IF;
  IF v_bill.state = 'paid' OR COALESCE(v_bill.amount_paid,0) > 0 THEN
    RETURN jsonb_build_object('error','bill_has_payments','amount_paid',v_bill.amount_paid);
  END IF;

  UPDATE supplier_bills
     SET state = 'cancelled',
         notes = COALESCE(notes,'') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                 '[cancelled '||to_char(now(),'YYYY-MM-DD HH24:MI')||'] '||_reason
   WHERE id = _bill_id;

  RETURN jsonb_build_object('ok',true,'bill_id',_bill_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.supplier_bill_create(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_bill_update(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_bill_cancel(uuid, text) TO authenticated;