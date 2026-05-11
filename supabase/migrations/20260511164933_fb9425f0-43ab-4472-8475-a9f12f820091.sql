CREATE OR REPLACE FUNCTION public.trg_release_orphan_reservations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Avoid infinite recursion: only run at top-level trigger depth.
  -- When reserve_for_move() (called from tg_quant_try_reserve) updates
  -- stock_moves.state, this trigger would fire again → release_orphan_reservations
  -- → updates quants → tg_quant_try_reserve → reserve_for_move → ...
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  PERFORM public.release_orphan_reservations();
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_quant_try_reserve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; old_avail numeric; new_avail numeric;
BEGIN
  -- Prevent cascading reservations when this trigger is fired by a nested
  -- update originating from reserve_for_move / release_orphan_reservations.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  new_avail := COALESCE(NEW.quantity,0) - COALESCE(NEW.reserved_quantity,0);
  IF TG_OP='UPDATE' THEN old_avail := COALESCE(OLD.quantity,0) - COALESCE(OLD.reserved_quantity,0); ELSE old_avail := 0; END IF;
  IF new_avail <= old_avail THEN RETURN NEW; END IF;

  FOR m IN
    SELECT sm.id, sm.picking_id FROM stock_moves sm
    JOIN stock_pickings p ON p.id=sm.picking_id
    WHERE sm.product_id=NEW.product_id AND sm.source_location_id=NEW.location_id
      AND sm.state IN ('draft','waiting')
      AND p.kind IN ('outgoing','internal')
      AND p.state NOT IN ('done','cancelled')
    ORDER BY p.created_at, sm.created_at
  LOOP
    PERFORM public.reserve_for_move(m.id);
    PERFORM public.recalc_picking_state(m.picking_id);
  END LOOP;
  RETURN NEW;
END $function$;