
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  supplier_id uuid REFERENCES public.partners(id),
  category text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  frequency text NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly','custom')),
  next_due_date date NOT NULL,
  payment_method_id uuid REFERENCES public.payment_methods(id),
  active boolean NOT NULL DEFAULT true,
  notes text,
  last_generated_bill_id uuid REFERENCES public.supplier_bills(id),
  last_generated_due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  CONSTRAINT recurring_expenses_name_not_empty CHECK (btrim(name) <> ''),
  CONSTRAINT recurring_expenses_cancel_consistency CHECK (
    (cancelled_at IS NULL) OR (cancelled_at IS NOT NULL AND active = false)
  )
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_next_due ON public.recurring_expenses(next_due_date) WHERE active;
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_supplier ON public.recurring_expenses(supplier_id);

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_expenses_view ON public.recurring_expenses;
CREATE POLICY recurring_expenses_view ON public.recurring_expenses
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'finance'::app_module, 'bills'::text, 'view'::permission_action));

DROP POLICY IF EXISTS recurring_expenses_manage ON public.recurring_expenses;
CREATE POLICY recurring_expenses_manage ON public.recurring_expenses
  FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'finance'::app_module, 'bills'::text, 'edit'::permission_action))
  WITH CHECK (has_permission(auth.uid(), 'finance'::app_module, 'bills'::text, 'edit'::permission_action));

DROP TRIGGER IF EXISTS trg_recurring_expenses_updated_at ON public.recurring_expenses;
CREATE TRIGGER trg_recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.recurring_expense_create(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(_payload->>'name',''));
  v_category text := btrim(coalesce(_payload->>'category',''));
  v_amount numeric := coalesce((_payload->>'amount')::numeric, 0);
  v_freq text := coalesce(_payload->>'frequency','');
  v_due date := nullif(_payload->>'next_due_date','')::date;
  v_supplier uuid := nullif(_payload->>'supplier_id','')::uuid;
  v_pm uuid := nullif(_payload->>'payment_method_id','')::uuid;
BEGIN
  IF NOT has_permission(auth.uid(),'finance'::app_module,'bills','edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;
  IF v_name = '' THEN RETURN jsonb_build_object('error','name_required'); END IF;
  IF v_category = '' THEN RETURN jsonb_build_object('error','category_required'); END IF;
  IF v_amount <= 0 THEN RETURN jsonb_build_object('error','amount_must_be_positive'); END IF;
  IF v_freq NOT IN ('weekly','monthly','quarterly','yearly','custom') THEN
    RETURN jsonb_build_object('error','invalid_frequency');
  END IF;
  IF v_due IS NULL THEN RETURN jsonb_build_object('error','next_due_date_required'); END IF;
  IF v_supplier IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partners WHERE id = v_supplier) THEN
    RETURN jsonb_build_object('error','supplier_not_found');
  END IF;
  IF v_pm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = v_pm) THEN
    RETURN jsonb_build_object('error','payment_method_not_found');
  END IF;

  INSERT INTO recurring_expenses(name, supplier_id, category, amount, frequency, next_due_date, payment_method_id, notes, created_by)
  VALUES (v_name, v_supplier, v_category, v_amount, v_freq, v_due, v_pm, _payload->>'notes', auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recurring_expense_update(_expense_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp recurring_expenses%ROWTYPE;
  v_amount numeric;
  v_due date;
  v_freq text;
  v_supplier uuid;
  v_pm uuid;
BEGIN
  IF NOT has_permission(auth.uid(),'finance'::app_module,'bills','edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;

  SELECT * INTO v_exp FROM recurring_expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','expense_not_found'); END IF;
  IF v_exp.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('error','expense_cancelled'); END IF;

  v_amount := coalesce((_payload->>'amount')::numeric, v_exp.amount);
  v_due := coalesce(nullif(_payload->>'next_due_date','')::date, v_exp.next_due_date);
  v_freq := coalesce(_payload->>'frequency', v_exp.frequency);
  IF v_amount <= 0 THEN RETURN jsonb_build_object('error','amount_must_be_positive'); END IF;
  IF v_freq NOT IN ('weekly','monthly','quarterly','yearly','custom') THEN
    RETURN jsonb_build_object('error','invalid_frequency');
  END IF;

  IF _payload ? 'supplier_id' THEN
    v_supplier := nullif(_payload->>'supplier_id','')::uuid;
    IF v_supplier IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partners WHERE id = v_supplier) THEN
      RETURN jsonb_build_object('error','supplier_not_found');
    END IF;
  ELSE
    v_supplier := v_exp.supplier_id;
  END IF;

  IF _payload ? 'payment_method_id' THEN
    v_pm := nullif(_payload->>'payment_method_id','')::uuid;
    IF v_pm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_methods WHERE id = v_pm) THEN
      RETURN jsonb_build_object('error','payment_method_not_found');
    END IF;
  ELSE
    v_pm := v_exp.payment_method_id;
  END IF;

  UPDATE recurring_expenses SET
    name = coalesce(nullif(btrim(_payload->>'name'),''), name),
    category = coalesce(nullif(btrim(_payload->>'category'),''), category),
    amount = v_amount,
    frequency = v_freq,
    next_due_date = v_due,
    supplier_id = v_supplier,
    payment_method_id = v_pm,
    notes = coalesce(_payload->>'notes', notes),
    active = coalesce((_payload->>'active')::boolean, active)
  WHERE id = _expense_id;

  RETURN jsonb_build_object('ok',true,'id',_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recurring_expense_cancel(_expense_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp recurring_expenses%ROWTYPE;
BEGIN
  IF NOT has_permission(auth.uid(),'finance'::app_module,'bills','edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RETURN jsonb_build_object('error','reason_required');
  END IF;

  SELECT * INTO v_exp FROM recurring_expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','expense_not_found'); END IF;
  IF v_exp.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'id',_expense_id,'idempotent',true);
  END IF;

  UPDATE recurring_expenses SET
    active = false,
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancel_reason = _reason
  WHERE id = _expense_id;

  RETURN jsonb_build_object('ok',true,'id',_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recurring_expense_generate_bill(_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp recurring_expenses%ROWTYPE;
  v_res jsonb;
  v_bill_id uuid;
  v_next date;
  v_due date;
BEGIN
  IF NOT has_permission(auth.uid(),'finance'::app_module,'bills','edit'::permission_action) THEN
    RETURN jsonb_build_object('error','permission_denied');
  END IF;

  SELECT * INTO v_exp FROM recurring_expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','expense_not_found'); END IF;
  IF NOT v_exp.active OR v_exp.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','expense_inactive');
  END IF;
  IF v_exp.supplier_id IS NULL THEN
    RETURN jsonb_build_object('error','supplier_required_for_bill');
  END IF;

  v_due := v_exp.next_due_date;
  IF v_exp.last_generated_due_date IS NOT NULL AND v_exp.last_generated_due_date = v_due THEN
    RETURN jsonb_build_object('ok',true,'bill_id',v_exp.last_generated_bill_id,'idempotent',true);
  END IF;

  v_res := supplier_bill_create(jsonb_build_object(
    'partner_id', v_exp.supplier_id,
    'bill_date', CURRENT_DATE,
    'due_date', v_due,
    'amount_total', v_exp.amount,
    'reference', 'recurring:'||_expense_id::text,
    'notes', '[Despesa fixa: '||v_exp.name||'] '||coalesce(v_exp.notes,''),
    'state', 'posted'
  ));
  IF v_res ? 'error' THEN
    RETURN v_res;
  END IF;
  v_bill_id := (v_res->>'bill_id')::uuid;

  v_next := CASE v_exp.frequency
    WHEN 'weekly' THEN v_due + INTERVAL '7 days'
    WHEN 'monthly' THEN (v_due + INTERVAL '1 month')::date
    WHEN 'quarterly' THEN (v_due + INTERVAL '3 months')::date
    WHEN 'yearly' THEN (v_due + INTERVAL '1 year')::date
    WHEN 'custom' THEN v_due
    ELSE v_due
  END;

  UPDATE recurring_expenses SET
    last_generated_bill_id = v_bill_id,
    last_generated_due_date = v_due,
    next_due_date = v_next
  WHERE id = _expense_id;

  RETURN jsonb_build_object('ok',true,'bill_id',v_bill_id,'next_due_date',v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recurring_expense_create(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_expense_update(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_expense_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_expense_generate_bill(uuid) TO authenticated;
