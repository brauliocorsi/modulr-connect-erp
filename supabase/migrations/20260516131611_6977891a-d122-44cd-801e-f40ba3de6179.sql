
-- 1) Partial unique index to enable ON CONFLICT (idempotency_key) in _m5_record_payment
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_payments_idempotency_key
  ON public.customer_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2) Wrap the M5 test with a structured exception handler so any failure
--    returns JSON instead of aborting opaquely.
CREATE OR REPLACE FUNCTION public._test_phase15_m5_safe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r jsonb;
BEGIN
  r := public._test_phase15_m5();
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'context', PG_EXCEPTION_CONTEXT
  );
END $$;
