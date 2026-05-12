ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid;
CREATE INDEX IF NOT EXISTS idx_cash_movements_reconciled ON public.cash_movements(reconciled_at) WHERE reconciled_at IS NULL;