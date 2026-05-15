
DROP FUNCTION IF EXISTS public.reserve_picking_strict(uuid);

CREATE OR REPLACE FUNCTION public.lock_quant(_product uuid, _location uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('quant:'||COALESCE(_product::text,'')||':'||COALESCE(_location::text,''))::bigint);
END $$;

CREATE OR REPLACE FUNCTION public.lock_order_payments(_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtext('payment_order:'||COALESCE(_order::text,''))::bigint); END $$;

CREATE OR REPLACE FUNCTION public.lock_cash_session(_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtext('cash_session:'||COALESCE(_session::text,''))::bigint); END $$;

CREATE OR REPLACE FUNCTION public.reserve_picking_strict(_picking uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pk record; mv record; q record;
  needed numeric; available numeric; reserved_now numeric; total_reserved numeric := 0;
  before_res numeric;
BEGIN
  SELECT * INTO pk FROM public.stock_pickings WHERE id=_picking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado: %', _picking; END IF;
  IF pk.state IN ('done','cancelled') THEN RETURN jsonb_build_object('skip', pk.state); END IF;

  FOR mv IN SELECT * FROM public.stock_moves WHERE picking_id=_picking AND state NOT IN ('done','cancelled') FOR UPDATE LOOP
    PERFORM public.lock_quant(mv.product_id, mv.source_location_id);

    needed := GREATEST(0, COALESCE(mv.quantity,0) - COALESCE(mv.reserved_quantity,0));
    IF needed <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(GREATEST(0, quantity-reserved_quantity)),0) INTO available
      FROM public.stock_quants WHERE product_id=mv.product_id AND location_id=mv.source_location_id;

    IF available < needed THEN
      RAISE EXCEPTION 'Stock insuficiente para produto % na localização %: precisa %, disponível %',
        mv.product_id, mv.source_location_id, needed, available USING ERRCODE='check_violation';
    END IF;

    reserved_now := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id=mv.product_id AND location_id=mv.source_location_id
                AND quantity-reserved_quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN reserved_now >= needed;
      DECLARE free_qty numeric := GREATEST(0, q.quantity-q.reserved_quantity);
              take numeric := LEAST(free_qty, needed-reserved_now);
      BEGIN
        IF take<=0 THEN CONTINUE; END IF;
        before_res := q.reserved_quantity;
        UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+take, updated_at=now() WHERE id=q.id;
        PERFORM public.log_stock_reservation(mv.product_id, NULL, q.location_id, q.lot_id,
          take, before_res, before_res+take, 'PICKING', _picking, 'reserve',
          'reserve_picking_strict move='||mv.id::text);
        reserved_now := reserved_now + take;
      END;
    END LOOP;

    UPDATE public.stock_moves
       SET reserved_quantity = COALESCE(reserved_quantity,0) + reserved_now,
           state = CASE WHEN COALESCE(reserved_quantity,0)+reserved_now >= quantity THEN 'assigned' ELSE 'partially_available' END
     WHERE id = mv.id;
    total_reserved := total_reserved + reserved_now;
  END LOOP;

  IF pk.state='draft' THEN UPDATE public.stock_pickings SET state='ready' WHERE id=_picking; END IF;
  RETURN jsonb_build_object('reserved_total', total_reserved);
END $$;

CREATE OR REPLACE FUNCTION public.reserve_mo(_mo uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  mo record; comp record; loc uuid; q record;
  needed numeric; reserved_now numeric; before_res numeric; available numeric;
  total numeric := 0;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=_mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna'; END IF;

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id=_mo FOR UPDATE LOOP
    PERFORM public.lock_quant(comp.product_id, loc);

    needed := GREATEST(0, COALESCE(comp.qty_required,0) - COALESCE(comp.qty_reserved,0) - COALESCE(comp.qty_consumed,0));
    IF needed <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(GREATEST(0, quantity-reserved_quantity)),0) INTO available
      FROM public.stock_quants WHERE product_id=comp.product_id AND location_id=loc;
    IF available < needed THEN needed := available; END IF;

    reserved_now := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id=comp.product_id AND location_id=loc
                AND quantity-reserved_quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN reserved_now >= needed;
      DECLARE free_qty numeric := GREATEST(0, q.quantity-q.reserved_quantity);
              take numeric := LEAST(free_qty, needed-reserved_now);
      BEGIN
        IF take<=0 THEN CONTINUE; END IF;
        before_res := q.reserved_quantity;
        UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+take, updated_at=now() WHERE id=q.id;
        PERFORM public.log_stock_reservation(comp.product_id, comp.variant_id, q.location_id, q.lot_id,
          take, before_res, before_res+take, 'MO', _mo, 'reserve',
          'reserve_mo comp='||comp.id::text);
        reserved_now := reserved_now + take;
      END;
    END LOOP;

    IF reserved_now > 0 THEN
      UPDATE public.mo_components
         SET qty_reserved = COALESCE(qty_reserved,0) + reserved_now,
             status = CASE WHEN COALESCE(qty_reserved,0)+reserved_now >= qty_required THEN 'reserved' ELSE 'partial' END
       WHERE id = comp.id;
      total := total + reserved_now;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reserved_total', total);
END $$;

ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_payments_idempotency
  ON public.customer_payments(order_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_customer_payment(
  _order uuid, _amount numeric, _method uuid,
  _journal uuid DEFAULT NULL, _schedule uuid DEFAULT NULL,
  _reference text DEFAULT NULL, _idempotency_key text DEFAULT NULL,
  _payment_date date DEFAULT NULL
) RETURNS public.customer_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_partner uuid; v_existing public.customer_payments; v_new public.customer_payments; v_name text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Valor inválido: %', _amount USING ERRCODE='check_violation'; END IF;
  IF _order IS NULL THEN RAISE EXCEPTION 'order_id obrigatório'; END IF;

  PERFORM public.lock_order_payments(_order);

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.customer_payments
      WHERE order_id=_order AND idempotency_key=_idempotency_key LIMIT 1;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT partner_id INTO v_partner FROM public.sale_orders WHERE id=_order;
  v_name := 'PAY/'||to_char(now(),'YYYYMMDD')||'/'||substr(gen_random_uuid()::text,1,6);

  INSERT INTO public.customer_payments
    (name, partner_id, order_id, schedule_id, payment_date, amount, method_id, journal_id,
     reference, state, idempotency_key, created_by)
  VALUES (v_name, v_partner, _order, _schedule, COALESCE(_payment_date, CURRENT_DATE),
          _amount, _method, _journal, _reference, 'posted', _idempotency_key, auth.uid())
  RETURNING * INTO v_new;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.tg_payment_register_cash_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid; v_register uuid; v_session uuid; v_method record;
BEGIN
  IF NEW.state <> 'posted' OR COALESCE(NEW.amount,0) <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;
  v_user := COALESCE(NEW.created_by, auth.uid());
  IF v_user IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_method FROM public.payment_methods WHERE id = NEW.method_id;
  IF FOUND AND v_method.feeds_cash_session = false THEN RETURN NEW; END IF;
  SELECT id INTO v_register FROM public.cash_registers WHERE user_id=v_user AND active ORDER BY created_at LIMIT 1;
  IF v_register IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE register_id=v_register AND state='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;

  PERFORM public.lock_cash_session(v_session);
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;

  INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by, notes)
  VALUES (v_session,'sale',NEW.amount,COALESCE(NEW.reference,NEW.name),NEW.partner_id,v_user,NEW.id,v_user,'Auto: pagamento '||NEW.name);
  RETURN NEW;
END $$;

CREATE INDEX IF NOT EXISTS idx_quants_prod_loc ON public.stock_quants(product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_moves_picking_state ON public.stock_moves(picking_id, state);
CREATE INDEX IF NOT EXISTS idx_mo_components_mo ON public.mo_components(mo_id);
CREATE INDEX IF NOT EXISTS idx_reslog_origin ON public.stock_reservation_log(origin_type, origin_id);
