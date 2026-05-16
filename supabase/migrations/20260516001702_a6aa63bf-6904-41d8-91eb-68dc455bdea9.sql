
-- ============================================================================
-- FASE 14 — SCHEMA
-- ============================================================================

-- 1. sale_orders: parent/root + flags do split
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS parent_sale_order_id uuid REFERENCES public.sale_orders(id),
  ADD COLUMN IF NOT EXISTS root_sale_order_id   uuid REFERENCES public.sale_orders(id),
  ADD COLUMN IF NOT EXISTS is_deferred          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deferred_reason      text,
  ADD COLUMN IF NOT EXISTS split_at             timestamptz,
  ADD COLUMN IF NOT EXISTS split_by             uuid;

CREATE INDEX IF NOT EXISTS idx_so_parent ON public.sale_orders(parent_sale_order_id) WHERE parent_sale_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_root   ON public.sale_orders(root_sale_order_id)   WHERE root_sale_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_deferred ON public.sale_orders(is_deferred, operational_status) WHERE is_deferred = true;

-- 2. sale_order_lines: parent + qty_split_out + qty_delivered
ALTER TABLE public.sale_order_lines
  ADD COLUMN IF NOT EXISTS parent_line_id uuid REFERENCES public.sale_order_lines(id),
  ADD COLUMN IF NOT EXISTS qty_split_out  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_delivered  numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sol_parent ON public.sale_order_lines(parent_line_id) WHERE parent_line_id IS NOT NULL;

-- 3. supply links
DO $$ BEGIN
  CREATE TYPE public.supply_link_kind AS ENUM ('purchase_need','purchase_order_line','manufacturing_order','stock_reservation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supply_link_state AS ENUM ('active','consumed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sale_order_line_supply_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_line_id uuid NOT NULL REFERENCES public.sale_order_lines(id) ON DELETE CASCADE,
  origin_line_id     uuid NOT NULL REFERENCES public.sale_order_lines(id),
  link_kind          public.supply_link_kind NOT NULL,
  purchase_need_id        uuid REFERENCES public.purchase_needs(id),
  purchase_order_line_id  uuid,
  manufacturing_order_id  uuid REFERENCES public.manufacturing_orders(id),
  reservation_ref         text,
  qty                numeric NOT NULL,
  state              public.supply_link_state NOT NULL DEFAULT 'active',
  inherited_from_line_id uuid REFERENCES public.sale_order_lines(id),
  moved_at           timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soss_line   ON public.sale_order_line_supply_links(sale_order_line_id, state);
CREATE INDEX IF NOT EXISTS idx_soss_origin ON public.sale_order_line_supply_links(origin_line_id);
CREATE INDEX IF NOT EXISTS idx_soss_need   ON public.sale_order_line_supply_links(purchase_need_id) WHERE purchase_need_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_soss_pol    ON public.sale_order_line_supply_links(purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_soss_mo     ON public.sale_order_line_supply_links(manufacturing_order_id) WHERE manufacturing_order_id IS NOT NULL;

-- Não-duplicação: cada supply só pode estar ativo numa única linha
CREATE UNIQUE INDEX IF NOT EXISTS uq_soss_need_active ON public.sale_order_line_supply_links(purchase_need_id) WHERE state = 'active' AND purchase_need_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_soss_pol_active  ON public.sale_order_line_supply_links(purchase_order_line_id) WHERE state = 'active' AND purchase_order_line_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_soss_mo_active   ON public.sale_order_line_supply_links(manufacturing_order_id) WHERE state = 'active' AND manufacturing_order_id IS NOT NULL;

ALTER TABLE public.sale_order_line_supply_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "soss_read_auth" ON public.sale_order_line_supply_links
  FOR SELECT TO authenticated USING (true);

-- escrita só por funções SECURITY DEFINER (sem policy de INSERT/UPDATE/DELETE p/ utilizadores)

-- 4. alocações financeiras do split
CREATE TABLE IF NOT EXISTS public.sale_split_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id   uuid NOT NULL REFERENCES public.sale_orders(id),
  deferred_order_id uuid NOT NULL REFERENCES public.sale_orders(id),
  amount_total_original   numeric NOT NULL,
  amount_total_parent_after numeric NOT NULL,
  amount_total_deferred   numeric NOT NULL,
  paid_so_far             numeric NOT NULL DEFAULT 0,
  sinal_applied_to_deferred numeric NOT NULL DEFAULT 0,
  delta_rounding          numeric NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  CONSTRAINT chk_split_sum CHECK (
    abs((amount_total_parent_after + amount_total_deferred) - amount_total_original) < 0.01
  )
);

CREATE INDEX IF NOT EXISTS idx_sspa_parent   ON public.sale_split_payment_allocations(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_sspa_deferred ON public.sale_split_payment_allocations(deferred_order_id);

ALTER TABLE public.sale_split_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sspa_read_auth" ON public.sale_split_payment_allocations
  FOR SELECT TO authenticated USING (true);

-- 5. so_root_id: resolve a SO raiz, com guarda anti-loop
CREATE OR REPLACE FUNCTION public.so_root_id(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur uuid := _order_id;
  parent uuid;
  i int := 0;
BEGIN
  LOOP
    SELECT parent_sale_order_id INTO parent FROM public.sale_orders WHERE id = cur;
    IF parent IS NULL THEN
      RETURN cur;
    END IF;
    cur := parent;
    i := i + 1;
    IF i > 50 THEN
      RAISE EXCEPTION 'so_root_id: loop/limit excedido (>50) para %', _order_id;
    END IF;
  END LOOP;
END $$;

-- 6. Backfill root_sale_order_id para SOs existentes
UPDATE public.sale_orders SET root_sale_order_id = id WHERE root_sale_order_id IS NULL AND parent_sale_order_id IS NULL;

-- 7. Guards anti-duplicação de supply
CREATE OR REPLACE FUNCTION public.guard_purchase_need_no_dup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_order_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.sale_order_line_supply_links sl
      JOIN public.sale_order_lines l ON l.id = sl.sale_order_line_id
      WHERE l.order_id = NEW.sale_order_id
        AND l.product_id = NEW.product_id
        AND sl.state = 'active'
        AND sl.link_kind IN ('purchase_need','purchase_order_line')
    ) THEN
      RAISE EXCEPTION 'guard_purchase_need_no_dup: já existe supply_link ativo para SO=% produto=%', NEW.sale_order_id, NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_guard_purchase_need_no_dup ON public.purchase_needs;
CREATE TRIGGER tg_guard_purchase_need_no_dup
  BEFORE INSERT ON public.purchase_needs
  FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_need_no_dup();

CREATE OR REPLACE FUNCTION public.guard_mo_no_dup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_order_id IS NOT NULL AND NEW.sale_order_line_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.sale_order_line_supply_links sl
      WHERE sl.sale_order_line_id = NEW.sale_order_line_id
        AND sl.state = 'active'
        AND sl.link_kind = 'manufacturing_order'
    ) THEN
      RAISE EXCEPTION 'guard_mo_no_dup: já existe supply_link MO ativo para linha=%', NEW.sale_order_line_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_guard_mo_no_dup ON public.manufacturing_orders;
CREATE TRIGGER tg_guard_mo_no_dup
  BEFORE INSERT ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_mo_no_dup();
