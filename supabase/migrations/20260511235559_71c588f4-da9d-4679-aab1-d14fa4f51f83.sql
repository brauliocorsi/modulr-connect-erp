-- Default payment methods to feed cash session, and update existing rows
ALTER TABLE public.payment_methods ALTER COLUMN feeds_cash_session SET DEFAULT true;
UPDATE public.payment_methods SET feeds_cash_session = true WHERE feeds_cash_session = false;

-- Backfill cash_movements for posted payments that have an open session for the user
DO $$
DECLARE
  p record; v_register uuid; v_session uuid;
BEGIN
  FOR p IN
    SELECT cp.* FROM public.customer_payments cp
    LEFT JOIN public.cash_movements cm ON cm.payment_id = cp.id
    WHERE cp.state = 'posted' AND COALESCE(cp.amount,0) > 0 AND cm.id IS NULL AND cp.created_by IS NOT NULL
  LOOP
    SELECT id INTO v_register FROM public.cash_registers WHERE user_id = p.created_by AND active ORDER BY created_at LIMIT 1;
    IF v_register IS NULL THEN CONTINUE; END IF;
    SELECT id INTO v_session FROM public.cash_sessions WHERE register_id = v_register AND state='open' ORDER BY opened_at DESC LIMIT 1;
    IF v_session IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by, notes)
    VALUES (v_session, 'sale', p.amount, COALESCE(p.reference, p.name), p.partner_id, p.created_by, p.id, p.created_by, 'Backfill: pagamento ' || p.name);
  END LOOP;
END $$;