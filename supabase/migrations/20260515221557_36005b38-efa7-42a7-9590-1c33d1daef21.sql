
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

  SELECT id INTO v_method FROM public.payment_methods WHERE COALESCE(feeds_cash_session,false)=true LIMIT 1;

  INSERT INTO public.cash_registers(name, user_id, active)
       VALUES ('PH6-REG-'||substr(gen_random_uuid()::text,1,8), v_user, true)
    RETURNING id INTO v_register;
  INSERT INTO public.cash_sessions(name, register_id, opened_by, opened_at, state, opening_balance)
       VALUES ('PH6-SESS-'||substr(gen_random_uuid()::text,1,8), v_register, v_user, now(), 'open', 0)
    RETURNING id INTO v_session;

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

  -- Manually create the original cash movement (auto-trigger needs JWT user)
  IF NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = v_payment) THEN
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by, notes)
    VALUES (v_session, 'sale', 100, 'PH6 original', v_partner, v_user, v_payment, v_user, 'PH6 manual original');
  END IF;

  PERFORM public.refund_customer_payment(v_payment, 'cliente desistiu');

  SELECT state INTO v_state FROM public.customer_payments WHERE id=v_payment;
  asserts := asserts || jsonb_build_object('step','payment_marked_refunded','ok',v_state='refunded','observed',jsonb_build_object('state',v_state));

  SELECT paid_amount, state INTO v_paid, v_state FROM public.sale_payment_schedules WHERE id=v_sched;
  asserts := asserts || jsonb_build_object('step','schedule_rolled_back','ok',v_paid=0 AND v_state='pending','observed',jsonb_build_object('paid_amount',v_paid,'state',v_state));

  SELECT payment_status INTO v_status FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','so_payment_status_unpaid','ok',v_status='unpaid','observed',jsonb_build_object('payment_status',v_status));

  SELECT COUNT(*) INTO v_mov_count FROM public.cash_movements WHERE session_id=v_session AND kind='refund' AND amount = -100;
  asserts := asserts || jsonb_build_object('step','cash_reversal_recorded','ok',v_mov_count=1,'observed',jsonb_build_object('refund_movements',v_mov_count));

  PERFORM public.refund_customer_payment(v_payment, 'retry');
  SELECT COUNT(*) INTO v_mov_count FROM public.cash_movements WHERE session_id=v_session AND kind='refund';
  asserts := asserts || jsonb_build_object('step','idempotent_refund','ok',v_mov_count=1,'observed',jsonb_build_object('refund_movements',v_mov_count));

  BEGIN
    UPDATE public.customer_payments SET state='draft' WHERE id=v_payment;
    PERFORM public.refund_customer_payment(v_payment);
    asserts := asserts || jsonb_build_object('step','only_posted_can_refund','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','only_posted_can_refund','ok',true,'observed',SQLERRM);
  END;

  RETURN jsonb_build_object('asserts', asserts);
END $$;
