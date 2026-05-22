
-- F28-FIN Entrega C: defaults de CC e conta para sugestões inteligentes
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS default_cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL;

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS default_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS default_expense_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stores_default_cc ON public.stores(default_cost_center_id) WHERE default_cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pmethods_default_acc ON public.payment_methods(default_account_id) WHERE default_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partners_default_expense_acc ON public.partners(default_expense_account_id) WHERE default_expense_account_id IS NOT NULL;
