
-- =====================================================================
-- F16-C.3 Migration 2/5 — Motor de componentes + trigger satisfação venda
-- (mo.origin é enum mo_origin → tratar com IS NULL / valor enum direto)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mfg_allocate_components_from_stock(
  _product_id  uuid,
  _variant_id  uuid,
  _location_id uuid,
  _qty         numeric,
  _reason      text DEFAULT 'po_receipt_surplus'
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining     numeric := COALESCE(_qty, 0);
  v_allocs        jsonb   := '[]'::jsonb;
  v_mos_updated   int     := 0;
  v_needs_sat     int     := 0;
  v_quant         RECORD;
  v_avail_free    numeric := 0;
  v_lock_key      bigint;
  r               RECORD;
  v_take          numeric;
  v_quant_free    numeric;
  v_rc            int;
BEGIN
  IF v_remaining <= 0 OR _product_id IS NULL THEN
    RETURN jsonb_build_object(
      'allocations', v_allocs,
      'qty_remaining', v_remaining,
      'mos_updated', 0,
      'needs_satisfied', 0
    );
  END IF;

  v_lock_key := hashtextextended(_product_id::text || COALESCE(_variant_id::text,''), 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(SUM(GREATEST(quantity - COALESCE(reserved_quantity,0), 0)), 0)
    INTO v_avail_free
    FROM public.stock_quants sq
   WHERE sq.product_id = _product_id
     AND (_variant_id  IS NULL OR sq.variant_id  IS NOT DISTINCT FROM _variant_id)
     AND (_location_id IS NULL OR sq.location_id = _location_id);

  IF v_avail_free <= 0 THEN
    RETURN jsonb_build_object(
      'allocations', v_allocs,
      'qty_remaining', v_remaining,
      'mos_updated', 0,
      'needs_satisfied', 0
    );
  END IF;

  FOR r IN
    SELECT mc.id            AS mc_id,
           mc.mo_id         AS mo_id,
           mc.qty_required  AS req,
           COALESCE(mc.qty_reserved, 0) AS res,
           mo.sale_order_id AS so_id,
           mo.due_date      AS due_date,
           mo.created_at    AS mo_created,
           mo.origin        AS mo_origin
      FROM public.mo_components mc
      JOIN public.manufacturing_orders mo ON mo.id = mc.mo_id
     WHERE mc.product_id = _product_id
       AND (_variant_id IS NULL OR mc.variant_id IS NOT DISTINCT FROM _variant_id)
       AND mo.state IN ('waiting_material','ready','in_progress','paused')
       AND mc.qty_required > COALESCE(mc.qty_reserved, 0)
     ORDER BY mo.due_date ASC NULLS LAST,
              (mo.sale_order_id IS NOT NULL) DESC,
              mo.created_at ASC,
              (mo.origin IS NOT NULL AND mo.origin IN ('manual','replenishment')) ASC
     FOR UPDATE OF mc SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(r.req - r.res, v_remaining);
    IF v_take <= 0 THEN CONTINUE; END IF;

    DECLARE
      v_left numeric := v_take;
    BEGIN
      FOR v_quant IN
        SELECT *
          FROM public.stock_quants sq
         WHERE sq.product_id = _product_id
           AND (_variant_id  IS NULL OR sq.variant_id  IS NOT DISTINCT FROM _variant_id)
           AND (_location_id IS NULL OR sq.location_id = _location_id)
           AND (sq.quantity - COALESCE(sq.reserved_quantity,0)) > 0
         ORDER BY sq.updated_at ASC
         FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_quant_free := GREATEST(v_quant.quantity - COALESCE(v_quant.reserved_quantity,0), 0);
        IF v_quant_free <= 0 THEN CONTINUE; END IF;
        DECLARE
          v_use numeric := LEAST(v_quant_free, v_left);
        BEGIN
          UPDATE public.stock_quants
             SET reserved_quantity = COALESCE(reserved_quantity,0) + v_use,
                 updated_at = now()
           WHERE id = v_quant.id
             AND quantity >= COALESCE(reserved_quantity,0) + v_use;
          IF NOT FOUND THEN CONTINUE; END IF;
          v_left := v_left - v_use;

          INSERT INTO public.stock_reservation_log(
            product_id, variant_id, location_id, lot_id, qty,
            qty_before, qty_after,
            origin_type, origin_id, action, notes, payload
          ) VALUES (
            _product_id, _variant_id, v_quant.location_id, v_quant.lot_id, v_use,
            COALESCE(v_quant.reserved_quantity,0), COALESCE(v_quant.reserved_quantity,0) + v_use,
            'mo_component', r.mc_id, 'reserve',
            'mfg_allocate_components_from_stock: ' || COALESCE(_reason,''),
            jsonb_build_object('mo_id', r.mo_id, 'reason', _reason)
          );
        END;
      END LOOP;

      IF v_take - v_left > 0 THEN
        UPDATE public.mo_components
           SET qty_reserved = COALESCE(qty_reserved,0) + (v_take - v_left)
         WHERE id = r.mc_id;

        v_allocs := v_allocs || jsonb_build_object(
          'mo_id', r.mo_id,
          'mo_component_id', r.mc_id,
          'qty', v_take - v_left
        );
        v_mos_updated := v_mos_updated + 1;
        v_remaining   := v_remaining - (v_take - v_left);

        UPDATE public.purchase_needs pn
           SET satisfied_at        = now(),
               satisfied_by        = 'component_stock_allocation',
               satisfied_source_id = r.mc_id,
               satisfied_qty       = (SELECT qty_reserved FROM public.mo_components WHERE id = r.mc_id),
               fulfillment_payload = COALESCE(pn.fulfillment_payload, '{}'::jsonb)
                                     || jsonb_build_object('source','component_stock_allocation',
                                                           'mo_component_id', r.mc_id,
                                                           'reason', _reason)
         WHERE pn.mo_component_id = r.mc_id
           AND pn.satisfied_at IS NULL
           AND pn.state NOT IN ('cancelled','received')
           AND (SELECT qty_reserved FROM public.mo_components WHERE id = r.mc_id)
               >= (SELECT qty_required FROM public.mo_components WHERE id = r.mc_id);
        GET DIAGNOSTICS v_rc = ROW_COUNT;
        v_needs_sat := v_needs_sat + v_rc;
      END IF;
    END;
  END LOOP;

  BEGIN
    PERFORM public.mfg_refresh_mo_state(mc.mo_id)
      FROM public.mo_components mc
     WHERE mc.product_id = _product_id
       AND (_variant_id IS NULL OR mc.variant_id IS NOT DISTINCT FROM _variant_id);
  EXCEPTION WHEN undefined_function THEN NULL; END;

  RETURN jsonb_build_object(
    'allocations',     v_allocs,
    'qty_remaining',   v_remaining,
    'mos_updated',     v_mos_updated,
    'needs_satisfied', v_needs_sat
  );
END;
$$;

COMMENT ON FUNCTION public.mfg_allocate_components_from_stock(uuid,uuid,uuid,numeric,text) IS
  'F16-C.3: aloca stock livre de componentes para MOs abertas em ordem de prioridade. Idempotente. Nunca cancela PO.';

-- ---------------------------------------------------------------------
-- Suggest (read-only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mfg_suggest_component_allocation(
  _product_id  uuid,
  _variant_id  uuid,
  _qty         numeric
) RETURNS TABLE(
  mo_id           uuid,
  mo_component_id uuid,
  suggested_qty   numeric,
  priority_rank   int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT mc.mo_id,
           mc.id AS mo_component_id,
           GREATEST(mc.qty_required - COALESCE(mc.qty_reserved,0), 0) AS need,
           ROW_NUMBER() OVER (
             ORDER BY mo.due_date ASC NULLS LAST,
                      (mo.sale_order_id IS NOT NULL) DESC,
                      mo.created_at ASC,
                      (mo.origin IS NOT NULL AND mo.origin IN ('manual','replenishment')) ASC
           ) AS priority_rank
      FROM public.mo_components mc
      JOIN public.manufacturing_orders mo ON mo.id = mc.mo_id
     WHERE mc.product_id = _product_id
       AND (_variant_id IS NULL OR mc.variant_id IS NOT DISTINCT FROM _variant_id)
       AND mo.state IN ('waiting_material','ready','in_progress','paused')
       AND mc.qty_required > COALESCE(mc.qty_reserved,0)
  ),
  rolled AS (
    SELECT *,
           LEAST(need, GREATEST(COALESCE(_qty,0) - COALESCE(SUM(need) OVER (
             ORDER BY priority_rank
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ),0), 0)) AS suggested_qty
      FROM ranked
  )
  SELECT mo_id, mo_component_id, suggested_qty, priority_rank::int
    FROM rolled
   WHERE suggested_qty > 0;
$$;

COMMENT ON FUNCTION public.mfg_suggest_component_allocation(uuid,uuid,numeric) IS
  'F16-C.3: STABLE. Sugere alocação por prioridade sem efeito colateral.';

-- ---------------------------------------------------------------------
-- Trigger restrito de satisfação por reserva de venda
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_mark_needs_satisfied_after_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so_state public.sale_state;
  v_missing  numeric;
BEGIN
  IF NEW.qty_reserved IS NULL
     OR OLD.qty_reserved IS NULL
     OR NEW.qty_reserved <= OLD.qty_reserved THEN
    RETURN NEW;
  END IF;

  SELECT state INTO v_so_state FROM public.sale_orders WHERE id = NEW.order_id;
  IF v_so_state IS DISTINCT FROM 'confirmed'::public.sale_state THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT public.sale_line_qty_missing(NEW.id) INTO v_missing;
  EXCEPTION WHEN undefined_function THEN
    v_missing := GREATEST(NEW.quantity - COALESCE(NEW.qty_reserved,0), 0);
  END;

  IF COALESCE(v_missing, 0) > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.purchase_needs pn
     SET satisfied_at        = now(),
         satisfied_by        = 'stock_allocation',
         satisfied_source_id = NEW.id,
         satisfied_qty       = NEW.qty_reserved,
         fulfillment_payload = COALESCE(pn.fulfillment_payload, '{}'::jsonb)
                               || jsonb_build_object('source','sale_line_reserved',
                                                     'sale_order_line_id', NEW.id)
   WHERE pn.sale_order_line_id = NEW.id
     AND pn.product_id         = NEW.product_id
     AND pn.satisfied_at       IS NULL
     AND pn.state NOT IN ('cancelled','received');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_mark_needs_satisfied ON public.sale_order_lines;
CREATE TRIGGER trg_sales_mark_needs_satisfied
AFTER UPDATE OF qty_reserved ON public.sale_order_lines
FOR EACH ROW
EXECUTE FUNCTION public.sales_mark_needs_satisfied_after_allocation();

COMMENT ON FUNCTION public.sales_mark_needs_satisfied_after_allocation() IS
  'F16-C.3: marca purchase_needs como satisfied_by=stock_allocation apenas se SO=confirmed e linha completa.';
