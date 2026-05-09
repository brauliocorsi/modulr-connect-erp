CREATE OR REPLACE FUNCTION public.prevent_overpayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_paid  numeric;
  v_open  numeric;
  v_name  text;
  v_sched_amount numeric;
  v_sched_paid numeric;
  v_sched_open numeric;
  v_sched_label text;
BEGIN
  IF NEW.state = 'cancelled' OR NEW.order_id IS NULL OR COALESCE(NEW.amount,0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT amount_total, name INTO v_total, v_name
    FROM public.sale_orders WHERE id = NEW.order_id;

  IF v_total IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.customer_payments
   WHERE order_id = NEW.order_id
     AND state <> 'cancelled'
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  v_open := v_total - v_paid;

  IF NEW.amount > v_open + 0.01 THEN
    RAISE EXCEPTION 'Recebimento excede o valor em aberto da venda % (em aberto: % €, tentativa: % €)',
      v_name,
      to_char(v_open, 'FM999G990D00'),
      to_char(NEW.amount, 'FM999G990D00')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.schedule_id IS NOT NULL THEN
    SELECT amount, label INTO v_sched_amount, v_sched_label
      FROM public.sale_payment_schedules WHERE id = NEW.schedule_id;
    IF v_sched_amount IS NOT NULL THEN
      SELECT COALESCE(SUM(amount), 0) INTO v_sched_paid
        FROM public.customer_payments
       WHERE schedule_id = NEW.schedule_id
         AND state <> 'cancelled'
         AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
      v_sched_open := v_sched_amount - v_sched_paid;
      IF NEW.amount > v_sched_open + 0.01 THEN
        RAISE EXCEPTION 'Recebimento excede o valor da parcela "%" (em aberto: % €, tentativa: % €)',
          COALESCE(v_sched_label, 'parcela'),
          to_char(v_sched_open, 'FM999G990D00'),
          to_char(NEW.amount, 'FM999G990D00')
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_overpayment_trg ON public.customer_payments;
CREATE TRIGGER prevent_overpayment_trg
BEFORE INSERT OR UPDATE ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.prevent_overpayment();