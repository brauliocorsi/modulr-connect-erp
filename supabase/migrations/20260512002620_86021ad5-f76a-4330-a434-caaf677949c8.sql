-- Remove duplicate triggers that both insert cash_movements / recompute payment state
DROP TRIGGER IF EXISTS trg_payment_to_cash ON public.customer_payments;
DROP TRIGGER IF EXISTS trg_payments_after ON public.customer_payments;

-- Cleanup: delete duplicate cash_movements (same payment_id) keeping the earliest
DELETE FROM public.cash_movements cm
USING public.cash_movements cm2
WHERE cm.payment_id IS NOT NULL
  AND cm.payment_id = cm2.payment_id
  AND cm.ctid > cm2.ctid;