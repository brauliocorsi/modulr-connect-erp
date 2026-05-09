
CREATE OR REPLACE FUNCTION public.release_move_reservation(_move uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; remaining numeric; take numeric; q record;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = _move;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(m.reserved_quantity,0) <= 0 THEN RETURN; END IF;
  remaining := m.reserved_quantity;
  FOR q IN SELECT * FROM stock_quants
            WHERE product_id = m.product_id
              AND location_id = m.source_location_id
              AND reserved_quantity > 0
            ORDER BY updated_at DESC LOOP
    EXIT WHEN remaining <= 0;
    take := least(remaining, q.reserved_quantity);
    UPDATE stock_quants SET reserved_quantity = greatest(0, reserved_quantity - take), updated_at = now()
      WHERE id = q.id;
    remaining := remaining - take;
  END LOOP;
  UPDATE stock_moves SET reserved_quantity = 0 WHERE id = _move;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_picking(_picking uuid, _cascade boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; nxt record; p record;
BEGIN
  SELECT * INTO p FROM stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RETURN; END IF;
  IF p.state = 'done' THEN
    RAISE EXCEPTION 'Não é possível cancelar uma transferência já concluída';
  END IF;
  FOR m IN SELECT id FROM stock_moves WHERE picking_id = _picking AND state NOT IN ('done','cancelled') LOOP
    PERFORM release_move_reservation(m.id);
    UPDATE stock_moves SET state = 'cancelled'::picking_state WHERE id = m.id;
  END LOOP;
  UPDATE stock_pickings SET state = 'cancelled'::picking_state WHERE id = _picking;
  PERFORM log_record_event('stock_picking', _picking, 'Transferência cancelada', '{}'::jsonb);
  IF _cascade THEN
    FOR nxt IN SELECT id FROM stock_pickings WHERE previous_picking_id = _picking AND state NOT IN ('done','cancelled') LOOP
      PERFORM cancel_picking(nxt.id, true);
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_batch(_batch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id FROM stock_pickings WHERE batch_id = _batch AND state NOT IN ('done','cancelled') LOOP
    PERFORM cancel_picking(p.id, false);
  END LOOP;
  UPDATE stock_picking_batches SET state='cancelled', updated_at=now() WHERE id=_batch;
  PERFORM log_record_event('stock_picking_batch', _batch, 'Lote cancelado e reservas libertadas', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_wave(_wave uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; pickings uuid[];
BEGIN
  SELECT array_agg(DISTINCT picking_id) INTO pickings FROM stock_moves WHERE wave_id = _wave;
  FOR m IN SELECT id FROM stock_moves WHERE wave_id = _wave AND state NOT IN ('done','cancelled') LOOP
    PERFORM release_move_reservation(m.id);
    UPDATE stock_moves SET wave_id = NULL, state = 'waiting'::picking_state WHERE id = m.id;
  END LOOP;
  UPDATE stock_picking_waves SET state='cancelled', updated_at=now() WHERE id=_wave;
  IF pickings IS NOT NULL THEN
    FOR i IN 1..array_length(pickings,1) LOOP
      PERFORM recalc_picking_state(pickings[i]);
    END LOOP;
  END IF;
  PERFORM log_record_event('stock_picking_wave', _wave, 'Onda cancelada e reservas libertadas', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.replan_picking_chain(_picking uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE root uuid; cur uuid; m record; reserved numeric; needed numeric;
        shortage_total numeric := 0; ok_total numeric := 0; steps int := 0;
BEGIN
  root := _picking;
  LOOP
    SELECT previous_picking_id INTO cur FROM stock_pickings WHERE id = root;
    EXIT WHEN cur IS NULL;
    root := cur;
  END LOOP;

  cur := root;
  WHILE cur IS NOT NULL LOOP
    steps := steps + 1;
    FOR m IN SELECT * FROM stock_moves WHERE picking_id = cur AND state IN ('draft','waiting') LOOP
      needed := coalesce(m.quantity,0) - coalesce(m.reserved_quantity,0);
      IF needed > 0 THEN
        reserved := reserve_for_move(m.id);
        ok_total := ok_total + reserved;
        IF reserved < needed THEN
          shortage_total := shortage_total + (needed - reserved);
        END IF;
      END IF;
    END LOOP;
    PERFORM recalc_picking_state(cur);
    SELECT id INTO cur FROM stock_pickings WHERE previous_picking_id = cur LIMIT 1;
  END LOOP;

  PERFORM log_record_event('stock_picking', _picking,
    format('Replaneamento da cadeia: %s etapa(s), %s reservado, %s em falta', steps, ok_total, shortage_total),
    jsonb_build_object('steps', steps, 'reserved', ok_total, 'shortage', shortage_total));

  RETURN jsonb_build_object('steps', steps, 'reserved', ok_total, 'shortage', shortage_total);
END $$;

CREATE OR REPLACE FUNCTION public.picking_shortages(_picking uuid)
RETURNS TABLE(product_id uuid, product_name text, demand numeric, available numeric, shortage numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.product_id,
         p.name,
         sum(m.quantity)::numeric AS demand,
         coalesce(sum(coalesce(q.quantity,0) - coalesce(q.reserved_quantity,0)),0)::numeric AS available,
         greatest(0, sum(m.quantity) - coalesce(sum(coalesce(q.quantity,0) - coalesce(q.reserved_quantity,0)),0))::numeric AS shortage
    FROM stock_moves m
    JOIN products p ON p.id = m.product_id
    LEFT JOIN stock_quants q
      ON q.product_id = m.product_id AND q.location_id = m.source_location_id
   WHERE m.picking_id = _picking AND m.state NOT IN ('done','cancelled')
   GROUP BY m.product_id, p.name
   HAVING sum(m.quantity) > coalesce(sum(coalesce(q.quantity,0) - coalesce(q.reserved_quantity,0)),0)
$$;

CREATE OR REPLACE VIEW public.v_picking_exceptions
WITH (security_invoker = true) AS
WITH demand AS (
  SELECT sm.picking_id,
         sm.product_id,
         sm.source_location_id,
         sum(sm.quantity) FILTER (WHERE sm.state NOT IN ('done','cancelled')) AS need,
         (SELECT coalesce(sum(coalesce(q.quantity,0) - coalesce(q.reserved_quantity,0)),0)
            FROM stock_quants q
           WHERE q.product_id = sm.product_id AND q.location_id = sm.source_location_id) AS avail
    FROM stock_moves sm
   GROUP BY sm.picking_id, sm.product_id, sm.source_location_id
)
SELECT p.id AS picking_id, p.name, p.state, p.kind, p.warehouse_id, p.partner_id,
       p.previous_picking_id, p.batch_id, p.scheduled_at, p.step_label,
       coalesce(sum(greatest(0, d.need - d.avail)),0) AS total_shortage,
       count(*) FILTER (WHERE d.need > d.avail) AS shortage_lines,
       (p.state = 'waiting' AND p.previous_picking_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM stock_pickings pp WHERE pp.id = p.previous_picking_id AND pp.state <> 'done')) AS waiting_previous,
       (p.scheduled_at IS NOT NULL AND p.scheduled_at < now() AND p.state NOT IN ('done','cancelled')) AS overdue
  FROM stock_pickings p
  LEFT JOIN demand d ON d.picking_id = p.id
 WHERE p.state NOT IN ('done','cancelled')
 GROUP BY p.id;

GRANT SELECT ON public.v_picking_exceptions TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_chain_advance_on_done()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nxt record; m record; reserved numeric; short numeric; needed numeric;
BEGIN
  IF NEW.state = 'done' AND coalesce(OLD.state::text,'') <> 'done' THEN
    FOR nxt IN SELECT * FROM stock_pickings WHERE previous_picking_id = NEW.id AND state NOT IN ('done','cancelled') LOOP
      short := 0;
      FOR m IN SELECT * FROM stock_moves WHERE picking_id = nxt.id AND state IN ('draft','waiting') LOOP
        needed := coalesce(m.quantity,0) - coalesce(m.reserved_quantity,0);
        IF needed > 0 THEN
          reserved := reserve_for_move(m.id);
          IF reserved < needed THEN
            short := short + (needed - reserved);
          END IF;
        END IF;
      END LOOP;
      PERFORM recalc_picking_state(nxt.id);
      IF short > 0 AND nxt.user_id IS NOT NULL THEN
        PERFORM notify_user(nxt.user_id, 'inventory'::app_module, 'picking_shortage',
          'Falta de stock na próxima etapa',
          format('Transferência %s tem %s unid. em falta após replaneamento', nxt.name, short),
          '/inventory/transfers/' || nxt.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chain_advance_on_done ON public.stock_pickings;
CREATE TRIGGER trg_chain_advance_on_done
AFTER UPDATE OF state ON public.stock_pickings
FOR EACH ROW EXECUTE FUNCTION public.tg_chain_advance_on_done();

CREATE OR REPLACE FUNCTION public.validate_batch(_batch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; ok int := 0; ko int := 0; errs jsonb := '[]'::jsonb;
BEGIN
  FOR p IN SELECT id, name FROM stock_pickings WHERE batch_id=_batch AND state NOT IN ('done','cancelled') LOOP
    BEGIN
      PERFORM validate_picking(p.id);
      ok := ok + 1;
    EXCEPTION WHEN OTHERS THEN
      ko := ko + 1;
      errs := errs || jsonb_build_object('picking', p.name, 'error', SQLERRM);
    END;
  END LOOP;
  IF ko = 0 THEN
    UPDATE stock_picking_batches SET state='done', updated_at=now() WHERE id=_batch;
  ELSE
    UPDATE stock_picking_batches SET state='in_progress', updated_at=now() WHERE id=_batch;
  END IF;
  RETURN jsonb_build_object('validated', ok, 'failed', ko, 'errors', errs);
END $$;
