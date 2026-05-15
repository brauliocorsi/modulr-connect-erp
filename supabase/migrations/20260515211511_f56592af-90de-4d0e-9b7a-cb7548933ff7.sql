
-- =====================================================================
-- FASE 1 — RESERVAS REAIS DE STOCK + AUDITORIA
-- =====================================================================
-- Princípio:
--   FONTE DE VERDADE  = stock_quants.reserved_quantity
--                     + stock_moves.reserved_quantity
--                     + mo_components.qty_reserved
--   AUDITORIA         = stock_reservation_log (esta tabela)
-- =====================================================================

-- ---------- 1. Tabela de auditoria ----------
CREATE TABLE IF NOT EXISTS public.stock_reservation_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL,
  variant_id  uuid,
  location_id uuid,
  lot_id      uuid,
  qty         numeric NOT NULL,
  qty_before  numeric,
  qty_after   numeric,
  origin_type text NOT NULL CHECK (origin_type IN ('SO','MO','PICKING','PURCHASE','MANUAL')),
  origin_id   uuid,
  action      text NOT NULL CHECK (action IN ('reserve','release','consume')),
  reserved_by uuid,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_srlog_origin   ON public.stock_reservation_log(origin_type, origin_id);
CREATE INDEX IF NOT EXISTS idx_srlog_product  ON public.stock_reservation_log(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_srlog_action   ON public.stock_reservation_log(action, created_at DESC);

ALTER TABLE public.stock_reservation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "srlog read auth"   ON public.stock_reservation_log;
CREATE POLICY "srlog read auth" ON public.stock_reservation_log
  FOR SELECT TO authenticated USING (true);

-- INSERT é feito apenas via SECURITY DEFINER abaixo: nenhum policy de write.

-- ---------- 2. Helper de log ----------
CREATE OR REPLACE FUNCTION public.log_stock_reservation(
  _product uuid, _variant uuid, _location uuid, _lot uuid,
  _qty numeric, _qty_before numeric, _qty_after numeric,
  _origin_type text, _origin uuid, _action text, _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF coalesce(_qty,0) = 0 THEN RETURN; END IF;
  INSERT INTO public.stock_reservation_log
    (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
     origin_type, origin_id, action, reserved_by, notes)
  VALUES
    (_product, _variant, _location, _lot, _qty, _qty_before, _qty_after,
     _origin_type, _origin, _action, auth.uid(), _notes);
END $$;

-- =====================================================================
-- 3. Patch nas RPCs de picking — adicionar logging
-- =====================================================================

-- 3.1 reserve_for_move : log 'reserve'
CREATE OR REPLACE FUNCTION public.reserve_for_move(_move uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
declare m record; q record; remaining numeric; take numeric; reserved_total numeric := 0;
        before_q numeric;
begin
  select * into m from public.stock_moves where id = _move;
  if not found or m.state in ('done','cancelled','ready') then
    return 0;
  end if;
  remaining := m.quantity;
  for q in
    select sq.* from public.stock_quants sq
    join public.stock_locations l on l.id = sq.location_id
    where sq.product_id = m.product_id
      and l.id = m.source_location_id
      and coalesce(sq.variant_id::text,'') = coalesce(m.variant_id::text,'')
      and (sq.quantity - sq.reserved_quantity) > 0
    order by sq.updated_at
    for update
  loop
    exit when remaining <= 0;
    take := least(remaining, q.quantity - q.reserved_quantity);
    before_q := q.reserved_quantity;
    update public.stock_quants
       set reserved_quantity = reserved_quantity + take, updated_at = now()
     where id = q.id;
    perform public.log_stock_reservation(
      m.product_id, m.variant_id, q.location_id, q.lot_id,
      take, before_q, before_q + take,
      'PICKING', m.picking_id, 'reserve',
      'reserve_for_move move='||m.id::text
    );
    remaining := remaining - take;
    reserved_total := reserved_total + take;
  end loop;
  update public.stock_moves
     set reserved_quantity = reserved_total,
         state = case when reserved_total >= m.quantity then 'ready'::picking_state else 'waiting'::picking_state end
   where id = _move;
  return reserved_total;
end $function$;

-- 3.2 release_move_reservation : log 'release' (idempotente)
CREATE OR REPLACE FUNCTION public.release_move_reservation(_move uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE m record; remaining numeric; take numeric; q record; before_q numeric;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = _move;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(m.reserved_quantity,0) <= 0 THEN RETURN; END IF;
  remaining := m.reserved_quantity;
  FOR q IN SELECT * FROM stock_quants
            WHERE product_id = m.product_id
              AND location_id = m.source_location_id
              AND coalesce(variant_id::text,'') = coalesce(m.variant_id::text,'')
              AND reserved_quantity > 0
            ORDER BY updated_at DESC
            FOR UPDATE LOOP
    EXIT WHEN remaining <= 0;
    take := least(remaining, q.reserved_quantity);
    before_q := q.reserved_quantity;
    UPDATE stock_quants SET reserved_quantity = greatest(0, reserved_quantity - take), updated_at = now()
      WHERE id = q.id;
    PERFORM public.log_stock_reservation(
      m.product_id, m.variant_id, q.location_id, q.lot_id,
      take, before_q, greatest(0, before_q - take),
      'PICKING', m.picking_id, 'release',
      'release_move_reservation move='||m.id::text
    );
    remaining := remaining - take;
  END LOOP;
  UPDATE stock_moves SET reserved_quantity = 0 WHERE id = _move;
END $function$;

-- 3.3 release_move_reservation_partial : log 'release'
CREATE OR REPLACE FUNCTION public.release_move_reservation_partial(_move uuid, _qty numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  m record; remaining numeric; take numeric; q record; released numeric := 0; before_q numeric;
BEGIN
  SELECT * INTO m FROM stock_moves WHERE id = _move;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF coalesce(m.reserved_quantity,0) <= 0 OR _qty <= 0 THEN RETURN 0; END IF;

  remaining := least(_qty, m.reserved_quantity);

  FOR q IN
    SELECT * FROM stock_quants
    WHERE product_id = m.product_id
      AND location_id = m.source_location_id
      AND reserved_quantity > 0
    ORDER BY updated_at DESC
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take := least(remaining, q.reserved_quantity);
    before_q := q.reserved_quantity;
    UPDATE stock_quants
       SET reserved_quantity = greatest(0, reserved_quantity - take), updated_at = now()
     WHERE id = q.id;
    PERFORM public.log_stock_reservation(
      m.product_id, m.variant_id, q.location_id, q.lot_id,
      take, before_q, greatest(0, before_q - take),
      'PICKING', m.picking_id, 'release',
      'release_move_reservation_partial move='||m.id::text
    );
    remaining := remaining - take;
    released := released + take;
  END LOOP;

  UPDATE public.stock_moves
     SET reserved_quantity = greatest(0, reserved_quantity - released),
         state = CASE
           WHEN greatest(0, reserved_quantity - released) >= quantity THEN 'ready'::picking_state
           WHEN greatest(0, reserved_quantity - released) > 0 THEN 'waiting'::picking_state
           ELSE 'waiting'::picking_state
         END
   WHERE id = _move;

  RETURN released;
END $function$;

-- 3.4 validate_picking : log 'consume' por linha que efetivamente baixa stock
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  m record; done_qty numeric; leftover numeric;
  src record; dst_q record; cur_picking record;
  upstream_pending int; bo_id uuid; bo_name text; bo_suffix int := 1; has_leftover boolean := false;
  src_before_qty numeric; src_before_res numeric;
BEGIN
  SELECT * INTO cur_picking FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transferência não encontrada'; END IF;

  IF cur_picking.origin IS NOT NULL AND cur_picking.source_location_id IS NOT NULL THEN
    SELECT count(*) INTO upstream_pending FROM public.stock_pickings p
    WHERE p.origin = cur_picking.origin AND p.id <> _picking
      AND p.destination_location_id = cur_picking.source_location_id
      AND p.state NOT IN ('done','cancelled');
    IF upstream_pending > 0 THEN
      RAISE EXCEPTION 'Não é possível validar: a etapa anterior da cadeia ainda não foi concluída.';
    END IF;
  END IF;

  UPDATE public.stock_moves
     SET quantity_done = quantity
   WHERE picking_id = _picking AND state <> 'cancelled'
     AND COALESCE(quantity_done, 0) = 0
     AND COALESCE(reserved_quantity, 0) >= quantity;

  SELECT EXISTS(
    SELECT 1 FROM public.stock_moves
    WHERE picking_id = _picking AND state <> 'cancelled' AND quantity_done < quantity
  ) INTO has_leftover;

  IF has_leftover THEN
    bo_name := cur_picking.name || '-BO';
    WHILE EXISTS(SELECT 1 FROM public.stock_pickings WHERE name = bo_name) LOOP
      bo_suffix := bo_suffix + 1;
      bo_name := cur_picking.name || '-BO' || bo_suffix;
    END LOOP;
    INSERT INTO public.stock_pickings(
      name, kind, state, warehouse_id, source_location_id, destination_location_id,
      partner_id, origin, scheduled_at, backorder_id, previous_picking_id, step_label,
      route_id, batch_id
    ) VALUES (
      bo_name, cur_picking.kind, 'ready', cur_picking.warehouse_id,
      cur_picking.source_location_id, cur_picking.destination_location_id,
      cur_picking.partner_id, cur_picking.origin, now(), _picking,
      cur_picking.previous_picking_id, cur_picking.step_label,
      cur_picking.route_id, cur_picking.batch_id
    ) RETURNING id INTO bo_id;
  END IF;

  FOR m IN SELECT * FROM public.stock_moves WHERE picking_id = _picking AND state <> 'cancelled' LOOP
    done_qty := COALESCE(m.quantity_done, m.quantity);
    leftover := GREATEST(0, m.quantity - done_qty);

    IF done_qty > 0 THEN
      DECLARE remaining numeric := done_qty;
      BEGIN
        FOR src IN
          SELECT * FROM public.stock_quants
          WHERE product_id = m.product_id
            AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
            AND location_id = m.source_location_id
          ORDER BY updated_at
          FOR UPDATE
        LOOP
          EXIT WHEN remaining <= 0;
          IF src.quantity <= 0 AND src.reserved_quantity <= 0 THEN CONTINUE; END IF;
          DECLARE take numeric := LEAST(remaining, src.quantity);
          BEGIN
            src_before_qty := src.quantity;
            src_before_res := src.reserved_quantity;
            UPDATE public.stock_quants
               SET quantity = quantity - take,
                   reserved_quantity = GREATEST(0, reserved_quantity - take),
                   updated_at = now()
             WHERE id = src.id;
            PERFORM public.log_stock_reservation(
              m.product_id, m.variant_id, src.location_id, m.lot_id,
              take, src_before_res, GREATEST(0, src_before_res - take),
              'PICKING', _picking, 'consume',
              'validate_picking move='||m.id::text||' qty_before='||src_before_qty::text
            );
            remaining := remaining - take;
          END;
        END LOOP;
        IF remaining > 0 THEN
          INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
          VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -remaining);
        END IF;
      END;

      SELECT * INTO dst_q FROM public.stock_quants
        WHERE product_id = m.product_id
          AND COALESCE(variant_id::text,'') = COALESCE(m.variant_id::text,'')
          AND location_id = m.destination_location_id
          AND COALESCE(lot_id::text,'') = COALESCE(m.lot_id::text,'')
        LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity = quantity + done_qty, updated_at=now() WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, done_qty);
      END IF;

      UPDATE public.stock_moves SET state='done', quantity = done_qty, quantity_done = done_qty WHERE id = m.id;
    END IF;

    IF leftover > 0 AND bo_id IS NOT NULL THEN
      INSERT INTO public.stock_moves(
        picking_id, product_id, variant_id, lot_id, uom_id,
        source_location_id, destination_location_id, quantity, quantity_done, state, reference
      ) VALUES (
        bo_id, m.product_id, m.variant_id, NULL, m.uom_id,
        m.source_location_id, m.destination_location_id, leftover, 0, 'ready', m.reference
      );
      IF done_qty = 0 THEN
        DELETE FROM public.stock_moves WHERE id = m.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.stock_pickings SET state='done', done_at=now() WHERE id = _picking;
  PERFORM public.log_record_event('stock_picking', _picking, 'Transferência validada', '{}'::jsonb);
  IF bo_id IS NOT NULL THEN
    PERFORM public.log_record_event('stock_picking', bo_id, 'Backorder criado', jsonb_build_object('from', _picking));
  END IF;
END $function$;

-- 3.5 reserve_picking_strict : bloqueia se faltar stock
CREATE OR REPLACE FUNCTION public.reserve_picking_strict(_picking uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE m record; got numeric; missing jsonb := '[]'::jsonb;
BEGIN
  FOR m IN SELECT id, product_id, quantity FROM stock_moves
            WHERE picking_id=_picking AND state IN ('draft','waiting') LOOP
    got := public.reserve_for_move(m.id);
    IF got < m.quantity THEN
      missing := missing || jsonb_build_object('move_id', m.id, 'product_id', m.product_id,
                                                'requested', m.quantity, 'reserved', got);
    END IF;
  END LOOP;
  PERFORM public.recalc_picking_state(_picking);
  IF jsonb_array_length(missing) > 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para reservar picking %: %', _picking, missing::text
      USING ERRCODE = 'check_violation';
  END IF;
END $function$;

-- =====================================================================
-- 4. RPCs de produção
-- =====================================================================

-- 4.1 helper: localização interna principal de um warehouse
CREATE OR REPLACE FUNCTION public._wh_main_internal_loc(_wh uuid)
RETURNS uuid
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT id FROM public.stock_locations
   WHERE warehouse_id = _wh AND type = 'internal' AND active = true
   ORDER BY (parent_id IS NULL) DESC, created_at
   LIMIT 1;
$$;

-- 4.2 reserve_mo : reserva componentes (idempotente — só reserva delta em falta)
CREATE OR REPLACE FUNCTION public.reserve_mo(_mo uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  mo record; comp record; loc uuid;
  need numeric; remaining numeric; take numeric; before_q numeric; q record;
  reserved_for_comp numeric;
  missing jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada: %', _mo; END IF;
  IF mo.state IN ('done','cancelled') THEN RETURN jsonb_build_object('skipped', mo.state); END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    -- delta a reservar: required - já reservado - já consumido
    need := GREATEST(0, comp.qty_required - COALESCE(comp.qty_reserved,0) - COALESCE(comp.qty_consumed,0));
    IF need <= 0 THEN CONTINUE; END IF;

    remaining := need; reserved_for_comp := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id
                AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND (quantity - reserved_quantity) > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.quantity - q.reserved_quantity);
      before_q := q.reserved_quantity;
      UPDATE public.stock_quants SET reserved_quantity = reserved_quantity + take, updated_at = now()
        WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_q, before_q + take,
        'MO', _mo, 'reserve', 'reserve_mo comp='||comp.id::text
      );
      remaining := remaining - take;
      reserved_for_comp := reserved_for_comp + take;
    END LOOP;

    UPDATE public.mo_components
       SET qty_reserved = COALESCE(qty_reserved,0) + reserved_for_comp
     WHERE id = comp.id;

    IF reserved_for_comp < need THEN
      missing := missing || jsonb_build_object(
        'component_id', comp.id, 'product_id', comp.product_id,
        'needed', need, 'reserved', reserved_for_comp
      );
    END IF;
  END LOOP;

  -- refresca status dos componentes
  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;

  RETURN jsonb_build_object('mo_id', _mo, 'missing', missing,
                            'fully_reserved', jsonb_array_length(missing) = 0);
END $function$;

-- 4.3 release_mo_reservation : idempotente (GREATEST 0)
CREATE OR REPLACE FUNCTION public.release_mo_reservation(_mo uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE mo record; comp record; loc uuid; remaining numeric; take numeric; q record; before_q numeric;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RETURN; END IF;

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    remaining := COALESCE(comp.qty_reserved,0);
    IF remaining <= 0 THEN CONTINUE; END IF;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id
                AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND reserved_quantity > 0
              ORDER BY updated_at DESC FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.reserved_quantity);
      before_q := q.reserved_quantity;
      UPDATE public.stock_quants SET reserved_quantity = GREATEST(0, reserved_quantity - take), updated_at=now()
        WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_q, GREATEST(0, before_q - take),
        'MO', _mo, 'release', 'release_mo_reservation comp='||comp.id::text
      );
      remaining := remaining - take;
    END LOOP;
    UPDATE public.mo_components SET qty_reserved = 0 WHERE id = comp.id;
  END LOOP;
END $function$;

-- 4.4 close_mo : consome componentes reservados e dá entrada do FG
CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid, _qty_produced numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  mo record; comp record; loc uuid; produced numeric;
  ratio numeric; consume_qty numeric; remaining numeric; take numeric;
  q record; dst_q record; before_q numeric; before_res numeric;
  total_consumed numeric;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('already', 'done'); END IF;
  IF mo.state = 'cancelled' THEN RAISE EXCEPTION 'MO cancelada não pode ser fechada'; END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;

  produced := COALESCE(_qty_produced, mo.qty);
  IF produced <= 0 THEN RAISE EXCEPTION 'qty_produced inválido'; END IF;
  ratio := produced / NULLIF(mo.qty, 0);

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    consume_qty := GREATEST(0, ROUND((comp.qty_required * ratio)::numeric, 4) - COALESCE(comp.qty_consumed,0));
    IF consume_qty <= 0 THEN CONTINUE; END IF;
    remaining := consume_qty;
    total_consumed := 0;

    -- consome dos quants (decrementa quantity e reserved_quantity, idempotente via GREATEST)
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id
                AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.quantity);
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = quantity - take,
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_res, GREATEST(0, before_res - take),
        'MO', _mo, 'consume',
        'close_mo comp='||comp.id::text||' qty_before='||before_q::text
      );
      remaining := remaining - take;
      total_consumed := total_consumed + take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'Stock físico insuficiente para consumir componente % (faltam %)', comp.product_id, remaining;
    END IF;

    UPDATE public.mo_components
       SET qty_consumed = COALESCE(qty_consumed,0) + total_consumed,
           qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
     WHERE id = comp.id;
  END LOOP;

  -- entrada do produto acabado
  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(mo.variant_id::text,'')
     AND location_id = loc
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now() WHERE id = dst_q.id;
  ELSE
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced);
  END IF;

  PERFORM public.log_stock_reservation(
    mo.product_id, mo.variant_id, loc, NULL,
    produced, 0, produced, 'MO', _mo, 'consume',
    'close_mo finished_good qty='||produced::text
  );

  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;
  RETURN jsonb_build_object('mo_id', _mo, 'produced', produced);
END $function$;

-- =====================================================================
-- 5. Triggers automáticos na MO
-- =====================================================================

CREATE OR REPLACE FUNCTION public.tg_mo_state_reservations()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'ready' AND OLD.state IN ('draft','waiting_material') THEN
      PERFORM public.reserve_mo(NEW.id);
    ELSIF NEW.state = 'cancelled' AND OLD.state NOT IN ('done','cancelled') THEN
      PERFORM public.release_mo_reservation(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_mo_state_reservations ON public.manufacturing_orders;
CREATE TRIGGER tg_mo_state_reservations
AFTER UPDATE OF state ON public.manufacturing_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_mo_state_reservations();
