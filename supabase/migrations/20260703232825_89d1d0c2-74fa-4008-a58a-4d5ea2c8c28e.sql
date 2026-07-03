
-- 1) RLS nas tabelas internas de log (sem policies = deny para anon/authenticated; service_role continua a aceder)
ALTER TABLE public._p20_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._phase17_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._test_phase17_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._test_regression_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public._p20_run_log         IS 'Internal migration/test log. RLS enabled, no policies — service_role only.';
COMMENT ON TABLE public._phase17_runs        IS 'Internal migration/test log. RLS enabled, no policies — service_role only.';
COMMENT ON TABLE public._test_phase17_log    IS 'Internal migration/test log. RLS enabled, no policies — service_role only.';
COMMENT ON TABLE public._test_regression_log IS 'Internal migration/test log. RLS enabled, no policies — service_role only.';

-- 2) Reclassificar getnet
UPDATE public.payment_methods
   SET journal_type='bank',
       feeds_cash_session=false,
       confirmation_mode='manual'
 WHERE code='getnet';
