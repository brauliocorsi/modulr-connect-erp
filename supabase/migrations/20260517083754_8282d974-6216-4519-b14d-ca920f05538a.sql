
-- =====================================================================
-- F16-C.3 Migration 1/5 — Schema base
-- =====================================================================

-- 1. Enum: component_allocation_policy ---------------------------------
DO $$ BEGIN
  CREATE TYPE public.component_allocation_policy AS ENUM (
    'manufacturing_first',
    'sales_first',
    'oldest_need_first',
    'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. products.component_allocation_policy ------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS component_allocation_policy public.component_allocation_policy
    NOT NULL DEFAULT 'manual';

-- Backfill conservador: componentes puros (comprável, não vendível, não fabricável)
-- ou product_kind raw/component → manufacturing_first; resto permanece manual.
UPDATE public.products
   SET component_allocation_policy = 'manufacturing_first'
 WHERE component_allocation_policy = 'manual'
   AND (
        product_kind IN ('raw','component')
     OR (COALESCE(can_be_purchased,false) = true
         AND COALESCE(can_be_sold,false) = false
         AND COALESCE(can_be_manufactured,false) = false)
   );

-- 3. purchase_needs: vínculos + satisfação -----------------------------
ALTER TABLE public.purchase_needs
  ADD COLUMN IF NOT EXISTS mo_component_id       uuid REFERENCES public.mo_components(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bom_line_id           uuid REFERENCES public.bom_lines(id)            ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_order_line_id    uuid REFERENCES public.sale_order_lines(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purpose               text,
  ADD COLUMN IF NOT EXISTS satisfied_at          timestamptz,
  ADD COLUMN IF NOT EXISTS satisfied_by          text,
  ADD COLUMN IF NOT EXISTS satisfied_source_id   uuid,
  ADD COLUMN IF NOT EXISTS satisfied_qty         numeric,
  ADD COLUMN IF NOT EXISTS fulfillment_payload   jsonb;

-- Backfill purpose a partir de origin_kind
UPDATE public.purchase_needs
   SET purpose = CASE
     WHEN purpose IS NOT NULL          THEN purpose
     WHEN origin_kind = 'sale'         THEN 'sales_allocation'
     WHEN origin_kind = 'manufacturing' THEN 'mo_specific'
     ELSE 'stock_replenishment'
   END
 WHERE purpose IS NULL;

-- CHECK constraints (válidos para NULL e para os valores permitidos)
DO $$ BEGIN
  ALTER TABLE public.purchase_needs
    ADD CONSTRAINT purchase_needs_purpose_chk
    CHECK (purpose IS NULL OR purpose IN ('mo_specific','stock_replenishment','sales_allocation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.purchase_needs
    ADD CONSTRAINT purchase_needs_satisfied_by_chk
    CHECK (satisfied_by IS NULL OR satisfied_by IN (
      'stock_allocation',
      'component_stock_allocation',
      'po_receipt',
      'manual',
      'cancelled',
      'other_purchase'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_purchase_needs_open_state
  ON public.purchase_needs (state) WHERE satisfied_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_needs_sale_order_line
  ON public.purchase_needs (sale_order_line_id) WHERE sale_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_needs_mo_component
  ON public.purchase_needs (mo_component_id) WHERE mo_component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_needs_po_line
  ON public.purchase_needs (purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_needs_bom_line
  ON public.purchase_needs (bom_line_id) WHERE bom_line_id IS NOT NULL;

-- 4. stock_moves: vínculos opcionais com PO/need ----------------------
ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_need_id       uuid REFERENCES public.purchase_needs(id)        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_po_line
  ON public.stock_moves (purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_moves_purchase_need
  ON public.stock_moves (purchase_need_id) WHERE purchase_need_id IS NOT NULL;

-- 5. Helpers STABLE ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_manufacturing_component(_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bom_lines bl
      WHERE bl.component_product_id = _product_id
  )
  OR EXISTS (
    SELECT 1 FROM public.mo_components mc
      WHERE mc.product_id = _product_id
  )
  OR EXISTS (
    SELECT 1 FROM public.products p
      WHERE p.id = _product_id
        AND (
          p.product_kind IN ('raw','component')
          OR (COALESCE(p.can_be_purchased,false) = true
              AND COALESCE(p.can_be_sold,false) = false
              AND COALESCE(p.can_be_manufactured,false) = false)
        )
  );
$$;

CREATE OR REPLACE FUNCTION public.purchase_need_remaining_qty(_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_need   public.purchase_needs%ROWTYPE;
  v_remain numeric;
  v_received numeric;
BEGIN
  SELECT * INTO v_need FROM public.purchase_needs WHERE id = _id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Já satisfeita / fechada
  IF v_need.satisfied_at IS NOT NULL
     OR v_need.state IN ('cancelled','received') THEN
    RETURN 0;
  END IF;

  -- Vínculo com linha de venda
  IF v_need.sale_order_line_id IS NOT NULL THEN
    BEGIN
      SELECT public.sale_line_qty_missing(v_need.sale_order_line_id) INTO v_remain;
      RETURN GREATEST(COALESCE(v_remain, 0), 0);
    EXCEPTION WHEN undefined_function THEN
      -- Fallback se a função não existir no ambiente
      SELECT GREATEST(sol.quantity - COALESCE(sol.qty_reserved,0), 0)
        INTO v_remain
        FROM public.sale_order_lines sol
       WHERE sol.id = v_need.sale_order_line_id;
      RETURN COALESCE(v_remain, v_need.qty_needed);
    END;
  END IF;

  -- Vínculo com componente de MO
  IF v_need.mo_component_id IS NOT NULL THEN
    SELECT GREATEST(mc.qty_required - COALESCE(mc.qty_reserved,0), 0)
      INTO v_remain
      FROM public.mo_components mc
     WHERE mc.id = v_need.mo_component_id;
    RETURN COALESCE(v_remain, 0);
  END IF;

  -- Reposição de stock: desconta o que já chegou ligado a esta need
  SELECT COALESCE(SUM(sm.quantity_done), 0)
    INTO v_received
    FROM public.stock_moves sm
   WHERE sm.purchase_need_id = _id
     AND sm.state = 'done';

  RETURN GREATEST(v_need.qty_needed - COALESCE(v_received, 0), 0);
END;
$$;

COMMENT ON FUNCTION public.is_manufacturing_component(uuid) IS
  'F16-C.3: STABLE. Indica se o produto participa de manufatura (BOM/MO/kind).';
COMMENT ON FUNCTION public.purchase_need_remaining_qty(uuid) IS
  'F16-C.3: STABLE. Fonte da verdade da quantidade ainda em aberto de uma purchase_need.';
