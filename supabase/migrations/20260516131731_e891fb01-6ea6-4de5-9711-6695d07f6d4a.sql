
DROP INDEX IF EXISTS public.ux_customer_payments_idempotency_key;
CREATE UNIQUE INDEX ux_customer_payments_idempotency_key
  ON public.customer_payments(idempotency_key);
