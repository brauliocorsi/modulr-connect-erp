-- Extend register_customer_payment to support notes + method confirmation_mode
CREATE OR REPLACE FUNCTION public.register_customer_payment(
  _order uuid,
  _amount numeric,
  _method uuid,
  _journal uuid DEFAULT NULL,
  _schedule uuid DEFAULT NULL,
  _reference text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _payment_date date DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner uuid; v_existing public.customer_payments; v_new public.customer_payments;
  v_name text; v_mode text; v_state text; v_requires_ref boolean;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Valor inválido: %', _amount USING ERRCODE='check_violation'; END IF;
  IF _order IS NULL THEN RAISE EXCEPTION 'order_id obrigatório'; END IF;
  IF _method IS NULL THEN RAISE EXCEPTION 'method obrigatório'; END IF;

  PERFORM public.lock_order_payments(_order);

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.customer_payments
      WHERE order_id=_order AND idempotency_key=_idempotency_key LIMIT 1;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT confirmation_mode, requires_reference
    INTO v_mode, v_requires_ref
    FROM public.payment_methods WHERE id=_method;

  IF COALESCE(v_requires_ref,false) AND (_reference IS NULL OR length(trim(_reference))=0) THEN
    RAISE EXCEPTION 'Método exige referência';
  END IF;

  v_state := CASE
    WHEN v_mode = 'pending_finance'  THEN 'pending'
    WHEN v_mode = 'pending_delivery' THEN 'pending_delivery'
    ELSE 'posted'
  END;

  SELECT partner_id INTO v_partner FROM public.sale_orders WHERE id=_order;
  v_name := 'PAY/'||to_char(now(),'YYYYMMDDHH24MISSMS')||'/'||replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.customer_payments
    (name, partner_id, order_id, schedule_id, payment_date, amount, method_id, journal_id,
     reference, notes, state, idempotency_key, created_by)
  VALUES (v_name, v_partner, _order, _schedule, COALESCE(_payment_date, CURRENT_DATE),
          _amount, _method, _journal, _reference, _notes, v_state, _idempotency_key, auth.uid())
  RETURNING * INTO v_new;
  RETURN v_new;
END $function$;

-- New: cancel_customer_payment (only pending/draft states)
CREATE OR REPLACE FUNCTION public.cancel_customer_payment(
  _payment_id uuid,
  _reason text DEFAULT NULL
)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p public.customer_payments;
BEGIN
  IF _payment_id IS NULL THEN RAISE EXCEPTION 'payment_id obrigatório'; END IF;

  SELECT * INTO v_p FROM public.customer_payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;

  PERFORM public.lock_order_payments(v_p.order_id);

  -- idempotência: já cancelado retorna como está
  IF v_p.state = 'cancelled' THEN RETURN v_p; END IF;

  IF v_p.state NOT IN ('pending','pending_delivery','draft') THEN
    RAISE EXCEPTION 'Não é possível cancelar pagamento no estado %, use refund_customer_payment', v_p.state
      USING ERRCODE='check_violation';
  END IF;

  UPDATE public.customer_payments
     SET state='cancelled',
         notes = COALESCE(notes,'') ||
                 CASE WHEN _reason IS NOT NULL
                      THEN E'\n[cancel] '||_reason ELSE '' END
   WHERE id=_payment_id
   RETURNING * INTO v_p;

  RETURN v_p;
END $function$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_payment(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_customer_payment(uuid,numeric,uuid,uuid,uuid,text,text,date,text) TO authenticated;