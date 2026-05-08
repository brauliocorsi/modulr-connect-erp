-- Marcar armazéns como Loja e vincular utilizador ao caixa
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS is_store boolean NOT NULL DEFAULT false;
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS idx_cash_registers_user ON public.cash_registers(user_id);