CREATE OR REPLACE FUNCTION public.allocate_payment_to_schedules(_so uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; remaining numeric; apply numeric; targeted numeric; unallocated numeric;
BEGIN
  -- reset
  UPDATE public.sale_payment_schedules SET paid_amount=0, state='pending' WHERE order_id = _so;

  -- 1) aplicar pagamentos com schedule_id explícito
  FOR s IN
    SELECT schedule_id, COALESCE(SUM(amount),0) AS amt
      FROM public.customer_payments
     WHERE order_id = _so AND state='posted' AND schedule_id IS NOT NULL
     GROUP BY schedule_id
  LOOP
    UPDATE public.sale_payment_schedules sch
       SET paid_amount = LEAST(s.amt, sch.amount),
           state = CASE
                     WHEN s.amt >= sch.amount THEN 'paid'
                     WHEN s.amt > 0 THEN 'partial'
                     ELSE 'pending'
                   END
     WHERE sch.id = s.schedule_id;
  END LOOP;

  -- 2) distribuir pagamentos sem schedule_id pelas parcelas em aberto, por ordem
  SELECT COALESCE(SUM(amount),0) INTO unallocated
    FROM public.customer_payments
   WHERE order_id = _so AND state='posted' AND schedule_id IS NULL;

  remaining := unallocated;
  FOR s IN
    SELECT * FROM public.sale_payment_schedules
     WHERE order_id = _so
     ORDER BY sequence, created_at
  LOOP
    EXIT WHEN remaining <= 0;
    apply := LEAST(remaining, GREATEST(0, s.amount - COALESCE(s.paid_amount,0)));
    IF apply > 0 THEN
      UPDATE public.sale_payment_schedules
         SET paid_amount = COALESCE(paid_amount,0) + apply,
             state = CASE
                       WHEN COALESCE(paid_amount,0) + apply >= amount THEN 'paid'
                       WHEN COALESCE(paid_amount,0) + apply > 0 THEN 'partial'
                       ELSE 'pending'
                     END
       WHERE id = s.id;
      remaining := remaining - apply;
    END IF;
  END LOOP;
END $function$;