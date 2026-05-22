-- 1) Schema additions on supplier_bills
ALTER TABLE public.supplier_bills
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS recurring_expense_id uuid REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_bills_source ON public.supplier_bills(source);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_recurring ON public.supplier_bills(recurring_expense_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_cost_center ON public.supplier_bills(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_account ON public.supplier_bills(account_id);

-- Backfill source for bills already created from PO or recurring (reference based)
UPDATE public.supplier_bills SET source='purchase_order' WHERE purchase_order_id IS NOT NULL AND source='manual';
UPDATE public.supplier_bills SET source='recurring_expense' WHERE reference LIKE 'recurring:%' AND source='manual';

-- 2) supplier_bill_create — accept account_id, source, recurring_expense_id
CREATE OR REPLACE FUNCTION public.supplier_bill_create(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner uuid := nullif(_payload->>'partner_id','')::uuid;
  v_po uuid := nullif(_payload->>'purchase_order_id','')::uuid;
  v_bill_date date := COALESCE((_payload->>'bill_date')::date, CURRENT_DATE);
  v_due_date date := nullif(_payload->>'due_date','')::date;
  v_total numeric := COALESCE((_payload->>'amount_total')::numeric, 0);
  v_cc uuid := nullif(_payload->>'cost_center_id','')::uuid;
  v_acc uuid := nullif(_payload->>'account_id','')::uuid;
  v_rec_exp uuid := nullif(_payload->>'recurring_expense_id','')::uuid;
  v_source text := COALESCE(nullif(_payload->>'source',''),
                            CASE WHEN v_po IS NOT NULL THEN 'purchase_order'
                                 WHEN v_rec_exp IS NOT NULL THEN 'recurring_expense'
                                 ELSE 'manual' END);
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
  IF v_partner IS NULL THEN RETURN jsonb_build_object('error','partner_required'); END IF;
  IF v_total <= 0 THEN RETURN jsonb_build_object('error','total_must_be_positive'); END IF;
  IF v_due_date IS NOT NULL AND v_due_date < v_bill_date THEN
    RETURN jsonb_build_object('error','due_before_bill');
  END IF;
  IF v_state NOT IN ('draft','posted') THEN
    RETURN jsonb_build_object('error','invalid_initial_state','state',v_state);
  END IF;
  IF v_source NOT IN ('manual','purchase_order','recurring_expense','service','sale') THEN
    RETURN jsonb_build_object('error','invalid_source','source',v_source);
  END IF;

  v_name := next_sequence('supplier_bill');

  INSERT INTO supplier_bills(
    name, partner_id, purchase_order_id, bill_date, due_date,
    amount_total, cost_center_id, account_id, source, recurring_expense_id,
    reference, notes, state, created_by
  ) VALUES (
    COALESCE(v_name,'BILL/'||to_char(now(),'YYYYMMDD/HH24MISSMS')),
    v_partner, v_po, v_bill_date, v_due_date,
    v_total, v_cc, v_acc, v_source, v_rec_exp,
    v_ref, v_notes, v_state, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'bill_id',v_id,'name',v_name,'source',v_source);
END;
$function$;

-- 3) supplier_bill_update — accept account_id
CREATE OR REPLACE FUNCTION public.supplier_bill_update(_bill_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT FOUND THEN RETURN jsonb_build_object('error','bill_not_found'); END IF;
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
    account_id        = CASE WHEN _payload ? 'account_id'
                             THEN nullif(_payload->>'account_id','')::uuid
                             ELSE account_id END,
    reference         = COALESCE(_payload->>'reference', reference),
    notes             = COALESCE(_payload->>'notes', notes)
  WHERE id = _bill_id;

  PERFORM recalc_bill_state(_bill_id);

  RETURN jsonb_build_object('ok',true,'bill_id',_bill_id);
END;
$function$;

-- 4) supplier_payment_register — accept _cost_center_id, _account_id, _journal_id (additive)
CREATE OR REPLACE FUNCTION public.supplier_payment_register(
  _bill_id uuid,
  _amount numeric,
  _method_id uuid DEFAULT NULL::uuid,
  _payment_date date DEFAULT NULL::date,
  _reference text DEFAULT NULL::text,
  _idempotency_key text DEFAULT NULL::text,
  _cost_center_id uuid DEFAULT NULL::uuid,
  _account_id uuid DEFAULT NULL::uuid,
  _journal_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_bill record; v_pay_id uuid; v_existing uuid; v_new_paid numeric; v_new_state text;
        v_cc uuid; v_journal uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RETURN jsonb_build_object('error','amount_must_be_positive'); END IF;
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM supplier_payments WHERE idempotency_key = _idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok',true,'payment_id',v_existing,'idempotent',true);
    END IF;
  END IF;
  SELECT * INTO v_bill FROM supplier_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','bill_not_found'); END IF;
  IF v_bill.state = 'cancelled' THEN RETURN jsonb_build_object('error','bill_cancelled'); END IF;
  IF v_bill.amount_paid + _amount > v_bill.amount_total + 0.001 THEN
    RETURN jsonb_build_object('error','overpayment','paid',v_bill.amount_paid,'adding',_amount,'total',v_bill.amount_total);
  END IF;

  -- Propagate cost_center from bill if not provided
  v_cc := COALESCE(_cost_center_id, v_bill.cost_center_id);

  -- Default journal from payment method
  v_journal := _journal_id;
  IF v_journal IS NULL AND _method_id IS NOT NULL THEN
    SELECT default_journal_id INTO v_journal FROM payment_methods WHERE id = _method_id;
  END IF;

  INSERT INTO supplier_payments(
    name, bill_id, partner_id, payment_date, amount, method_id, journal_id,
    cost_center_id, account_id, reference, state, idempotency_key, created_by
  )
  VALUES (
    'SPAY/'||to_char(now(),'YYYYMMDD/HH24MISSMS'), _bill_id, v_bill.partner_id,
    COALESCE(_payment_date,CURRENT_DATE), _amount, _method_id, v_journal,
    v_cc, COALESCE(_account_id, v_bill.account_id), _reference, 'posted',
    _idempotency_key, auth.uid()
  )
  RETURNING id INTO v_pay_id;

  v_new_paid := v_bill.amount_paid + _amount;
  v_new_state := CASE WHEN v_new_paid >= v_bill.amount_total - 0.001 THEN 'paid'
                      WHEN v_new_paid > 0 THEN 'partial'
                      ELSE v_bill.state END;
  UPDATE supplier_bills SET amount_paid = v_new_paid, state = v_new_state, updated_at = now() WHERE id = _bill_id;
  RETURN jsonb_build_object('ok',true,'payment_id',v_pay_id,'amount_paid',v_new_paid,'state',v_new_state);
END $function$;

-- 5) recurring_expense_create — accept cost_center_id, account_id, journal_id
CREATE OR REPLACE FUNCTION public.recurring_expense_create(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_name text := btrim(coalesce(_payload->>'name',''));
  v_category text := btrim(coalesce(_payload->>'category',''));
  v_amount numeric := coalesce((_payload->>'amount')::numeric, 0);
  v_freq text := coalesce(_payload->>'frequency','');
  v_due date := nullif(_payload->>'next_due_date','')::date;
  v_supplier uuid := nullif(_payload->>'supplier_id','')::uuid;
  v_pm uuid := nullif(_payload->>'payment_method_id','')::uuid;
  v_cc uuid := nullif(_payload->>'cost_center_id','')::uuid;
  v_acc uuid := nullif(_payload->>'account_id','')::uuid;
  v_journal uuid := nullif(_payload->>'journal_id','')::uuid;
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

  INSERT INTO recurring_expenses(
    name, supplier_id, category, amount, frequency, next_due_date,
    payment_method_id, cost_center_id, account_id, journal_id, notes, created_by
  )
  VALUES (v_name, v_supplier, v_category, v_amount, v_freq, v_due,
          v_pm, v_cc, v_acc, v_journal, _payload->>'notes', auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$function$;

-- 6) recurring_expense_update — accept CC/account/journal
CREATE OR REPLACE FUNCTION public.recurring_expense_update(_expense_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    cost_center_id = CASE WHEN _payload ? 'cost_center_id'
                          THEN nullif(_payload->>'cost_center_id','')::uuid
                          ELSE cost_center_id END,
    account_id = CASE WHEN _payload ? 'account_id'
                      THEN nullif(_payload->>'account_id','')::uuid
                      ELSE account_id END,
    journal_id = CASE WHEN _payload ? 'journal_id'
                      THEN nullif(_payload->>'journal_id','')::uuid
                      ELSE journal_id END,
    notes = coalesce(_payload->>'notes', notes),
    active = coalesce((_payload->>'active')::boolean, active)
  WHERE id = _expense_id;

  RETURN jsonb_build_object('ok',true,'id',_expense_id);
END;
$function$;

-- 7) recurring_expense_generate_bill — propagate CC/account/source/recurring_expense_id
CREATE OR REPLACE FUNCTION public.recurring_expense_generate_bill(_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'cost_center_id', v_exp.cost_center_id,
    'account_id', v_exp.account_id,
    'source', 'recurring_expense',
    'recurring_expense_id', _expense_id,
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
$function$;