
CREATE OR REPLACE FUNCTION public._m5_record_payment(_so uuid, _schedule uuid, _route uuid, _payment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_method uuid; v_partner uuid; v_cm uuid; v_cp uuid;
  v_amount numeric; v_code text; v_session uuid; v_state text;
BEGIN
  IF _payment IS NULL THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  v_amount := (_payment->>'amount')::numeric;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_amount'); END IF;
  v_code := UPPER(COALESCE(_payment->>'method_code','CASH'));
  SELECT id INTO v_method FROM payment_methods WHERE code=v_code AND active LIMIT 1;
  IF v_method IS NULL THEN RETURN jsonb_build_object('ok',false,'error','payment_method_missing','code',v_code); END IF;

  SELECT partner_id INTO v_partner FROM sale_orders WHERE id=_so;

  -- NOTE: customer_payments.schedule_id references sale_payment_schedules, NOT
  -- delivery_schedules. We intentionally do NOT bind the delivery schedule here.
  INSERT INTO customer_payments(name, partner_id, order_id, payment_date,
                                amount, method_id, reference, state, created_by, idempotency_key)
  VALUES ('PAY/'||to_char(now(),'YYYYMMDDHH24MISSMS'), v_partner, _so, CURRENT_DATE,
          v_amount, v_method, _payment->>'reference', 'posted', auth.uid(),
          COALESCE(_payment->>'idempotency_key', 'pay:'||COALESCE(_schedule::text,_so::text)||':'||v_amount::text))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_cp;

  v_session := NULLIF(_payment->>'session_id','')::uuid;
  IF v_session IS NOT NULL THEN
    SELECT state INTO v_state FROM cash_sessions WHERE id=v_session;
    IF v_state IS NULL THEN RETURN jsonb_build_object('ok',false,'error','session_not_found'); END IF;
    IF v_state <> 'open' THEN RETURN jsonb_build_object('ok',false,'error','session_not_open'); END IF;
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id,
                               payment_id, route_id)
    VALUES (v_session, 'deposit', abs(v_amount), 'PAY:'||v_code, _payment->>'reference',
            auth.uid(), auth.uid(), v_cp, _route)
    RETURNING id INTO v_cm;
  ELSIF v_code='CASH' THEN
    RETURN jsonb_build_object('ok',false,'error','cash_requires_session');
  END IF;

  RETURN jsonb_build_object('ok',true,'payment_id',v_cp,'cash_movement_id',v_cm,'method',v_code);
END $$;
