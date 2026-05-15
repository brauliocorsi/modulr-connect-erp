
-- ============ PR1 + PR3 : Products typology + Purchase needs ============

-- 1) Extra columns on products (idempotent)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_kind text,
  ADD COLUMN IF NOT EXISTS requires_bom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfg_lead_time_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_lead_time_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock numeric NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD CONSTRAINT products_product_kind_chk
  CHECK (product_kind IS NULL OR product_kind IN
    ('finished','raw','component','service','manufactured','purchased','mixed'));

-- Backfill product_kind from existing flags / type
UPDATE public.products SET product_kind = CASE
    WHEN type = 'service' THEN 'service'
    WHEN can_be_manufactured AND can_be_purchased THEN 'mixed'
    WHEN can_be_manufactured THEN 'manufactured'
    WHEN can_be_purchased AND can_be_sold THEN 'purchased'
    WHEN can_be_purchased AND NOT can_be_sold THEN 'raw'
    WHEN can_be_sold THEN 'finished'
    ELSE 'component'
  END
WHERE product_kind IS NULL;

-- Backfill min/max_stock from existing reordering_rules (best-effort)
UPDATE public.products p
   SET min_stock = sub.mn, max_stock = sub.mx
  FROM (
    SELECT product_id, MAX(min_qty) AS mn, MAX(max_qty) AS mx
      FROM public.reordering_rules
     WHERE active GROUP BY product_id
  ) sub
 WHERE sub.product_id = p.id
   AND p.min_stock = 0 AND p.max_stock = 0;

-- 2) purchase_needs table
DO $$ BEGIN
  CREATE TYPE public.purchase_need_origin AS ENUM ('sale','manufacturing','min_stock','manual','forecast');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.purchase_need_state AS ENUM
    ('pending','quoting','approved','po_created','partially_received','received','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.purchase_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_needed numeric NOT NULL CHECK (qty_needed > 0),
  origin_kind public.purchase_need_origin NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  manufacturing_order_id uuid REFERENCES public.manufacturing_orders(id) ON DELETE SET NULL,
  suggested_partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 3,
  needed_by date,
  state public.purchase_need_state NOT NULL DEFAULT 'pending',
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pn_product ON public.purchase_needs(product_id);
CREATE INDEX IF NOT EXISTS idx_pn_state ON public.purchase_needs(state);
CREATE INDEX IF NOT EXISTS idx_pn_origin ON public.purchase_needs(origin_kind);
CREATE INDEX IF NOT EXISTS idx_pn_so ON public.purchase_needs(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_pn_mo ON public.purchase_needs(manufacturing_order_id);
CREATE INDEX IF NOT EXISTS idx_pn_po ON public.purchase_needs(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pn_needed_by ON public.purchase_needs(needed_by);

DROP TRIGGER IF EXISTS trg_purchase_needs_updated ON public.purchase_needs;
CREATE TRIGGER trg_purchase_needs_updated
  BEFORE UPDATE ON public.purchase_needs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.purchase_needs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pn_select ON public.purchase_needs;
CREATE POLICY pn_select ON public.purchase_needs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pn_insert ON public.purchase_needs;
CREATE POLICY pn_insert ON public.purchase_needs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS pn_update ON public.purchase_needs;
CREATE POLICY pn_update ON public.purchase_needs FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS pn_delete ON public.purchase_needs;
CREATE POLICY pn_delete ON public.purchase_needs FOR DELETE TO authenticated USING (true);

-- 3) helper: create a need (idempotent per origin+sale/mo+product+pending)
CREATE OR REPLACE FUNCTION public.create_purchase_need(
  _product uuid, _qty numeric, _origin public.purchase_need_origin,
  _sale uuid DEFAULT NULL, _mo uuid DEFAULT NULL,
  _needed_by date DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _supplier uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  -- skip if an open need already exists for the same origin/key
  SELECT id INTO _id FROM purchase_needs
   WHERE product_id = _product AND origin_kind = _origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(_sale::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(_mo::text,'')
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  SELECT partner_id INTO _supplier FROM product_suppliers
    WHERE product_id = _product ORDER BY priority NULLS LAST LIMIT 1;

  INSERT INTO purchase_needs(product_id, qty_needed, origin_kind, sale_order_id,
       manufacturing_order_id, suggested_partner_id, needed_by, notes)
  VALUES (_product, _qty, _origin, _sale, _mo, _supplier, _needed_by, _notes)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- 4) trigger: when sale_order confirmed -> generate needs for purchasable items lacking stock
CREATE OR REPLACE FUNCTION public.tg_so_confirm_create_purchase_needs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_avail numeric; v_short numeric; v_need uuid; v_count int := 0;
BEGIN
  IF NEW.state = 'confirmed' AND COALESCE(OLD.state::text,'') <> 'confirmed' THEN
    FOR r IN
      SELECT sol.product_id, sol.quantity, p.can_be_purchased, p.can_be_manufactured, p.name
        FROM sale_order_lines sol
        JOIN products p ON p.id = sol.product_id
       WHERE sol.order_id = NEW.id AND p.type = 'storable' AND p.can_be_purchased
    LOOP
      SELECT COALESCE(SUM(available),0) INTO v_avail
        FROM product_stock_forecast WHERE product_id = r.product_id;
      v_short := r.quantity - COALESCE(v_avail,0);
      IF v_short > 0 AND NOT r.can_be_manufactured THEN
        v_need := create_purchase_need(r.product_id, v_short, 'sale'::purchase_need_origin,
          NEW.id, NULL, COALESCE(NEW.commitment_date, NEW.validity_date), 'Auto: stock insuficiente para venda ' || NEW.name);
        IF v_need IS NOT NULL THEN v_count := v_count + 1; END IF;
      END IF;
    END LOOP;
    IF v_count > 0 AND NEW.salesperson_id IS NOT NULL THEN
      PERFORM notify_user(NEW.salesperson_id,
        'Necessidades de compra geradas',
        format('Venda %s gerou %s necessidade(s) de compra.', NEW.name, v_count),
        'sales'::app_module, '/sales/orders/' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_so_confirm_purchase_needs ON public.sale_orders;
CREATE TRIGGER trg_so_confirm_purchase_needs
  AFTER UPDATE OF state ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_so_confirm_create_purchase_needs();

-- 5) trigger: when MO has missing components -> create needs
CREATE OR REPLACE FUNCTION public.mfg_create_needs_for_mo(_mo uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_short numeric; v_count int := 0;
BEGIN
  FOR r IN
    SELECT mc.product_id, mc.qty_required, mc.qty_reserved
      FROM mo_components mc
      JOIN products p ON p.id = mc.product_id
     WHERE mc.mo_id = _mo AND p.can_be_purchased
  LOOP
    v_short := r.qty_required - COALESCE(r.qty_reserved,0);
    IF v_short > 0 THEN
      PERFORM create_purchase_need(r.product_id, v_short, 'manufacturing'::purchase_need_origin,
        NULL, _mo, (SELECT due_date FROM manufacturing_orders WHERE id = _mo),
        'Auto: componente em falta');
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- 6) trigger: PO state changes propagate to needs + notify
CREATE OR REPLACE FUNCTION public.tg_po_state_to_needs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'confirmed' THEN
      UPDATE purchase_needs SET state = 'po_created' WHERE purchase_order_id = NEW.id AND state IN ('pending','quoting','approved');
    ELSIF NEW.state = 'done' THEN
      UPDATE purchase_needs SET state = 'received' WHERE purchase_order_id = NEW.id AND state <> 'cancelled';
      -- notify origins
      FOR r IN SELECT DISTINCT pn.sale_order_id, so.salesperson_id, so.name
                 FROM purchase_needs pn
                 LEFT JOIN sale_orders so ON so.id = pn.sale_order_id
                WHERE pn.purchase_order_id = NEW.id AND pn.sale_order_id IS NOT NULL
      LOOP
        IF r.salesperson_id IS NOT NULL THEN
          PERFORM notify_user(r.salesperson_id, 'Compra recebida',
            format('PO %s recebida — venda %s pode avançar.', NEW.name, COALESCE(r.name,'')),
            'sales'::app_module, '/sales/orders/' || r.sale_order_id::text);
        END IF;
      END LOOP;
    ELSIF NEW.state = 'cancelled' THEN
      UPDATE purchase_needs SET state = 'cancelled' WHERE purchase_order_id = NEW.id AND state NOT IN ('received','cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_po_state_to_needs ON public.purchase_orders;
CREATE TRIGGER trg_po_state_to_needs
  AFTER UPDATE OF state ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_po_state_to_needs();

-- 7) View enriched with in_production qty
CREATE OR REPLACE VIEW public.v_product_stock_full AS
SELECT
  p.id AS product_id,
  p.name,
  COALESCE(SUM(psf.on_hand),0)   AS on_hand,
  COALESCE(SUM(psf.reserved),0)  AS reserved,
  COALESCE(SUM(psf.available),0) AS available,
  COALESCE(SUM(psf.incoming),0)  AS incoming,
  COALESCE(SUM(psf.outgoing),0)  AS outgoing,
  COALESCE(SUM(psf.forecasted),0) AS forecasted,
  COALESCE((SELECT SUM(mo.qty) FROM manufacturing_orders mo
             WHERE mo.product_id = p.id
               AND mo.state IN ('draft','waiting_material','ready','in_progress','paused','qc')),0) AS in_production,
  p.min_stock, p.max_stock
FROM products p
LEFT JOIN product_stock_forecast psf ON psf.product_id = p.id
GROUP BY p.id;
