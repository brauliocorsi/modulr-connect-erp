
-- ============================================================
-- F20-B Migration 1: Financial Backend Consolidation
-- ============================================================

-- ---------- ALTERS: append-only audit fields ----------

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_idem_uk
  ON public.supplier_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.cash_movements(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_reversal_uk
  ON public.cash_movements(reversal_of_id) WHERE reversal_of_id IS NOT NULL;

-- ---------- TABLE: customer_credits ----------

CREATE TABLE IF NOT EXISTS public.customer_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  origin_payment_id uuid REFERENCES public.customer_payments(id),
  origin_service_case_id uuid REFERENCES public.service_cases(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(14,2) NOT NULL CHECK (remaining_amount >= 0),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','consumed','cancelled')),
  reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  CHECK (remaining_amount <= amount)
);
CREATE INDEX IF NOT EXISTS customer_credits_partner_idx ON public.customer_credits(partner_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_credits_idem_uk
  ON public.customer_credits(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.customer_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_view ON public.customer_credits FOR SELECT
  USING (has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'view'::permission_action));
CREATE POLICY cc_manage ON public.customer_credits FOR ALL
  USING (has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action));

-- ---------- TABLE: customer_credit_applications ----------

CREATE TABLE IF NOT EXISTS public.customer_credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES public.customer_credits(id),
  sale_order_id uuid REFERENCES public.sale_orders(id),
  customer_payment_id uuid REFERENCES public.customer_payments(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  reversed_at timestamptz,
  reversed_by uuid
);
CREATE INDEX IF NOT EXISTS cca_credit_idx ON public.customer_credit_applications(credit_id);
CREATE INDEX IF NOT EXISTS cca_so_idx ON public.customer_credit_applications(sale_order_id);

ALTER TABLE public.customer_credit_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY cca_view ON public.customer_credit_applications FOR SELECT
  USING (has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'view'::permission_action));
CREATE POLICY cca_manage ON public.customer_credit_applications FOR ALL
  USING (has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action));

-- ---------- TABLE: supplier_bill_lines ----------

CREATE TABLE IF NOT EXISTS public.supplier_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES public.purchase_order_lines(id),
  product_id uuid REFERENCES public.products(id),
  description text,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_pct numeric(6,3) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sbl_bill_idx ON public.supplier_bill_lines(bill_id);
CREATE INDEX IF NOT EXISTS sbl_po_line_idx ON public.supplier_bill_lines(po_line_id);

ALTER TABLE public.supplier_bill_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY sbl_view ON public.supplier_bill_lines FOR SELECT
  USING (has_permission(auth.uid(), 'finance'::app_module, 'bills'::text, 'view'::permission_action));
CREATE POLICY sbl_manage ON public.supplier_bill_lines FOR ALL
  USING (has_permission(auth.uid(), 'finance'::app_module, 'bills'::text, 'edit'::permission_action));

-- ---------- TABLE: service_case_costs ----------

CREATE TABLE IF NOT EXISTS public.service_case_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_case_id uuid NOT NULL REFERENCES public.service_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('internal','supplier')),
  supplier_id uuid REFERENCES public.partners(id),
  description text,
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(14,2) NOT NULL CHECK (total_cost >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK ((kind = 'supplier' AND supplier_id IS NOT NULL) OR (kind = 'internal'))
);
CREATE INDEX IF NOT EXISTS scc_case_idx ON public.service_case_costs(service_case_id);

ALTER TABLE public.service_case_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scc_view ON public.service_case_costs FOR SELECT USING (service_can_view(auth.uid()));
CREATE POLICY scc_manage ON public.service_case_costs FOR ALL USING (service_can_manage(auth.uid()));

-- ---------- TABLE: service_case_charges ----------

CREATE TABLE IF NOT EXISTS public.service_case_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_case_id uuid NOT NULL REFERENCES public.service_cases(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  kind text NOT NULL CHECK (kind IN ('charge','refund','credit')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  customer_payment_id uuid REFERENCES public.customer_payments(id),
  customer_credit_id uuid REFERENCES public.customer_credits(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS sch_case_idx ON public.service_case_charges(service_case_id);

ALTER TABLE public.service_case_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY sch_view ON public.service_case_charges FOR SELECT USING (service_can_view(auth.uid()));
CREATE POLICY sch_manage ON public.service_case_charges FOR ALL USING (service_can_manage(auth.uid()));

-- ============================================================
-- RPCs
-- ============================================================

-- ---------- create_customer_credit ----------
CREATE OR REPLACE FUNCTION public.create_customer_credit(
  _partner_id uuid,
  _amount numeric,
  _reason text DEFAULT NULL,
  _origin_payment_id uuid DEFAULT NULL,
  _origin_service_case_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_existing uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('error','amount_must_be_positive');
  END IF;
  IF _partner_id IS NULL THEN
    RETURN jsonb_build_object('error','partner_required');
  END IF;
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM customer_credits WHERE idempotency_key = _idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok',true,'credit_id',v_existing,'idempotent',true);
    END IF;
  END IF;
  INSERT INTO customer_credits(partner_id, origin_payment_id, origin_service_case_id, amount, remaining_amount, reason, idempotency_key, created_by)
  VALUES (_partner_id, _origin_payment_id, _origin_service_case_id, _amount, _amount, _reason, _idempotency_key, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'credit_id',v_id);
END $$;

-- ---------- apply_customer_credit ----------
CREATE OR REPLACE FUNCTION public.apply_customer_credit(
  _credit_id uuid,
  _amount numeric,
  _sale_order_id uuid DEFAULT NULL,
  _customer_payment_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_credit record; v_so_state text; v_app_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('error','amount_must_be_positive');
  END IF;
  SELECT * INTO v_credit FROM customer_credits WHERE id = _credit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','credit_not_found'); END IF;
  IF v_credit.state <> 'open' THEN
    RETURN jsonb_build_object('error','credit_not_open','state',v_credit.state);
  END IF;
  IF _amount > v_credit.remaining_amount THEN
    RETURN jsonb_build_object('error','amount_exceeds_remaining','remaining',v_credit.remaining_amount);
  END IF;
  IF _sale_order_id IS NOT NULL THEN
    SELECT state::text INTO v_so_state FROM sale_orders WHERE id = _sale_order_id;
    IF v_so_state IS NULL THEN RETURN jsonb_build_object('error','sale_order_not_found'); END IF;
    IF v_so_state = 'cancelled' THEN RETURN jsonb_build_object('error','sale_order_cancelled'); END IF;
  END IF;
  INSERT INTO customer_credit_applications(credit_id, sale_order_id, customer_payment_id, amount, applied_by, notes)
  VALUES (_credit_id, _sale_order_id, _customer_payment_id, _amount, auth.uid(), _notes)
  RETURNING id INTO v_app_id;
  UPDATE customer_credits
     SET remaining_amount = remaining_amount - _amount,
         state = CASE WHEN remaining_amount - _amount <= 0 THEN 'consumed' ELSE state END
   WHERE id = _credit_id;
  RETURN jsonb_build_object('ok',true,'application_id',v_app_id);
END $$;

-- ---------- cash_movement_reverse ----------
CREATE OR REPLACE FUNCTION public.cash_movement_reverse(
  _movement_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_orig record; v_existing uuid; v_new_id uuid;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RETURN jsonb_build_object('error','reason_required');
  END IF;
  SELECT * INTO v_orig FROM cash_movements WHERE id = _movement_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','movement_not_found'); END IF;
  IF v_orig.reversal_of_id IS NOT NULL THEN
    RETURN jsonb_build_object('error','cannot_reverse_a_reversal');
  END IF;
  SELECT id INTO v_existing FROM cash_movements WHERE reversal_of_id = _movement_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error','already_reversed','reversal_id',v_existing);
  END IF;
  INSERT INTO cash_movements(session_id, kind, amount, reference, partner_id, payment_id, cost_center_id, notes, created_by, reversal_of_id, reversal_reason)
  VALUES (v_orig.session_id, v_orig.kind, -v_orig.amount, v_orig.reference, v_orig.partner_id, v_orig.payment_id, v_orig.cost_center_id,
          'Reversão: '||_reason, auth.uid(), _movement_id, _reason)
  RETURNING id INTO v_new_id;
  RETURN jsonb_build_object('ok',true,'reversal_id',v_new_id);
END $$;

-- ---------- supplier_bill_create_from_po ----------
CREATE OR REPLACE FUNCTION public.supplier_bill_create_from_po(
  _po_id uuid,
  _lines jsonb DEFAULT NULL,  -- [{po_line_id, quantity}]
  _idempotency_key text DEFAULT NULL,
  _bill_date date DEFAULT NULL,
  _reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_po record; v_bill_id uuid; v_existing uuid;
  v_line jsonb; v_pol record; v_qty numeric; v_billed numeric;
  v_subtotal numeric; v_total numeric := 0;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','po_not_found'); END IF;
  IF v_po.state NOT IN ('confirmed','done') THEN
    RETURN jsonb_build_object('error','po_not_confirmed','state',v_po.state);
  END IF;
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM supplier_bills WHERE reference = _idempotency_key AND purchase_order_id = _po_id;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok',true,'bill_id',v_existing,'idempotent',true);
    END IF;
  END IF;

  INSERT INTO supplier_bills(name, partner_id, purchase_order_id, bill_date, reference, state, created_by)
  VALUES ('BILL/'||to_char(now(),'YYYYMMDD/HH24MISSMS'), v_po.partner_id, _po_id,
          COALESCE(_bill_date, CURRENT_DATE), COALESCE(_idempotency_key,_reference), 'draft', auth.uid())
  RETURNING id INTO v_bill_id;

  IF _lines IS NULL THEN
    -- bill all remaining qty per PO line
    FOR v_pol IN SELECT pol.* FROM purchase_order_lines pol WHERE pol.order_id = _po_id LOOP
      SELECT COALESCE(SUM(sbl.quantity),0) INTO v_billed
        FROM supplier_bill_lines sbl
        JOIN supplier_bills sb ON sb.id = sbl.bill_id
       WHERE sbl.po_line_id = v_pol.id AND sb.state <> 'cancelled' AND sb.id <> v_bill_id;
      v_qty := v_pol.quantity - v_billed;
      IF v_qty > 0 THEN
        v_subtotal := round(v_qty * v_pol.unit_price, 2);
        INSERT INTO supplier_bill_lines(bill_id, po_line_id, product_id, description, quantity, unit_price, tax_pct, subtotal)
        VALUES (v_bill_id, v_pol.id, v_pol.product_id, v_pol.description, v_qty, v_pol.unit_price, v_pol.tax_pct, v_subtotal);
        v_total := v_total + v_subtotal;
      END IF;
    END LOOP;
  ELSE
    FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
      SELECT * INTO v_pol FROM purchase_order_lines WHERE id = (v_line->>'po_line_id')::uuid;
      IF NOT FOUND OR v_pol.order_id <> _po_id THEN
        RAISE EXCEPTION 'po_line_invalid: %', v_line->>'po_line_id';
      END IF;
      v_qty := (v_line->>'quantity')::numeric;
      IF v_qty <= 0 THEN RAISE EXCEPTION 'quantity_must_be_positive'; END IF;
      SELECT COALESCE(SUM(sbl.quantity),0) INTO v_billed
        FROM supplier_bill_lines sbl
        JOIN supplier_bills sb ON sb.id = sbl.bill_id
       WHERE sbl.po_line_id = v_pol.id AND sb.state <> 'cancelled' AND sb.id <> v_bill_id;
      IF v_billed + v_qty > v_pol.quantity THEN
        RAISE EXCEPTION 'overbilling_po_line: % billed=% adding=% max=%', v_pol.id, v_billed, v_qty, v_pol.quantity;
      END IF;
      v_subtotal := round(v_qty * v_pol.unit_price, 2);
      INSERT INTO supplier_bill_lines(bill_id, po_line_id, product_id, description, quantity, unit_price, tax_pct, subtotal)
      VALUES (v_bill_id, v_pol.id, v_pol.product_id, v_pol.description, v_qty, v_pol.unit_price, v_pol.tax_pct, v_subtotal);
      v_total := v_total + v_subtotal;
    END LOOP;
  END IF;

  IF v_total <= 0 THEN
    DELETE FROM supplier_bills WHERE id = v_bill_id;
    RETURN jsonb_build_object('error','nothing_to_bill');
  END IF;

  UPDATE supplier_bills SET amount_total = v_total, state = 'open', updated_at = now() WHERE id = v_bill_id;
  RETURN jsonb_build_object('ok',true,'bill_id',v_bill_id,'amount_total',v_total);
END $$;

-- ---------- supplier_payment_register ----------
CREATE OR REPLACE FUNCTION public.supplier_payment_register(
  _bill_id uuid,
  _amount numeric,
  _method_id uuid DEFAULT NULL,
  _payment_date date DEFAULT NULL,
  _reference text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill record; v_pay_id uuid; v_existing uuid; v_new_paid numeric; v_new_state text;
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

  INSERT INTO supplier_payments(name, bill_id, partner_id, payment_date, amount, method_id, reference, state, idempotency_key, created_by)
  VALUES ('SPAY/'||to_char(now(),'YYYYMMDD/HH24MISSMS'), _bill_id, v_bill.partner_id, COALESCE(_payment_date,CURRENT_DATE),
          _amount, _method_id, _reference, 'posted', _idempotency_key, auth.uid())
  RETURNING id INTO v_pay_id;

  v_new_paid := v_bill.amount_paid + _amount;
  v_new_state := CASE WHEN v_new_paid >= v_bill.amount_total - 0.001 THEN 'paid'
                      WHEN v_new_paid > 0 THEN 'partial'
                      ELSE v_bill.state END;
  UPDATE supplier_bills SET amount_paid = v_new_paid, state = v_new_state, updated_at = now() WHERE id = _bill_id;
  RETURN jsonb_build_object('ok',true,'payment_id',v_pay_id,'amount_paid',v_new_paid,'state',v_new_state);
END $$;

-- ---------- supplier_payment_cancel ----------
CREATE OR REPLACE FUNCTION public.supplier_payment_cancel(
  _payment_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay record; v_bill record; v_new_paid numeric; v_new_state text;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RETURN jsonb_build_object('error','reason_required');
  END IF;
  SELECT * INTO v_pay FROM supplier_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','payment_not_found'); END IF;
  IF v_pay.state = 'cancelled' THEN RETURN jsonb_build_object('error','already_cancelled'); END IF;
  UPDATE supplier_payments SET state='cancelled', cancelled_at=now(), cancelled_by=auth.uid(),
         notes = COALESCE(notes||E'\n','')||'Cancelado: '||_reason
   WHERE id = _payment_id;
  IF v_pay.bill_id IS NOT NULL THEN
    SELECT * INTO v_bill FROM supplier_bills WHERE id = v_pay.bill_id FOR UPDATE;
    v_new_paid := v_bill.amount_paid - v_pay.amount;
    IF v_new_paid < 0 THEN v_new_paid := 0; END IF;
    v_new_state := CASE WHEN v_new_paid >= v_bill.amount_total - 0.001 THEN 'paid'
                        WHEN v_new_paid > 0 THEN 'partial'
                        ELSE 'open' END;
    UPDATE supplier_bills SET amount_paid = v_new_paid, state = v_new_state, updated_at=now() WHERE id = v_pay.bill_id;
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

-- ---------- service_case_cost_add ----------
CREATE OR REPLACE FUNCTION public.service_case_cost_add(
  _service_case_id uuid,
  _kind text,
  _description text,
  _quantity numeric,
  _unit_cost numeric,
  _supplier_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total numeric; v_id uuid;
BEGIN
  IF _kind NOT IN ('internal','supplier') THEN RETURN jsonb_build_object('error','invalid_kind'); END IF;
  IF _kind = 'supplier' AND _supplier_id IS NULL THEN RETURN jsonb_build_object('error','supplier_required'); END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RETURN jsonb_build_object('error','quantity_must_be_positive'); END IF;
  IF _unit_cost IS NULL OR _unit_cost < 0 THEN RETURN jsonb_build_object('error','invalid_unit_cost'); END IF;
  IF NOT EXISTS (SELECT 1 FROM service_cases WHERE id = _service_case_id) THEN
    RETURN jsonb_build_object('error','case_not_found');
  END IF;
  v_total := round(_quantity * _unit_cost, 2);
  INSERT INTO service_case_costs(service_case_id, kind, supplier_id, description, quantity, unit_cost, total_cost, notes, created_by)
  VALUES (_service_case_id, _kind, _supplier_id, _description, _quantity, _unit_cost, v_total, _notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'cost_id',v_id,'total_cost',v_total);
END $$;

-- ---------- service_case_charge_add ----------
CREATE OR REPLACE FUNCTION public.service_case_charge_add(
  _service_case_id uuid,
  _partner_id uuid,
  _kind text,
  _amount numeric,
  _customer_payment_id uuid DEFAULT NULL,
  _customer_credit_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case record; v_id uuid;
BEGIN
  IF _kind NOT IN ('charge','refund','credit') THEN RETURN jsonb_build_object('error','invalid_kind'); END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RETURN jsonb_build_object('error','amount_must_be_positive'); END IF;
  IF _partner_id IS NULL THEN RETURN jsonb_build_object('error','partner_required'); END IF;
  SELECT * INTO v_case FROM service_cases WHERE id = _service_case_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','case_not_found'); END IF;
  IF _kind = 'charge' AND v_case.warranty_status = 'in_warranty' THEN
    RETURN jsonb_build_object('error','warranty_blocks_customer_charge');
  END IF;
  INSERT INTO service_case_charges(service_case_id, partner_id, kind, amount, customer_payment_id, customer_credit_id, notes, created_by)
  VALUES (_service_case_id, _partner_id, _kind, _amount, _customer_payment_id, _customer_credit_id, _notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'charge_id',v_id);
END $$;

-- ============================================================
-- HEALTH CHECK: erp_financial_health_check
-- ============================================================

CREATE OR REPLACE FUNCTION public.erp_financial_health_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_findings jsonb := '[]'::jsonb; v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_count int;
  v_started timestamptz := clock_timestamp();
BEGIN
  -- P0: customer credit negative
  SELECT count(*) INTO v_count FROM customer_credits WHERE remaining_amount < 0;
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','customer_credit_negative','severity','p0','count',v_count,
      'message','Créditos de cliente com remaining_amount negativo'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P0: supplier_bill paid_above_total
  SELECT count(*) INTO v_count FROM supplier_bills WHERE amount_paid > amount_total + 0.001 AND state <> 'cancelled';
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','supplier_bill_paid_above_total','severity','p0','count',v_count,
      'message','Faturas de fornecedor com amount_paid > amount_total'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P0: customer_payment_allocated_above_amount
  SELECT count(*) INTO v_count
    FROM customer_credits c
    JOIN (SELECT credit_id, SUM(amount) s FROM customer_credit_applications WHERE reversed_at IS NULL GROUP BY credit_id) a
      ON a.credit_id = c.id
   WHERE a.s > c.amount + 0.001;
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','customer_credit_overapplied','severity','p0','count',v_count,
      'message','Aplicações de crédito excedem amount original'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P0: cash_movement reversed_twice
  SELECT count(*) INTO v_count FROM (
    SELECT reversal_of_id FROM cash_movements WHERE reversal_of_id IS NOT NULL GROUP BY reversal_of_id HAVING count(*) > 1
  ) x;
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','reversed_cash_movement_twice','severity','p0','count',v_count,
      'message','Movimentos de caixa revertidos mais de uma vez'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P0: duplicated_supplier_bill_for_same_po_line (overbilling)
  SELECT count(*) INTO v_count FROM (
    SELECT sbl.po_line_id, pol.quantity, SUM(sbl.quantity) tot
      FROM supplier_bill_lines sbl
      JOIN supplier_bills sb ON sb.id = sbl.bill_id
      JOIN purchase_order_lines pol ON pol.id = sbl.po_line_id
     WHERE sb.state <> 'cancelled' AND sbl.po_line_id IS NOT NULL
     GROUP BY sbl.po_line_id, pol.quantity
     HAVING SUM(sbl.quantity) > pol.quantity + 0.001
  ) y;
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','duplicated_supplier_bill_for_po_line','severity','p0','count',v_count,
      'message','PO lines com soma de billing > quantidade encomendada'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P0: payment_posted_without_cash_movement (cash-feeding methods only)
  SELECT count(*) INTO v_count
    FROM customer_payments cp
    JOIN payment_methods pm ON pm.id = cp.method_id
   WHERE cp.state = 'posted' AND pm.feeds_cash_session = true
     AND NOT EXISTS (SELECT 1 FROM cash_movements cm WHERE cm.payment_id = cp.id);
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','payment_posted_without_cash_movement','severity','p0','count',v_count,
      'message','Pagamentos posted sem cash_movement em método que alimenta caixa'));
    v_p0 := v_p0 + 1;
  END IF;

  -- P1: supplier_bill_without_lines
  SELECT count(*) INTO v_count FROM supplier_bills sb
   WHERE sb.state NOT IN ('draft','cancelled')
     AND NOT EXISTS (SELECT 1 FROM supplier_bill_lines x WHERE x.bill_id = sb.id);
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','supplier_bill_without_lines','severity','p1','count',v_count,
      'message','Faturas de fornecedor sem linhas'));
    v_p1 := v_p1 + 1;
  END IF;

  -- P1: orphan_customer_credit_application
  SELECT count(*) INTO v_count FROM customer_credit_applications a
   WHERE NOT EXISTS (SELECT 1 FROM customer_credits c WHERE c.id = a.credit_id);
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','orphan_customer_credit_application','severity','p1','count',v_count,
      'message','Aplicações sem credit_id válido'));
    v_p1 := v_p1 + 1;
  END IF;

  -- P1: service_case_charge_without_partner
  SELECT count(*) INTO v_count FROM service_case_charges WHERE partner_id IS NULL;
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','service_case_charge_without_partner','severity','p1','count',v_count,
      'message','Cobranças de assistência sem partner'));
    v_p1 := v_p1 + 1;
  END IF;

  -- P1: service_case_cost_without_case
  SELECT count(*) INTO v_count FROM service_case_costs c
   WHERE NOT EXISTS (SELECT 1 FROM service_cases s WHERE s.id = c.service_case_id);
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','service_case_cost_without_case','severity','p1','count',v_count,
      'message','Custos órfãos sem service_case'));
    v_p1 := v_p1 + 1;
  END IF;

  -- P1: unapplied_customer_credit_aged (>90d)
  SELECT count(*) INTO v_count FROM customer_credits
   WHERE state = 'open' AND remaining_amount > 0 AND created_at < now() - interval '90 days';
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','unapplied_customer_credit_aged','severity','p1','count',v_count,
      'message','Créditos abertos há mais de 90 dias sem aplicação'));
    v_p1 := v_p1 + 1;
  END IF;

  -- P2: excessive manual cash reversals (>5 in 30d)
  SELECT count(*) INTO v_count FROM cash_movements
   WHERE reversal_of_id IS NOT NULL AND created_at > now() - interval '30 days';
  IF v_count > 5 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','excessive_manual_cash_reversals','severity','p2','count',v_count,
      'message','Excesso de reversões manuais de caixa em 30 dias'));
    v_p2 := v_p2 + 1;
  END IF;

  -- P2: assistance_cases_without_cost_tracking (closed cases sem custos)
  SELECT count(*) INTO v_count FROM service_cases sc
   WHERE sc.status = 'closed'
     AND NOT EXISTS (SELECT 1 FROM service_case_costs c WHERE c.service_case_id = sc.id)
     AND NOT EXISTS (SELECT 1 FROM service_case_charges ch WHERE ch.service_case_id = sc.id);
  IF v_count > 0 THEN
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'code','assistance_cases_without_cost_tracking','severity','p2','count',v_count,
      'message','Casos encerrados sem registo de custo nem cobrança'));
    v_p2 := v_p2 + 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', (v_p0 = 0),
    'findings', v_findings,
    'summary', jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,
                                  'duration_ms', extract(milliseconds from clock_timestamp()-v_started)::int)
  );
END $$;

-- ---------- Patch erp_health_check_run to include financial ----------

CREATE OR REPLACE FUNCTION public.erp_health_check_run(_threshold_days integer DEFAULT 7)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb; v_shopfloor jsonb; v_service jsonb; v_portal jsonb; v_fin jsonb;
  v_findings jsonb; v_summary jsonb;
  v_p0 int; v_p1 int; v_p2 int; v_p3 int;
  v_log_id uuid; v_admin record; v_critical int;
BEGIN
  v_result    := public.erp_health_check(_threshold_days);
  v_shopfloor := public.erp_health_check_shopfloor(_threshold_days);
  v_service   := public.erp_service_health_check(_threshold_days);
  v_portal    := public.erp_customer_portal_health_check(_threshold_days);
  v_fin       := public.erp_financial_health_check();
  v_findings := COALESCE(v_result->'findings','[]'::jsonb)
              || COALESCE(v_shopfloor->'findings','[]'::jsonb)
              || COALESCE(v_service->'findings','[]'::jsonb)
              || COALESCE(v_portal->'findings','[]'::jsonb)
              || COALESCE(v_fin->'findings','[]'::jsonb);
  v_p0 := COALESCE((v_result->'summary'->>'p0')::int,0)+COALESCE((v_shopfloor->>'p0')::int,0)+COALESCE((v_service->'summary'->>'p0')::int,0)+COALESCE((v_portal->'summary'->>'p0')::int,0)+COALESCE((v_fin->'summary'->>'p0')::int,0);
  v_p1 := COALESCE((v_result->'summary'->>'p1')::int,0)+COALESCE((v_shopfloor->>'p1')::int,0)+COALESCE((v_service->'summary'->>'p1')::int,0)+COALESCE((v_portal->'summary'->>'p1')::int,0)+COALESCE((v_fin->'summary'->>'p1')::int,0);
  v_p2 := COALESCE((v_result->'summary'->>'p2')::int,0)+COALESCE((v_shopfloor->>'p2')::int,0)+COALESCE((v_service->'summary'->>'p2')::int,0)+COALESCE((v_portal->'summary'->>'p2')::int,0)+COALESCE((v_fin->'summary'->>'p2')::int,0);
  v_p3 := COALESCE((v_result->'summary'->>'p3')::int,0);
  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', COALESCE((v_result->'summary'->>'duration_ms')::int,0),
    'portal_p0', COALESCE((v_portal->'summary'->>'p0')::int,0),
    'portal_p1', COALESCE((v_portal->'summary'->>'p1')::int,0),
    'portal_p2', COALESCE((v_portal->'summary'->>'p2')::int,0),
    'financial_p0', COALESCE((v_fin->'summary'->>'p0')::int,0),
    'financial_p1', COALESCE((v_fin->'summary'->>'p1')::int,0),
    'financial_p2', COALESCE((v_fin->'summary'->>'p2')::int,0));
  INSERT INTO public.erp_health_check_log (summary, findings, p0_count, p1_count, p2_count, p3_count, duration_ms)
  VALUES (v_summary, v_findings, v_p0, v_p1, v_p2, v_p3, (v_summary->>'duration_ms')::int)
  RETURNING id INTO v_log_id;
  v_critical := v_p0 + v_p1;
  IF v_critical > 0 THEN
    FOR v_admin IN SELECT ug.user_id FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id WHERE g.code='system_admin' LOOP
      INSERT INTO public.notifications (user_id, module, type, title, body, link, payload, priority, entity_type, entity_id)
      VALUES (v_admin.user_id, 'core'::public.app_module, 'health_check_critical',
        format('Health check: %s P0 / %s P1', v_p0, v_p1),
        format('Encontradas %s inconsistências críticas. Log %s.', v_critical, v_log_id),
        '/settings/health', v_summary, 'high', 'erp_health_check_log', v_log_id);
    END LOOP;
    UPDATE public.erp_health_check_log SET notified=true WHERE id=v_log_id;
  END IF;
  RETURN v_log_id;
END $function$;
