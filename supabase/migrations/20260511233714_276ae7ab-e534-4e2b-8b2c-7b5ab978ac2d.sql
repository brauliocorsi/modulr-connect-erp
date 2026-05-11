-- Auto-link customer payments to the creator's open cash session
CREATE OR REPLACE FUNCTION public.tg_payment_register_cash_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid;
  v_register uuid;
  v_session uuid;
  v_method record;
BEGIN
  IF NEW.state <> 'posted' OR COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Skip if a cash_movement already exists for this payment (e.g., driver flow handled it).
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_user := COALESCE(NEW.created_by, auth.uid());
  IF v_user IS NULL THEN RETURN NEW; END IF;

  -- Optional: respect feeds_cash_session flag if available; otherwise feed for any method.
  SELECT * INTO v_method FROM public.payment_methods WHERE id = NEW.method_id;
  IF FOUND AND v_method.feeds_cash_session = false THEN
    RETURN NEW;
  END IF;

  -- Find an active register owned by the user
  SELECT id INTO v_register
    FROM public.cash_registers
   WHERE user_id = v_user AND active
   ORDER BY created_at
   LIMIT 1;
  IF v_register IS NULL THEN RETURN NEW; END IF;

  -- Find an open session on that register
  SELECT id INTO v_session
    FROM public.cash_sessions
   WHERE register_id = v_register AND state = 'open'
   ORDER BY opened_at DESC
   LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by, notes)
  VALUES (
    v_session,
    'sale',
    NEW.amount,
    COALESCE(NEW.reference, NEW.name),
    NEW.partner_id,
    v_user,
    NEW.id,
    v_user,
    'Auto: pagamento ' || NEW.name
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_register_cash_movement ON public.customer_payments;
CREATE TRIGGER trg_payment_register_cash_movement
AFTER INSERT OR UPDATE OF state, amount ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_register_cash_movement();