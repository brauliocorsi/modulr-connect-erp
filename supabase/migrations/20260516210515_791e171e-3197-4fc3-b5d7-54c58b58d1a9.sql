
-- =========================================================
-- F16-B0.6 — Hooks do Allocation Engine
-- =========================================================

-- ----- helper: location é interna segura? -----
CREATE OR REPLACE FUNCTION public._alloc_hook_is_safe_location(_location_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_locations
    WHERE id = _location_id
      AND type = 'internal'
      AND active = true
      -- excluir locations vinculadas a docks, lanes, vehicles, carriers
      AND NOT EXISTS (SELECT 1 FROM public.loading_docks d WHERE d.stock_location_id = _location_id)
      AND NOT EXISTS (SELECT 1 FROM public.loading_dock_lanes dl WHERE dl.stock_location_id = _location_id)
      AND NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.stock_location_id = _location_id)
      AND NOT EXISTS (SELECT 1 FROM public.delivery_carriers c WHERE c.stock_location_id = _location_id)
  );
$$;

-- ----- helper: package é elegível para alocação? -----
CREATE OR REPLACE FUNCTION public._alloc_hook_is_package_eligible(_package_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.stock_packages p
    WHERE p.id = _package_id
      AND p.condition IN ('good','repaired')
      AND p.status    IN ('available','returned','received','produced')
      AND p.sale_order_line_id IS NULL
      AND p.current_location_id IS NOT NULL
      AND public._alloc_hook_is_safe_location(p.current_location_id)
  );
$$;

-- ----- helper: registra evento idempotente; retorna true se novo -----
CREATE OR REPLACE FUNCTION public._alloc_hook_register_event(
  _event_type text, _source_id uuid, _source_event_id text,
  _product_id uuid, _variant_id uuid, _location_id uuid, _qty numeric
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.allocation_hook_events(
    event_type, source_id, source_event_id, product_id, variant_id, location_id, qty, status
  ) VALUES (
    _event_type, _source_id, _source_event_id, _product_id, _variant_id, _location_id, _qty, 'ok'
  );
  RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
  RETURN FALSE;
END;
$$;

-- =========================================================
-- WRAPPER 1: PO Receipt
-- =========================================================
CREATE OR REPLACE FUNCTION public.allocation_on_po_receipt(_picking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pick     record;
  v_move     record;
  v_results  jsonb := '[]'::jsonb;
  v_res      jsonb;
  v_evt_key  text;
  v_is_new   boolean;
  v_pn       record;
BEGIN
  SELECT * INTO v_pick FROM public.stock_pickings WHERE id = _picking_id;
  IF NOT FOUND OR v_pick.kind <> 'incoming' OR v_pick.state <> 'done' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_incoming_done');
  END IF;

  FOR v_move IN
    SELECT m.*
    FROM public.stock_moves m
    WHERE m.picking_id = _picking_id
      AND COALESCE(m.quantity_done, m.quantity, 0) > 0
  LOOP
    -- skip se destino não é internal safe
    IF NOT public._alloc_hook_is_safe_location(v_move.destination_location_id) THEN
      CONTINUE;
    END IF;

    -- skip se este move corresponde a componente de MO (purchase_need com manufacturing_order_id)
    SELECT pn.* INTO v_pn
    FROM public.purchase_needs pn
    JOIN public.purchase_order_lines pol ON pol.id IS NOT NULL
    JOIN public.purchase_orders po       ON po.id = pol.order_id
    WHERE pn.purchase_order_id = po.id
      AND pn.product_id = v_move.product_id
      AND pn.manufacturing_order_id IS NOT NULL
      AND pn.sale_order_id IS NULL
      AND po.name = v_pick.origin
    LIMIT 1;
    IF FOUND THEN
      -- componente de MO: não desviar para vendas
      CONTINUE;
    END IF;

    v_evt_key := 'po_receipt:'||_picking_id::text||':move:'||v_move.id::text;
    v_is_new := public._alloc_hook_register_event(
      'po_receipt', _picking_id, v_evt_key,
      v_move.product_id, v_move.variant_id, v_move.destination_location_id,
      COALESCE(v_move.quantity_done, v_move.quantity)
    );
    IF NOT v_is_new THEN
      CONTINUE;
    END IF;

    BEGIN
      v_res := public.run_inventory_allocation(
        v_move.product_id, v_move.variant_id,
        v_move.destination_location_id,
        COALESCE(v_move.quantity_done, v_move.quantity),
        'po_receipt'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'move_id', v_move.id, 'product_id', v_move.product_id, 'result', v_res
      ));
      UPDATE public.allocation_hook_events
         SET result = v_res
       WHERE event_type='po_receipt' AND source_event_id = v_evt_key;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.allocation_hook_events
         SET status='error', error=SQLERRM
       WHERE event_type='po_receipt' AND source_event_id = v_evt_key;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'picking_id', _picking_id, 'results', v_results);
END;
$$;

-- =========================================================
-- WRAPPER 2: Return GOOD with release_reserved
-- =========================================================
CREATE OR REPLACE FUNCTION public.allocation_on_return_good(
  _package_id uuid, _mode text DEFAULT 'release_reserved'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pkg   record;
  v_res   jsonb;
  v_key   text;
BEGIN
  IF _mode <> 'release_reserved' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'mode_not_release');
  END IF;

  SELECT * INTO v_pkg FROM public.stock_packages WHERE id = _package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error','package_not_found'); END IF;

  IF NOT public._alloc_hook_is_package_eligible(_package_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','package_not_eligible');
  END IF;

  v_key := 'return_good:'||_package_id::text;
  IF NOT public._alloc_hook_register_event(
    'return_good', _package_id, v_key,
    v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','duplicate');
  END IF;

  BEGIN
    v_res := public.run_inventory_allocation(
      v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty,
      'return_good_release_reserved'
    );
    UPDATE public.allocation_hook_events SET result=v_res
     WHERE event_type='return_good' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.allocation_hook_events SET status='error', error=SQLERRM
     WHERE event_type='return_good' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END;
$$;

-- =========================================================
-- WRAPPER 3: Inventory Adjustment positivo
-- =========================================================
CREATE OR REPLACE FUNCTION public.allocation_on_inventory_adjustment_positive(_adj_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line   record;
  v_results jsonb := '[]'::jsonb;
  v_res    jsonb;
  v_key    text;
  v_diff   numeric;
BEGIN
  FOR v_line IN
    SELECT * FROM public.inventory_adjustment_lines
    WHERE adjustment_id = _adj_id
  LOOP
    v_diff := COALESCE(v_line.counted_qty,0) - COALESCE(v_line.theoretical_qty,0);
    IF v_diff <= 0 THEN CONTINUE; END IF;
    IF NOT public._alloc_hook_is_safe_location(v_line.location_id) THEN CONTINUE; END IF;

    v_key := 'inv_adj_pos:'||_adj_id::text||':line:'||v_line.id::text;
    IF NOT public._alloc_hook_register_event(
      'inv_adj_positive', _adj_id, v_key,
      v_line.product_id, v_line.variant_id, v_line.location_id, v_diff
    ) THEN CONTINUE; END IF;

    BEGIN
      v_res := public.run_inventory_allocation(
        v_line.product_id, v_line.variant_id, v_line.location_id, v_diff,
        'inventory_adjustment_positive'
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id, 'product_id', v_line.product_id, 'result', v_res
      ));
      UPDATE public.allocation_hook_events SET result=v_res
       WHERE event_type='inv_adj_positive' AND source_event_id=v_key;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.allocation_hook_events SET status='error', error=SQLERRM
       WHERE event_type='inv_adj_positive' AND source_event_id=v_key;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'adjustment_id', _adj_id, 'results', v_results);
END;
$$;

-- =========================================================
-- WRAPPER 4: Manual release de reserva
-- =========================================================
CREATE OR REPLACE FUNCTION public.allocation_on_manual_release(
  _product_id uuid, _variant_id uuid, _location_id uuid, _qty numeric, _source_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  v_key text;
BEGIN
  IF _product_id IS NULL OR _location_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','missing_params');
  END IF;
  IF NOT public._alloc_hook_is_safe_location(_location_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','unsafe_location');
  END IF;

  v_key := COALESCE(_source_event_id, 'manual_release:'||_product_id::text||':'||_location_id::text||':'||extract(epoch from clock_timestamp())::text);
  IF NOT public._alloc_hook_register_event(
    'manual_release', _product_id, v_key, _product_id, _variant_id, _location_id, _qty
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped','duplicate');
  END IF;

  BEGIN
    v_res := public.run_inventory_allocation(_product_id, _variant_id, _location_id, _qty, 'manual_release_reservation');
    UPDATE public.allocation_hook_events SET result=v_res
     WHERE event_type='manual_release' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.allocation_hook_events SET status='error', error=SQLERRM
     WHERE event_type='manual_release' AND source_event_id=v_key;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END;
$$;

-- =========================================================
-- TRIGGER 1: PO receipt → allocation_on_po_receipt
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_zz_alloc_on_po_receipt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'incoming' AND NEW.state = 'done'
     AND COALESCE(OLD.state::text,'') <> 'done' THEN
    BEGIN
      PERFORM public.allocation_on_po_receipt(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- não corromper a transação principal
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_zzz_alloc_po_receipt ON public.stock_pickings;
CREATE TRIGGER tg_zzz_alloc_po_receipt
  AFTER UPDATE OF state ON public.stock_pickings
  FOR EACH ROW EXECUTE FUNCTION public.tg_zz_alloc_on_po_receipt();

-- =========================================================
-- TRIGGER 2: stock_packages status→available (return good) → allocation
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_zz_alloc_on_package_available()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- só quando transita PARA available e condição é good/repaired e sem SO line
  IF NEW.status = 'available'
     AND COALESCE(OLD.status::text,'') <> 'available'
     AND NEW.condition IN ('good','repaired')
     AND NEW.sale_order_line_id IS NULL
     AND public._alloc_hook_is_safe_location(NEW.current_location_id)
     -- só interessa retorno: vinha de vehicle/customer/transit
     AND COALESCE(OLD.status::text,'') IN ('loaded','at_dock','picked','delivered','returned')
  THEN
    BEGIN
      PERFORM public.allocation_on_return_good(NEW.id, 'release_reserved');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_zzz_alloc_pkg_available ON public.stock_packages;
CREATE TRIGGER tg_zzz_alloc_pkg_available
  AFTER UPDATE OF status ON public.stock_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_zz_alloc_on_package_available();

-- =========================================================
-- TRIGGER 3: inventory_adjustments state→done → allocation
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_zz_alloc_on_inv_adj_done()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.state = 'done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    BEGIN
      PERFORM public.allocation_on_inventory_adjustment_positive(NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_zzz_alloc_inv_adj ON public.inventory_adjustments;
CREATE TRIGGER tg_zzz_alloc_inv_adj
  AFTER UPDATE OF state ON public.inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.tg_zz_alloc_on_inv_adj_done();
