CREATE OR REPLACE FUNCTION public.driver_deliver_picking(_picking uuid, _payment_amount numeric DEFAULT 0, _method_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pk record; bt record; rt record; so_id uuid; pay_id uuid;
  v_register uuid; v_session uuid; v_journal uuid;
  v_driver uuid; v_vehicle uuid;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id=_picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;
  IF pk.kind <> 'outgoing' THEN RAISE EXCEPTION 'Apenas pickings de saída'; END IF;

  -- Prefer route assignment; fall back to legacy batch
  IF pk.route_id IS NOT NULL THEN
    SELECT * INTO rt FROM delivery_routes WHERE id = pk.route_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rota da entrega não encontrada'; END IF;
    v_driver := rt.driver_id;
    v_vehicle := rt.vehicle_id;
  ELSIF pk.batch_id IS NOT NULL THEN
    SELECT * INTO bt FROM stock_picking_batches WHERE id = pk.batch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lote da entrega não encontrado'; END IF;
    v_driver := bt.driver_id;
    v_vehicle := bt.vehicle_id;
  ELSE
    RAISE EXCEPTION 'Esta entrega ainda não foi agendada numa rota';
  END IF;

  IF v_driver IS DISTINCT FROM auth.uid() AND NOT public.has_group(auth.uid(),'system_admin') THEN
    RAISE EXCEPTION 'Esta entrega não está atribuída ao motorista atual';
  END IF;

  UPDATE stock_moves SET quantity_done = quantity
   WHERE picking_id = _picking AND coalesce(quantity_done,0) = 0 AND state NOT IN ('done','cancelled');

  PERFORM public.validate_picking(_picking);

  SELECT id INTO so_id FROM sale_orders WHERE name = pk.origin;

  IF _payment_amount > 0 AND so_id IS NOT NULL THEN
    IF v_vehicle IS NOT NULL THEN
      SELECT cash_register_id INTO v_register FROM vehicles WHERE id = v_vehicle;
    END IF;
    IF v_register IS NULL THEN
      SELECT id INTO v_register FROM cash_registers WHERE driver_id = auth.uid() AND active LIMIT 1;
    END IF;
    SELECT default_journal_id INTO v_journal FROM payment_methods WHERE id = _method_id;

    INSERT INTO customer_payments(name, partner_id, order_id, payment_date, amount, method_id, journal_id, reference, state, created_by)
      VALUES ('PAY-DRV-'||substr(gen_random_uuid()::text,1,8),
              pk.partner_id, so_id, current_date, _payment_amount, _method_id, v_journal,
              'Entrega '||pk.name, 'posted', auth.uid())
      RETURNING id INTO pay_id;

    IF v_register IS NOT NULL THEN
      SELECT id INTO v_session FROM cash_sessions WHERE register_id = v_register AND state='open' ORDER BY opened_at DESC LIMIT 1;
      IF v_session IS NOT NULL THEN
        INSERT INTO cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by)
          VALUES (v_session, 'cash_in', _payment_amount, 'Entrega '||pk.name, pk.partner_id, auth.uid(), pay_id, auth.uid());
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('picking', _picking, 'payment_id', pay_id, 'sale_order', so_id);
END $function$;