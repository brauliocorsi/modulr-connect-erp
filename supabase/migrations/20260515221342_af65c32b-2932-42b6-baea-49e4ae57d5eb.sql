
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS refund_of uuid REFERENCES public.customer_payments(id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_refund_of ON public.customer_payments(refund_of);

CREATE OR REPLACE FUNCTION public.refund_customer_payment(_payment uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  v_register uuid;
  v_session uuid;
  v_method record;
  v_user uuid;
  v_mov_id uuid;
BEGIN
  SELECT * INTO p FROM public.customer_payments WHERE id = _payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  -- Idempotency: already refunded
  IF p.state = 'refunded' THEN
    RETURN p.id;
  END IF;
  IF p.state <> 'posted' THEN
    RAISE EXCEPTION 'Only posted payments can be refunded (state=%)', p.state;
  END IF;
  IF p.refund_of IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot refund a refund record';
  END IF;

  v_user := COALESCE(auth.uid(), p.created_by);

  -- Schedule rollback
  IF p.schedule_id IS NOT NULL THEN
    UPDATE public.sale_payment_schedules
       SET paid_amount = GREATEST(0, COALESCE(paid_amount,0) - p.amount),
           state = CASE
             WHEN GREATEST(0, COALESCE(paid_amount,0) - p.amount) <= 0 THEN 'pending'
             WHEN GREATEST(0, COALESCE(paid_amount,0) - p.amount) < amount THEN 'partial'
             ELSE state
           END
     WHERE id = p.schedule_id;
  END IF;

  -- Cash reversal if the original payment fed a cash session
  SELECT * INTO v_method FROM public.payment_methods WHERE id = p.method_id;
  IF FOUND AND COALESCE(v_method.feeds_cash_session,false) = true THEN
    SELECT id INTO v_register FROM public.cash_registers
      WHERE user_id = v_user AND active ORDER BY created_at LIMIT 1;
    IF v_register IS NULL THEN
      RAISE EXCEPTION 'Refund requires an active cash register for the user';
    END IF;
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE register_id = v_register AND state = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_session IS NULL THEN
      RAISE EXCEPTION 'Refund requires an open cash session';
    END IF;
    PERFORM public.lock_cash_session(v_session);
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, created_by, notes)
    VALUES (v_session, 'refund', -p.amount,
            COALESCE(p.reference, p.name),
            p.partner_id, v_user, v_user,
            'Estorno pagamento '||p.name||COALESCE(' — '||_reason,''))
    RETURNING id INTO v_mov_id;
  END IF;

  -- Mark original as refunded
  UPDATE public.customer_payments SET state = 'refunded' WHERE id = _payment;

  -- Recompute SO payment status
  IF p.order_id IS NOT NULL THEN
    PERFORM public.recalc_payment_status(p.order_id);
  END IF;

  PERFORM public.emit_event('finance'::app_module, 'finance.payment.refunded',
    jsonb_build_object('payment_id', _payment, 'amount', p.amount, 'reason', _reason, 'cash_movement_id', v_mov_id),
    'customer_payments', _payment);

  RETURN _payment;
END $$;

-- =====================================================================
-- Self test
-- =====================================================================
CREATE OR REPLACE FUNCTION public._test_phase6()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asserts jsonb := '[]'::jsonb;
  v_partner uuid; v_so uuid; v_sched uuid; v_method uuid;
  v_register uuid; v_session uuid; v_user uuid;
  v_payment uuid; v_state text; v_paid numeric; v_status text;
  v_mov_count int;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_partner IS NULL OR v_user IS NULL THEN
    RETURN jsonb_build_object('asserts', jsonb_build_array(jsonb_build_object('step','setup','ok',false,'observed','no partner/user')));
  END IF;

  -- Pick or create a cash-feeding payment method
  SELECT id INTO v_method FROM public.payment_methods WHERE COALESCE(feeds_cash_session,false)=true LIMIT 1;
  IF v_method IS NULL THEN
    INSERT INTO public.payment_methods(name, feeds_cash_session) VALUES ('PH6 Cash', true) RETURNING id INTO v_method;
  END IF;

  -- Ensure register + open session for the user
  INSERT INTO public.cash_registers(name, user_id, active)
       VALUES ('PH6-REG-'||substr(gen_random_uuid()::text,1,8), v_user, true)
    RETURNING id INTO v_register;
  INSERT INTO public.cash_sessions(name, register_id, opened_by, opened_at, state, opening_balance)
       VALUES ('PH6-SESS-'||substr(gen_random_uuid()::text,1,8), v_register, v_user, now(), 'open', 0)
    RETURNING id INTO v_session;

  -- SO + schedule + payment
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, payment_status)
       VALUES ('PHASE6-'||gen_random_uuid()::text, v_partner, 'confirmed', 100, 'unpaid')
    RETURNING id INTO v_so;
  INSERT INTO public.sale_payment_schedules(order_id, sequence, label, due_kind, amount, paid_amount, state)
       VALUES (v_so, 1, 'Total', 'on_confirm', 100, 0, 'pending')
    RETURNING id INTO v_sched;
  INSERT INTO public.customer_payments(name, partner_id, order_id, schedule_id, payment_date, amount, method_id, state, created_by)
       VALUES ('PAY-PH6-'||substr(gen_random_uuid()::text,1,8), v_partner, v_so, v_sched, now()::date, 100, v_method, 'posted', v_user)
    RETURNING id INTO v_payment;

  UPDATE public.sale_payment_schedules SET paid_amount = 100, state='paid' WHERE id=v_sched;
  PERFORM public.recalc_payment_status(v_so);

  -- Pretend user is the cashier for the session
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  -- Note: auth.uid() reads from JWT; created_by fallback works in our RPC

  -- Refund
  PERFORM public.refund_customer_payment(v_payment, 'cliente desistiu');

  SELECT state INTO v_state FROM public.customer_payments WHERE id=v_payment;
  asserts := asserts || jsonb_build_object('step','payment_marked_refunded','ok',v_state='refunded','observed',jsonb_build_object('state',v_state));

  SELECT paid_amount, state INTO v_paid, v_state FROM public.sale_payment_schedules WHERE id=v_sched;
  asserts := asserts || jsonb_build_object('step','schedule_rolled_back','ok',v_paid=0 AND v_state='pending','observed',jsonb_build_object('paid_amount',v_paid,'state',v_state));

  SELECT payment_status INTO v_status FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','so_payment_status_unpaid','ok',v_status='unpaid','observed',jsonb_build_object('payment_status',v_status));

  SELECT COUNT(*) INTO v_mov_count FROM public.cash_movements WHERE session_id=v_session AND kind='refund' AND amount = -100;
  asserts := asserts || jsonb_build_object('step','cash_reversal_recorded','ok',v_mov_count=1,'observed',jsonb_build_object('refund_movements',v_mov_count));

  -- Idempotency
  PERFORM public.refund_customer_payment(v_payment, 'retry');
  SELECT COUNT(*) INTO v_mov_count FROM public.cash_movements WHERE session_id=v_session AND kind='refund';
  asserts := asserts || jsonb_build_object('step','idempotent_refund','ok',v_mov_count=1,'observed',jsonb_build_object('refund_movements',v_mov_count));

  -- Cannot refund a refunded again as 'posted'
  BEGIN
    UPDATE public.customer_payments SET state='draft' WHERE id=v_payment;
    PERFORM public.refund_customer_payment(v_payment);
    asserts := asserts || jsonb_build_object('step','only_posted_can_refund','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','only_posted_can_refund','ok',true,'observed',SQLERRM);
  END;

  RETURN jsonb_build_object('asserts', asserts);
END $$;
