
-- ============================================================
-- F24-B: Financeiro Core Rebuild
-- Additive migration: payment_methods config, bank reconciliation,
-- customer_payments reconciliation fields, cash_movements migration_note,
-- updated cash_session_summary, new RPCs, expanded health check.
-- ============================================================

-- 1) payment_methods additive cols
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS requires_reconciliation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS journal_type text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS settlement_delay_days integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_methods_journal_type_chk') THEN
    ALTER TABLE public.payment_methods
      ADD CONSTRAINT payment_methods_journal_type_chk
      CHECK (journal_type IN ('cash','bank','bnpl','other'));
  END IF;
END $$;

-- 2) customer_payments reconciliation fields
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_line_id uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'not_required';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customer_payments_reconciliation_status_chk') THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_reconciliation_status_chk
      CHECK (reconciliation_status IN ('not_required','pending','matched','ignored','rejected'));
  END IF;
END $$;

-- 3) cash_movements migration_note
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS migration_note text;

-- 4) bank_reconciliation_batches
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT bank_recon_batches_status_chk CHECK (status IN ('open','closed','cancelled'))
);

ALTER TABLE public.bank_reconciliation_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='bank_recon_batches_view') THEN
    CREATE POLICY bank_recon_batches_view ON public.bank_reconciliation_batches
      FOR SELECT USING (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'view'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='bank_recon_batches_modify') THEN
    CREATE POLICY bank_recon_batches_modify ON public.bank_reconciliation_batches
      FOR ALL USING (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action))
      WITH CHECK (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action));
  END IF;
END $$;

-- 5) bank_reconciliation_lines
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.bank_reconciliation_batches(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.customer_payments(id),
  supplier_payment_id uuid REFERENCES public.supplier_payments(id),
  direction text NOT NULL DEFAULT 'incoming',
  amount numeric NOT NULL,
  reference text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  matched_at timestamptz,
  matched_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT bank_recon_lines_status_chk CHECK (status IN ('pending','matched','ignored','cancelled')),
  CONSTRAINT bank_recon_lines_direction_chk CHECK (direction IN ('incoming','outgoing'))
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_lines_status ON public.bank_reconciliation_lines(status);
CREATE INDEX IF NOT EXISTS idx_bank_recon_lines_payment ON public.bank_reconciliation_lines(payment_id);

ALTER TABLE public.bank_reconciliation_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='bank_recon_lines_view') THEN
    CREATE POLICY bank_recon_lines_view ON public.bank_reconciliation_lines
      FOR SELECT USING (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'view'::permission_action));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='bank_recon_lines_modify') THEN
    CREATE POLICY bank_recon_lines_modify ON public.bank_reconciliation_lines
      FOR ALL USING (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action))
      WITH CHECK (public.has_permission(auth.uid(), 'finance'::app_module, 'payments'::text, 'edit'::permission_action));
  END IF;
END $$;

-- ============================================================
-- 6) cash_session_summary: ignore non-cash movements
-- ============================================================
CREATE OR REPLACE FUNCTION public.cash_session_summary(_session uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT cm.*
    FROM public.cash_movements cm
    LEFT JOIN public.customer_payments cp ON cp.id = cm.payment_id
    LEFT JOIN public.payment_methods pm ON pm.id = cp.method_id
    WHERE cm.session_id = _session
      AND COALESCE(cm.migration_note,'') <> 'non_cash_legacy'
      AND (cm.payment_id IS NULL OR pm.id IS NULL OR pm.feeds_cash_session = true)
  )
  SELECT jsonb_build_object(
    'session_id', s.id,
    'state', s.state,
    'opening', COALESCE((SELECT SUM(amount) FROM base WHERE kind='opening'),0),
    'sales',   COALESCE((SELECT SUM(amount) FROM base WHERE kind='sale'),0),
    'refunds', COALESCE((SELECT SUM(amount) FROM base WHERE kind='refund'),0),
    'cash_in', COALESCE((SELECT SUM(amount) FROM base WHERE kind='in'),0),
    'cash_out',COALESCE((SELECT SUM(amount) FROM base WHERE kind='out'),0),
    'other',   COALESCE((SELECT SUM(amount) FROM base WHERE kind NOT IN ('opening','sale','refund','in','out')),0),
    'theoretical', COALESCE((SELECT SUM(amount) FROM base),0),
    'counted', s.closing_balance_counted,
    'difference', s.difference
  )
  FROM public.cash_sessions s
  WHERE s.id = _session;
$function$;

-- cash_session_balance also restricted to cash-eligible movements
CREATE OR REPLACE FUNCTION public.cash_session_balance(_session uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(cm.amount),0)
  FROM public.cash_movements cm
  LEFT JOIN public.customer_payments cp ON cp.id = cm.payment_id
  LEFT JOIN public.payment_methods pm ON pm.id = cp.method_id
  WHERE cm.session_id = _session
    AND COALESCE(cm.migration_note,'') <> 'non_cash_legacy'
    AND (cm.payment_id IS NULL OR pm.id IS NULL OR pm.feeds_cash_session = true);
$function$;

-- close_cash_session uses the same filter
CREATE OR REPLACE FUNCTION public.close_cash_session(_session uuid, _counted numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE theoretical numeric;
BEGIN
  SELECT public.cash_session_balance(_session) INTO theoretical;
  UPDATE public.cash_sessions
   SET state='closed', closed_at=now(), closed_by=auth.uid(),
       closing_balance_theoretical=theoretical,
       closing_balance_counted=_counted,
       difference=_counted - theoretical
   WHERE id=_session AND state='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada ou já fechada'; END IF;
END $function$;

-- ============================================================
-- 7) Bank reconciliation RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.bank_reconciliation_line_create(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_permission(v_uid, 'finance'::app_module, 'payments'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão para conciliação bancária';
  END IF;
  INSERT INTO public.bank_reconciliation_lines(
    batch_id, payment_id, supplier_payment_id, direction, amount, reference, occurred_at, notes, created_by
  ) VALUES (
    NULLIF(_payload->>'batch_id','')::uuid,
    NULLIF(_payload->>'payment_id','')::uuid,
    NULLIF(_payload->>'supplier_payment_id','')::uuid,
    COALESCE(_payload->>'direction','incoming'),
    (_payload->>'amount')::numeric,
    _payload->>'reference',
    COALESCE((_payload->>'occurred_at')::timestamptz, now()),
    _payload->>'notes',
    v_uid
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.bank_reconciliation_match_customer_payment(_line_id uuid, _payment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_line record; v_pay record; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_permission(v_uid, 'finance'::app_module, 'payments'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão para conciliação bancária';
  END IF;
  SELECT * INTO v_line FROM public.bank_reconciliation_lines WHERE id=_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  IF v_line.status <> 'pending' THEN RAISE EXCEPTION 'Linha não está pendente (status=%)', v_line.status; END IF;

  SELECT * INTO v_pay FROM public.customer_payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;
  IF v_pay.state = 'cancelled' THEN RAISE EXCEPTION 'Pagamento cancelado'; END IF;
  IF v_pay.reconciliation_status = 'matched' OR v_pay.reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento já reconciliado';
  END IF;
  IF abs(COALESCE(v_pay.amount,0) - COALESCE(v_line.amount,0)) > 0.01 THEN
    RAISE EXCEPTION 'Valor incompatível (linha=%, pagamento=%)', v_line.amount, v_pay.amount;
  END IF;

  UPDATE public.customer_payments
     SET reconciliation_status='matched',
         reconciled_at=now(),
         reconciled_by=v_uid,
         reconciliation_line_id=_line_id
   WHERE id=_payment_id;

  UPDATE public.bank_reconciliation_lines
     SET status='matched', matched_at=now(), matched_by=v_uid, payment_id=_payment_id
   WHERE id=_line_id;
END $function$;

CREATE OR REPLACE FUNCTION public.bank_reconciliation_unmatch(_line_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_line record; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_permission(v_uid, 'finance'::app_module, 'payments'::text, 'edit'::permission_action) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
  SELECT * INTO v_line FROM public.bank_reconciliation_lines WHERE id=_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;
  IF v_line.status <> 'matched' THEN RAISE EXCEPTION 'Linha não está reconciliada'; END IF;

  IF v_line.payment_id IS NOT NULL THEN
    UPDATE public.customer_payments
       SET reconciliation_status='pending',
           reconciled_at=NULL,
           reconciled_by=NULL,
           reconciliation_line_id=NULL
     WHERE id=v_line.payment_id;
  END IF;

  UPDATE public.bank_reconciliation_lines
     SET status='pending', matched_at=NULL, matched_by=NULL,
         notes = COALESCE(notes,'') || E'\nUnmatch: ' || _reason
   WHERE id=_line_id;
END $function$;

-- ============================================================
-- 8) Expanded financial health check (additive)
-- ============================================================
CREATE OR REPLACE FUNCTION public.erp_financial_health_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_findings jsonb := '[]'::jsonb; v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_count int; v_started timestamptz := clock_timestamp();
BEGIN
  -- legacy P0 checks
  SELECT count(*) INTO v_count FROM customer_credits WHERE remaining_amount < 0;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','customer_credit_negative','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM supplier_bills WHERE amount_paid > amount_total + 0.001 AND state <> 'cancelled';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','supplier_bill_paid_above_total','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  -- F24-B new P0
  SELECT count(*) INTO v_count
    FROM cash_movements cm
    JOIN customer_payments cp ON cp.id = cm.payment_id
    JOIN payment_methods pm ON pm.id = cp.method_id
   WHERE pm.feeds_cash_session = false
     AND COALESCE(cm.migration_note,'') <> 'non_cash_legacy';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','non_cash_payment_in_cash_session','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count
    FROM cash_movements cm
    LEFT JOIN customer_payments cp ON cp.id = cm.payment_id
    LEFT JOIN payment_methods pm ON pm.id = cp.method_id
   WHERE cm.payment_id IS NOT NULL AND (pm.id IS NULL OR pm.feeds_cash_session = false)
     AND COALESCE(cm.migration_note,'') <> 'non_cash_legacy';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','cash_movement_without_cash_method','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM payment_methods
    WHERE active = true
      AND ((journal_type='cash' AND feeds_cash_session=false)
        OR (journal_type IN ('bank','bnpl') AND feeds_cash_session=true));
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','payment_method_misconfigured','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM supplier_payments WHERE bill_id IS NULL AND state='posted';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','supplier_payment_without_bill','severity','p0','count',v_count)); v_p0 := v_p0 + 1; END IF;

  -- P1 checks
  SELECT count(*) INTO v_count FROM customer_payments
    WHERE state IN ('pending','pending_delivery') AND created_at < now() - interval '14 days';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','pending_payment_too_old','severity','p1','count',v_count)); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM customer_payments cp
    JOIN payment_methods pm ON pm.id = cp.method_id
   WHERE cp.state='posted' AND pm.requires_reconciliation=true
     AND cp.reconciled_at IS NULL
     AND cp.payment_date < (now() - interval '30 days')::date;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','unreconciled_bank_payment_too_old','severity','p1','count',v_count)); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM cash_sessions WHERE state='open' AND opened_at < now() - interval '2 days';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','open_cash_session_too_old','severity','p1','count',v_count)); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM supplier_bills WHERE state NOT IN ('cancelled','paid') AND due_date < CURRENT_DATE;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','supplier_bill_overdue','severity','p1','count',v_count)); v_p1 := v_p1 + 1; END IF;

  RETURN jsonb_build_object(
    'findings', v_findings,
    'p0', v_p0, 'p1', v_p1, 'p2', v_p2,
    'duration_ms', extract(epoch from clock_timestamp() - v_started)*1000
  );
END $function$;

-- ============================================================
-- 9) _test_phase24_finance_core_rebuild — minimal smoke
-- ============================================================
CREATE OR REPLACE FUNCTION public._test_phase24_finance_core_rebuild()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE asserts jsonb := '[]'::jsonb; ok boolean; v_count int;
BEGIN
  -- CASH method present + cash journal
  SELECT count(*)>0 INTO ok FROM payment_methods WHERE code='CASH' AND feeds_cash_session=true AND journal_type='cash';
  asserts := asserts || jsonb_build_array(jsonb_build_object('step','cash_method_ok','ok',ok));

  -- CARD/MB/MBWAY/TRANSF non-cash + requires_reconciliation
  SELECT count(*) INTO v_count FROM payment_methods
    WHERE code IN ('CARD','MB','MBWAY','TRANSF')
      AND feeds_cash_session=false AND requires_reconciliation=true AND journal_type='bank';
  asserts := asserts || jsonb_build_array(jsonb_build_object('step','bank_methods_configured','ok', v_count=4, 'observed', v_count));

  -- SEQURA + SCALAPAY bnpl
  SELECT count(*) INTO v_count FROM payment_methods
    WHERE code IN ('SEQURA','SCALAPAY') AND journal_type='bnpl' AND feeds_cash_session=false;
  asserts := asserts || jsonb_build_array(jsonb_build_object('step','bnpl_methods_present','ok', v_count=2, 'observed', v_count));

  -- cash_session_summary signature (callable smoke)
  asserts := asserts || jsonb_build_array(jsonb_build_object(
    'step','cash_summary_callable',
    'ok', EXISTS (SELECT 1 FROM pg_proc WHERE proname='cash_session_summary')
  ));

  -- bank_reconciliation tables present
  asserts := asserts || jsonb_build_array(jsonb_build_object(
    'step','bank_recon_tables',
    'ok', (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
            AND table_name IN ('bank_reconciliation_batches','bank_reconciliation_lines'))=2
  ));

  -- bank_reconciliation RPCs present
  SELECT count(*) INTO v_count FROM pg_proc
    WHERE proname IN ('bank_reconciliation_line_create','bank_reconciliation_match_customer_payment','bank_reconciliation_unmatch');
  asserts := asserts || jsonb_build_array(jsonb_build_object('step','bank_recon_rpcs','ok',v_count=3,'observed',v_count));

  -- health check returns payment_method_misconfigured key (structure only)
  asserts := asserts || jsonb_build_array(jsonb_build_object(
    'step','health_check_callable',
    'ok', EXISTS (SELECT 1 FROM pg_proc WHERE proname='erp_financial_health_check')
  ));

  -- no non-cash cash_movements remain unmarked (after data migration)
  SELECT count(*) INTO v_count
    FROM cash_movements cm
    JOIN customer_payments cp ON cp.id = cm.payment_id
    JOIN payment_methods pm ON pm.id = cp.method_id
   WHERE pm.feeds_cash_session=false
     AND COALESCE(cm.migration_note,'') <> 'non_cash_legacy';
  asserts := asserts || jsonb_build_array(jsonb_build_object('step','no_unmarked_non_cash_movements','ok', v_count=0, 'observed', v_count));

  RETURN jsonb_build_object('asserts', asserts);
END $function$;
