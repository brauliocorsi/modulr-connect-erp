-- Comissões dos métodos BNPL
ALTER TABLE public.payment_methods 
  ADD COLUMN IF NOT EXISTS provider_fee_pct numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS provider_fee_fixed numeric DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.payment_methods.provider_fee_pct IS 
  'Percentagem de comissão da plataforma (ex: 3.5 para Scalapay)';
COMMENT ON COLUMN public.payment_methods.provider_fee_fixed IS 
  'Taxa fixa por transação da plataforma em euros';

-- View de liquidações BNPL pendentes
CREATE OR REPLACE VIEW public.bnpl_pending_settlements AS
SELECT 
  cp.id,
  cp.name,
  p.name AS cliente,
  so.name AS venda,
  cp.payment_date,
  (cp.payment_date + pm.settlement_delay_days * INTERVAL '1 day')::date AS expected_settlement_date,
  cp.amount AS amount_gross,
  ROUND(cp.amount * (1 - COALESCE(pm.provider_fee_pct,0)/100) - COALESCE(pm.provider_fee_fixed,0), 2) AS amount_net,
  ROUND(cp.amount * COALESCE(pm.provider_fee_pct,0)/100 + COALESCE(pm.provider_fee_fixed,0), 2) AS fee_amount,
  pm.name AS metodo,
  pm.code AS metodo_code,
  cp.reconciled_at,
  cp.state
FROM public.customer_payments cp
JOIN public.payment_methods pm ON cp.method_id = pm.id
LEFT JOIN public.sale_orders so ON cp.order_id = so.id
LEFT JOIN public.partners p ON cp.partner_id = p.id
WHERE pm.journal_type = 'bnpl'
  AND cp.state IN ('posted', 'pending')
ORDER BY expected_settlement_date;

GRANT SELECT ON public.bnpl_pending_settlements TO authenticated;
GRANT ALL ON public.bnpl_pending_settlements TO service_role;

-- Seed comissões iniciais
UPDATE public.payment_methods SET provider_fee_pct = 3.5 WHERE code = 'SCALAPAY';
UPDATE public.payment_methods SET provider_fee_pct = 2.5 WHERE code = 'SEQURA';