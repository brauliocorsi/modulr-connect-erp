
CREATE OR REPLACE FUNCTION public.refund_customer_payment(_payment uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  orig_mov record;
  v_register uuid;
  v_session uuid;
  v_method record;
  v_user uuid;
  v_mov_id uuid;
BEGIN
  SELECT * INTO p FROM public.customer_payments WHERE id = _payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  IF p.state = 'refunded' THEN RETURN p.id; END IF;
  IF p.state <> 'posted' THEN
    RAISE EXCEPTION 'Only posted payments can be refunded (state=%)', p.state;
  END IF;
  IF p.refund_of IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot refund a refund record';
  END IF;

  v_user := COALESCE(auth.uid(), p.created_by);

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

  SELECT * INTO v_method FROM public.payment_methods WHERE id = p.method_id;
  IF FOUND AND COALESCE(v_method.feeds_cash_session,false) = true THEN
    -- Prefer original session's register
    SELECT cm.session_id, cs.register_id, cs.state
      INTO orig_mov
      FROM public.cash_movements cm
      JOIN public.cash_sessions cs ON cs.id = cm.session_id
     WHERE cm.payment_id = _payment
     ORDER BY cm.created_at LIMIT 1;

    IF orig_mov.register_id IS NOT NULL THEN
      v_register := orig_mov.register_id;
    ELSE
      SELECT id INTO v_register FROM public.cash_registers
        WHERE user_id = v_user AND active ORDER BY created_at LIMIT 1;
    END IF;

    IF v_register IS NULL THEN
      RAISE EXCEPTION 'Refund requires a cash register';
    END IF;

    SELECT id INTO v_session FROM public.cash_sessions
      WHERE register_id = v_register AND state = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF v_session IS NULL THEN
      RAISE EXCEPTION 'Refund requires an open cash session on register %', v_register;
    END IF;

    PERFORM public.lock_cash_session(v_session);
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, created_by, notes)
    VALUES (v_session, 'refund', -p.amount,
            COALESCE(p.reference, p.name),
            p.partner_id, v_user, v_user,
            'Estorno pagamento '||p.name||COALESCE(' — '||_reason,''))
    RETURNING id INTO v_mov_id;
  END IF;

  UPDATE public.customer_payments SET state = 'refunded' WHERE id = _payment;

  IF p.order_id IS NOT NULL THEN
    PERFORM public.recalc_payment_status(p.order_id);
  END IF;

  PERFORM public.emit_event('finance'::app_module, 'finance.payment.refunded',
    jsonb_build_object('payment_id', _payment, 'amount', p.amount, 'reason', _reason, 'cash_movement_id', v_mov_id),
    'customer_payments', _payment);

  RETURN _payment;
END $$;
