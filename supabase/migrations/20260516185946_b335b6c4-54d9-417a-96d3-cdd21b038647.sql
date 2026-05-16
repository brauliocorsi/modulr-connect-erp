
-- ============================================================
-- F16-B0.1 — Allocation Engine: SCHEMA ONLY
-- Zero lógica operacional, zero hooks, zero alteração de RPCs existentes.
-- ============================================================

-- 1. Enum allocation_policy
CREATE TYPE public.allocation_policy AS ENUM (
  'strict_order',
  'stock_pool_first',
  'oldest_order_first',
  'delivery_date_first',
  'paid_priority',
  'manual_allocation',
  'custom_priority'
);

-- 2. products: allocation_policy + pesos
ALTER TABLE public.products
  ADD COLUMN allocation_policy public.allocation_policy NOT NULL DEFAULT 'oldest_order_first',
  ADD COLUMN allocation_priority_weights jsonb NULL;

-- Backfill conservador: tudo já fica em 'oldest_order_first' via default.
-- (Colunas como is_custom/made_to_order/track_inventory não existem nesta base;
--  uma heurística mais fina virá em sub-fase futura se necessário.)

-- 3. Tabela allocation_decisions (idempotente via unique parcial)
CREATE TABLE public.allocation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  source_sale_order_line_id uuid NULL,
  suggested_target_line_id uuid NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','resolved','cancelled')),
  reason text NULL,
  resolved_by uuid NULL,
  resolved_at timestamptz NULL,
  payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique parcial para idempotência das decisões pendentes
CREATE UNIQUE INDEX allocation_decisions_pending_uidx
  ON public.allocation_decisions (
    source_sale_order_line_id,
    product_id,
    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(reason, '')
  )
  WHERE state = 'pending';

CREATE INDEX allocation_decisions_state_created_idx
  ON public.allocation_decisions (state, created_at DESC);

CREATE INDEX allocation_decisions_product_idx
  ON public.allocation_decisions (product_id, variant_id);

-- updated_at trigger (reusa função existente se houver, senão cria local)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_updated_at' AND pronamespace='public'::regnamespace) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$;
  END IF;
END$$;

CREATE TRIGGER allocation_decisions_set_updated_at
  BEFORE UPDATE ON public.allocation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. RLS — leitura para autenticados; escrita só via RPC SECURITY DEFINER (sub-fases B0.3+)
ALTER TABLE public.allocation_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allocation_decisions_select_authenticated"
  ON public.allocation_decisions
  FOR SELECT TO authenticated
  USING (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE: só service_role/SECURITY DEFINER escreve.

-- 5. Índice de apoio à alocação (sem WHERE em campo inexistente)
CREATE INDEX IF NOT EXISTS sale_order_lines_product_opstatus_idx
  ON public.sale_order_lines (product_id, operational_status);

CREATE INDEX IF NOT EXISTS stock_packages_product_status_free_idx
  ON public.stock_packages (product_id, status)
  WHERE sale_order_line_id IS NULL;

-- 6. Extensão segura de stock_reservation_log (adição de colunas nullable)
ALTER TABLE public.stock_reservation_log
  ADD COLUMN IF NOT EXISTS from_sale_order_line_id uuid NULL,
  ADD COLUMN IF NOT EXISTS to_sale_order_line_id uuid NULL,
  ADD COLUMN IF NOT EXISTS package_ids uuid[] NULL,
  ADD COLUMN IF NOT EXISTS payload jsonb NULL;

-- action permanece text livre — sub-fases podem gravar
-- 'allocate_auto' | 'allocate_suggested' | 'transfer' | 'release' | 'decision_required'
-- sem necessidade de migrar enum.

COMMENT ON COLUMN public.products.allocation_policy IS
  'F16-B0.1 — política de alocação de inventário por produto. Sub-fases futuras (B0.3+) consomem este valor.';
COMMENT ON TABLE public.allocation_decisions IS
  'F16-B0.1 — decisões pendentes de alocação manual/strict. Escrita só via RPC SECURITY DEFINER em B0.3+.';
