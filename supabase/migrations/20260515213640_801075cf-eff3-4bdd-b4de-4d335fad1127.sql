
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
       SET reserved_quantity = COALESCE(reserved_quantity,0) + reserved_now
     WHERE id = mv.id;
    total_reserved := total_reserved + reserved_now;
  END LOOP;

  IF pk.state = 'draft'::picking_state THEN
    UPDATE public.stock_pickings SET state='ready'::picking_state WHERE id=_picking;
  END IF;
  RETURN jsonb_build_object('reserved_total', total_reserved);
END $$;

-- Increase entropy of payment name to avoid duplicate-name collisions under heavy parallel load
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
  v_name := 'PAY/'||to_char(now(),'YYYYMMDDHH24MISSMS')||'/'||replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.customer_payments
    (name, partner_id, order_id, schedule_id, payment_date, amount, method_id, journal_id,
     reference, state, idempotency_key, created_by)
  VALUES (v_name, v_partner, _order, _schedule, COALESCE(_payment_date, CURRENT_DATE),
          _amount, _method, _journal, _reference, 'posted', _idempotency_key, auth.uid())
  RETURNING * INTO v_new;
  RETURN v_new;
END $$;
