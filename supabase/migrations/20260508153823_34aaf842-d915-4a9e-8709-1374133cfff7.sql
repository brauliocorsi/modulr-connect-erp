
-- ============================================================
-- 1. PAYMENT METHODS: new flags
-- ============================================================
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS confirmation_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS feeds_cash_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_reference boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. SALE ORDERS: invoice fields
-- ============================================================
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'not_invoiced',
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS invoice_notes text;

-- ============================================================
-- 3. CUSTOMER PAYMENTS: state can include pending/pending_delivery
-- recalc_payment_status: only count 'posted'
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_payment_status(_so uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE total numeric; paid numeric; status text; has_deposit_done boolean;
BEGIN
  SELECT amount_total INTO total FROM public.sale_orders WHERE id = _so;
  IF total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.customer_payments
   WHERE order_id = _so AND state = 'posted';
  SELECT EXISTS(SELECT 1 FROM public.sale_payment_schedules
   WHERE order_id = _so AND state='paid' AND due_kind='on_confirm') INTO has_deposit_done;
  IF total = 0 OR paid = 0 THEN status := 'unpaid';
  ELSIF paid >= total THEN status := CASE WHEN paid > total THEN 'overpaid' ELSE 'paid' END;
  ELSIF has_deposit_done THEN status := 'deposit_paid';
  ELSE status := 'partial'; END IF;
  UPDATE public.sale_orders SET payment_status = status WHERE id = _so;
END $function$;

-- ============================================================
-- 4. AUTO BALANCE SCHEDULE: when a partial payment posted, auto create "Saldo" line
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_balance_schedule(_so uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE total numeric; sched_sum numeric; remaining numeric; max_seq int;
BEGIN
  SELECT amount_total INTO total FROM public.sale_orders WHERE id = _so;
  IF total IS NULL OR total <= 0 THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO sched_sum FROM public.sale_payment_schedules WHERE order_id = _so;
  remaining := total - sched_sum;
  IF remaining <= 0.01 THEN RETURN; END IF;
  SELECT COALESCE(MAX(sequence),0) INTO max_seq FROM public.sale_payment_schedules WHERE order_id = _so;
  INSERT INTO public.sale_payment_schedules(order_id, sequence, label, due_kind, percent, amount)
  VALUES (_so, max_seq + 10, 'Saldo na entrega', 'on_delivery',
          ROUND((remaining/total)*100, 2), ROUND(remaining, 2));
END $$;

CREATE OR REPLACE FUNCTION public.tg_payment_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE so uuid; total numeric; paid numeric;
BEGIN
  so := COALESCE(NEW.order_id, OLD.order_id);
  IF so IS NOT NULL THEN
    -- ensure a balance line exists if a partial was posted
    IF (TG_OP IN ('INSERT','UPDATE')) AND NEW.state = 'posted' THEN
      SELECT amount_total INTO total FROM public.sale_orders WHERE id = so;
      SELECT COALESCE(SUM(amount),0) INTO paid FROM public.customer_payments
        WHERE order_id = so AND state='posted';
      IF paid < total THEN
        PERFORM public.ensure_balance_schedule(so);
      END IF;
    END IF;
    PERFORM public.allocate_payment_to_schedules(so);
    PERFORM public.recalc_payment_status(so);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Make sure trigger exists (idempotent)
DROP TRIGGER IF EXISTS trg_payments_after ON public.customer_payments;
CREATE TRIGGER trg_payments_after
AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_after_change();

-- ============================================================
-- 5. CASH REGISTERS, SESSIONS, MOVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  warehouse_id uuid REFERENCES public.warehouses(id),
  journal_id uuid REFERENCES public.account_journals(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  opening_balance numeric NOT NULL DEFAULT 0,
  closed_at timestamptz,
  closed_by uuid,
  closing_balance_theoretical numeric,
  closing_balance_counted numeric,
  difference numeric,
  state text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_register_state ON public.cash_sessions(register_id, state);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount numeric NOT NULL,
  reference text,
  partner_id uuid,
  user_id uuid,
  payment_id uuid REFERENCES public.customer_payments(id) ON DELETE SET NULL,
  cost_center_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON public.cash_movements(session_id);

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

-- RLS: any finance user or any authenticated with sales/inventory can view; finance manage
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS cash_registers_view ON public.cash_registers';
  EXECUTE 'DROP POLICY IF EXISTS cash_registers_manage ON public.cash_registers';
  EXECUTE 'DROP POLICY IF EXISTS cash_sessions_view ON public.cash_sessions';
  EXECUTE 'DROP POLICY IF EXISTS cash_sessions_manage ON public.cash_sessions';
  EXECUTE 'DROP POLICY IF EXISTS cash_movements_view ON public.cash_movements';
  EXECUTE 'DROP POLICY IF EXISTS cash_movements_manage ON public.cash_movements';
END $$;

CREATE POLICY cash_registers_view ON public.cash_registers FOR SELECT TO authenticated USING (
  has_permission(auth.uid(),'finance','cash_registers','view')
  OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user')
);
CREATE POLICY cash_registers_manage ON public.cash_registers FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','cash_registers','edit'))
  WITH CHECK (has_permission(auth.uid(),'finance','cash_registers','edit'));

CREATE POLICY cash_sessions_view ON public.cash_sessions FOR SELECT TO authenticated USING (
  has_permission(auth.uid(),'finance','cash_sessions','view')
  OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user')
);
CREATE POLICY cash_sessions_manage ON public.cash_sessions FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','cash_sessions','edit')
         OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user'))
  WITH CHECK (has_permission(auth.uid(),'finance','cash_sessions','edit')
              OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user'));

CREATE POLICY cash_movements_view ON public.cash_movements FOR SELECT TO authenticated USING (
  has_permission(auth.uid(),'finance','cash_movements','view')
  OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user')
);
CREATE POLICY cash_movements_manage ON public.cash_movements FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','cash_movements','edit')
         OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user'))
  WITH CHECK (has_permission(auth.uid(),'finance','cash_movements','create')
              OR has_group(auth.uid(),'sales_user') OR has_group(auth.uid(),'inventory_user'));

-- Sequences
INSERT INTO public.number_sequences(code, prefix, padding, next_number) VALUES
  ('cash_session','CS/',5,1),
  ('cash_movement','CM/',6,1),
  ('supplier_bill','BILL/',5,1),
  ('supplier_payment','SPAY/',5,1)
ON CONFLICT (code) DO NOTHING;

-- Cash session functions
CREATE OR REPLACE FUNCTION public.open_cash_session(_register uuid, _opening numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE prev numeric; sid uuid; n text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE register_id=_register AND state='open') THEN
    RAISE EXCEPTION 'Já existe sessão aberta para este caixa';
  END IF;
  IF _opening IS NULL THEN
    SELECT COALESCE(closing_balance_counted, 0) INTO prev
      FROM public.cash_sessions
      WHERE register_id = _register AND state='closed'
      ORDER BY closed_at DESC NULLS LAST LIMIT 1;
    prev := COALESCE(prev, 0);
  ELSE prev := _opening; END IF;
  n := public.next_sequence('cash_session');
  INSERT INTO public.cash_sessions(name, register_id, opened_by, opening_balance)
   VALUES(n, _register, auth.uid(), prev) RETURNING id INTO sid;
  INSERT INTO public.cash_movements(session_id, kind, amount, reference, created_by, user_id)
   VALUES(sid, 'opening', prev, 'Abertura', auth.uid(), auth.uid());
  RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION public.close_cash_session(_session uuid, _counted numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE theoretical numeric;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO theoretical FROM public.cash_movements WHERE session_id = _session;
  UPDATE public.cash_sessions
   SET state='closed', closed_at=now(), closed_by=auth.uid(),
       closing_balance_theoretical=theoretical,
       closing_balance_counted=_counted,
       difference=_counted - theoretical
   WHERE id=_session AND state='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada ou já fechada'; END IF;
END $$;

-- Trigger: customer_payment posted with cash method → cash_movement
CREATE OR REPLACE FUNCTION public.tg_payment_to_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pm record; wh uuid; reg uuid; sess uuid; n text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.state='posted') OR
     (TG_OP = 'UPDATE' AND NEW.state='posted' AND COALESCE(OLD.state,'') <> 'posted') THEN
    SELECT feeds_cash_session, confirmation_mode INTO pm FROM public.payment_methods WHERE id = NEW.method_id;
    IF pm.feeds_cash_session THEN
      SELECT warehouse_id INTO wh FROM public.sale_orders WHERE id = NEW.order_id;
      IF wh IS NULL THEN wh := public.default_warehouse_id(); END IF;
      SELECT id INTO reg FROM public.cash_registers WHERE warehouse_id = wh AND active LIMIT 1;
      IF reg IS NOT NULL THEN
        SELECT id INTO sess FROM public.cash_sessions WHERE register_id=reg AND state='open' LIMIT 1;
        IF sess IS NOT NULL THEN
          INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by)
          VALUES(sess, 'sale', NEW.amount, NEW.name, NEW.partner_id, NEW.created_by, NEW.id, NEW.created_by);
        END IF;
      END IF;
    END IF;
  ELSIF (TG_OP='UPDATE' AND NEW.state='cancelled' AND OLD.state='posted') THEN
    -- reverse linked movement
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, payment_id, created_by, user_id)
    SELECT cm.session_id, 'cancel', -cm.amount, 'Estorno '||NEW.name, NEW.id, auth.uid(), auth.uid()
    FROM public.cash_movements cm
    WHERE cm.payment_id = NEW.id AND cm.kind='sale'
    AND EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.id=cm.session_id AND cs.state='open');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_to_cash ON public.customer_payments;
CREATE TRIGGER trg_payment_to_cash
AFTER INSERT OR UPDATE ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_to_cash();

-- Confirm pending payment
CREATE OR REPLACE FUNCTION public.confirm_pending_payment(_payment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.customer_payments SET state='posted'
   WHERE id=_payment AND state IN ('pending','pending_delivery');
END $$;

-- ============================================================
-- 6. COST CENTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cc_view ON public.cost_centers;
DROP POLICY IF EXISTS cc_manage ON public.cost_centers;
CREATE POLICY cc_view ON public.cost_centers FOR SELECT TO authenticated USING (
  has_permission(auth.uid(),'finance','cost_centers','view') OR has_group(auth.uid(),'finance_user')
);
CREATE POLICY cc_manage ON public.cost_centers FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','cost_centers','edit'))
  WITH CHECK (has_permission(auth.uid(),'finance','cost_centers','edit'));

ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id);

-- ============================================================
-- 7. SUPPLIER BILLS / PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_id uuid NOT NULL,
  purchase_order_id uuid,
  bill_date date NOT NULL DEFAULT current_date,
  due_date date,
  amount_total numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'draft',
  cost_center_id uuid REFERENCES public.cost_centers(id),
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bill_id uuid REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
  partner_id uuid,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL,
  method_id uuid REFERENCES public.payment_methods(id),
  journal_id uuid REFERENCES public.account_journals(id),
  cost_center_id uuid REFERENCES public.cost_centers(id),
  reference text,
  notes text,
  state text NOT NULL DEFAULT 'posted',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill ON public.supplier_payments(bill_id);

ALTER TABLE public.supplier_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bills_view ON public.supplier_bills;
DROP POLICY IF EXISTS bills_manage ON public.supplier_bills;
CREATE POLICY bills_view ON public.supplier_bills FOR SELECT TO authenticated USING (has_permission(auth.uid(),'finance','bills','view'));
CREATE POLICY bills_manage ON public.supplier_bills FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','bills','edit'))
  WITH CHECK (has_permission(auth.uid(),'finance','bills','edit') OR has_permission(auth.uid(),'finance','bills','create'));

DROP POLICY IF EXISTS spay_view ON public.supplier_payments;
DROP POLICY IF EXISTS spay_manage ON public.supplier_payments;
CREATE POLICY spay_view ON public.supplier_payments FOR SELECT TO authenticated USING (has_permission(auth.uid(),'finance','supplier_payments','view'));
CREATE POLICY spay_manage ON public.supplier_payments FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'finance','supplier_payments','edit'))
  WITH CHECK (has_permission(auth.uid(),'finance','supplier_payments','edit') OR has_permission(auth.uid(),'finance','supplier_payments','create'));

-- Recalc bill state
CREATE OR REPLACE FUNCTION public.recalc_bill_state(_bill uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE total numeric; paid numeric;
BEGIN
  SELECT amount_total INTO total FROM public.supplier_bills WHERE id = _bill;
  IF total IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.supplier_payments
   WHERE bill_id = _bill AND state='posted';
  UPDATE public.supplier_bills
   SET amount_paid = paid,
       state = CASE
         WHEN state='cancelled' THEN 'cancelled'
         WHEN paid >= total AND total > 0 THEN 'paid'
         WHEN paid > 0 THEN 'partial'
         WHEN state='draft' THEN 'draft'
         ELSE 'posted'
       END
   WHERE id = _bill;
END $$;

CREATE OR REPLACE FUNCTION public.tg_supplier_payment_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.bill_id, OLD.bill_id) IS NOT NULL THEN
    PERFORM public.recalc_bill_state(COALESCE(NEW.bill_id, OLD.bill_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_spay_after ON public.supplier_payments;
CREATE TRIGGER trg_spay_after
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_supplier_payment_after();

-- ============================================================
-- 8. PERMISSIONS: register new entities
-- ============================================================
DO $$
DECLARE g_user uuid; g_mgr uuid; ent text; act permission_action;
DECLARE entities text[] := ARRAY['cash_registers','cash_sessions','cash_movements','bills','supplier_payments','cost_centers'];
BEGIN
  SELECT id INTO g_user FROM public.groups WHERE code='finance_user';
  SELECT id INTO g_mgr FROM public.groups WHERE code='finance_manager';
  FOREACH ent IN ARRAY entities LOOP
    -- finance_user gets view/create/edit
    FOREACH act IN ARRAY ARRAY['view','create','edit']::permission_action[] LOOP
      INSERT INTO public.group_permissions(group_id, module, entity, action)
      VALUES(g_user,'finance',ent,act) ON CONFLICT DO NOTHING;
    END LOOP;
    -- finance_manager gets all
    FOREACH act IN ARRAY ARRAY['view','create','edit','delete','export']::permission_action[] LOOP
      INSERT INTO public.group_permissions(group_id, module, entity, action)
      VALUES(g_mgr,'finance',ent,act) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- updated_at triggers
DROP TRIGGER IF EXISTS tg_cash_registers_uat ON public.cash_registers;
CREATE TRIGGER tg_cash_registers_uat BEFORE UPDATE ON public.cash_registers
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS tg_supplier_bills_uat ON public.supplier_bills;
CREATE TRIGGER tg_supplier_bills_uat BEFORE UPDATE ON public.supplier_bills
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
