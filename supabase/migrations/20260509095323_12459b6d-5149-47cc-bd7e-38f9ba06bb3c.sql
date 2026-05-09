-- Function: recompute picking state from its moves' states
CREATE OR REPLACE FUNCTION public.recalc_picking_state(_picking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  total int; ready_n int; done_n int; cancel_n int; cur picking_state;
BEGIN
  SELECT state INTO cur FROM stock_pickings WHERE id = _picking;
  IF cur IS NULL OR cur IN ('done','cancelled','draft') THEN RETURN; END IF;
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE state='ready'),
    COUNT(*) FILTER (WHERE state='done'),
    COUNT(*) FILTER (WHERE state='cancelled')
  INTO total, ready_n, done_n, cancel_n
  FROM stock_moves WHERE picking_id = _picking;
  IF total = 0 THEN RETURN; END IF;
  IF (done_n + cancel_n) = total THEN RETURN; END IF;
  IF (ready_n + done_n + cancel_n) = total AND (ready_n + done_n) > 0 THEN
    UPDATE stock_pickings SET state='ready' WHERE id=_picking AND state<>'ready';
  ELSE
    UPDATE stock_pickings SET state='waiting' WHERE id=_picking AND state<>'waiting';
  END IF;
END $$;

-- Try to reserve all unreserved moves of a picking
CREATE OR REPLACE FUNCTION public.try_reserve_picking(_picking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m record;
BEGIN
  FOR m IN SELECT id FROM stock_moves WHERE picking_id=_picking AND state IN ('draft','waiting') LOOP
    PERFORM public.reserve_for_move(m.id);
  END LOOP;
  PERFORM public.recalc_picking_state(_picking);
END $$;

-- Trigger: when a move's state changes, recalc its picking state
CREATE OR REPLACE FUNCTION public.tg_recalc_picking_from_move_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.picking_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    PERFORM public.recalc_picking_state(NEW.picking_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recalc_picking_from_move_state ON public.stock_moves;
CREATE TRIGGER trg_recalc_picking_from_move_state
AFTER INSERT OR UPDATE OF state ON public.stock_moves
FOR EACH ROW EXECUTE FUNCTION public.tg_recalc_picking_from_move_state();

-- Trigger: when stock becomes available (quantity goes up or reserved goes down),
-- try to reserve waiting outgoing moves for this product/location.
CREATE OR REPLACE FUNCTION public.tg_quant_try_reserve()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  m record;
  old_avail numeric;
  new_avail numeric;
BEGIN
  new_avail := COALESCE(NEW.quantity,0) - COALESCE(NEW.reserved_quantity,0);
  IF TG_OP='UPDATE' THEN
    old_avail := COALESCE(OLD.quantity,0) - COALESCE(OLD.reserved_quantity,0);
  ELSE
    old_avail := 0;
  END IF;
  IF new_avail <= old_avail THEN RETURN NEW; END IF;

  FOR m IN
    SELECT sm.id, sm.picking_id
    FROM stock_moves sm
    JOIN stock_pickings p ON p.id = sm.picking_id
    WHERE sm.product_id = NEW.product_id
      AND sm.source_location_id = NEW.location_id
      AND sm.state IN ('draft','waiting')
      AND p.kind = 'outgoing'
      AND p.state NOT IN ('done','cancelled')
    ORDER BY p.created_at, sm.created_at
  LOOP
    PERFORM public.reserve_for_move(m.id);
    PERFORM public.recalc_picking_state(m.picking_id);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quant_try_reserve ON public.stock_quants;
CREATE TRIGGER trg_quant_try_reserve
AFTER INSERT OR UPDATE OF quantity, reserved_quantity ON public.stock_quants
FOR EACH ROW EXECUTE FUNCTION public.tg_quant_try_reserve();