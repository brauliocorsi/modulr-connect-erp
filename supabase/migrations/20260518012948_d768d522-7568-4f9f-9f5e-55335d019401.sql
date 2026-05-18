
CREATE OR REPLACE FUNCTION public._cleanup_phase17_payment_subcases()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pfx text := 'TESTE_PAY_SUB_';
BEGIN
  DELETE FROM cash_movements WHERE reference LIKE v_pfx||'%' OR notes LIKE v_pfx||'%';
  DELETE FROM cash_movements WHERE session_id IN (SELECT id FROM cash_sessions WHERE name LIKE v_pfx||'%');
  DELETE FROM cash_movements WHERE route_id IN (SELECT id FROM delivery_routes WHERE notes LIKE v_pfx||'%');
  DELETE FROM delivery_route_cash_closure WHERE route_id IN (SELECT id FROM delivery_routes WHERE notes LIKE v_pfx||'%');
  DELETE FROM customer_payments WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%');
  DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%');
  DELETE FROM sale_orders WHERE name LIKE v_pfx||'%';
  DELETE FROM delivery_route_orders WHERE route_id IN (SELECT id FROM delivery_routes WHERE notes LIKE v_pfx||'%');
  DELETE FROM delivery_routes WHERE notes LIKE v_pfx||'%';
  DELETE FROM cash_sessions WHERE name LIKE v_pfx||'%';
  DELETE FROM cash_registers WHERE name LIKE v_pfx||'%';
END $function$;

CREATE OR REPLACE FUNCTION public._test_phase17_payment_subcases(_cleanup boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_seed jsonb; v_report jsonb := '[]'::jsonb;
  v_ok int := 0; v_fail int := 0;
  v_pfx text := 'TESTE_PAY_SUB_';
  v_customer uuid; v_wh uuid; v_cama uuid;
  v_method_cash uuid; v_method_mbway uuid; v_method_mb uuid;
  v_register uuid; v_session uuid;
  v_so uuid; v_sol uuid; v_pay record; v_pass boolean;
  v_cm_count int; v_pay_status text; v_state text; v_op text;
  v_sum jsonb; v_close jsonb; v_close2 jsonb;
  v_route uuid; v_route2 uuid; v_var numeric;
  v_sqlstate text; v_sqlerrm text;
BEGIN
  PERFORM public._cleanup_phase17_payment_subcases();
  v_seed := public._seed_golden_upm();
  v_customer := (v_seed->>'customer')::uuid;
  v_wh       := (v_seed->>'warehouse')::uuid;
  v_cama     := (v_seed->>'cama')::uuid;

  SELECT id INTO v_method_cash  FROM payment_methods WHERE code='CASH'  LIMIT 1;
  SELECT id INTO v_method_mbway FROM payment_methods WHERE code='MBWAY' LIMIT 1;
  SELECT id INTO v_method_mb    FROM payment_methods WHERE code='MB'    LIMIT 1;

  -- cash_register + cash_session abertos manualmente (open_cash_session exige auth.uid()).
  -- Fixture de teste — não é bypass de customer_payments/cash_movements via UI.
  INSERT INTO cash_registers(name, warehouse_id, active)
    VALUES (v_pfx||'REG', v_wh, true) RETURNING id INTO v_register;
  INSERT INTO cash_sessions(name, register_id, opening_balance, state)
    VALUES (v_pfx||'SESS', v_register, 0, 'open') RETURNING id INTO v_session;
  INSERT INTO cash_movements(session_id, kind, amount, reference, notes)
    VALUES (v_session, 'opening', 0, v_pfx||'OPEN', v_pfx||'fixture');

  v_report := v_report || jsonb_build_object('id','SETUP','status','OK',
    'observed', format('register=%s session=%s', v_register, v_session));
  v_ok := v_ok + 1;

  -- ============ P03 — cash_movement com cash_session aberta ============
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'P03_SO',v_customer,v_wh,'confirmed','delivery',100,100) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,100,100,'product') RETURNING id INTO v_sol;

    SELECT * INTO v_pay FROM public.register_customer_payment(
      v_so, 100, v_method_cash, NULL, NULL, v_pfx||'P03_REF', v_pfx||'P03_IDEM');
    v_cm_count := (SELECT count(*) FROM cash_movements
                    WHERE payment_id=v_pay.id AND session_id=v_session AND kind='sale');
    v_pass := v_pay.id IS NOT NULL AND v_pay.state='posted' AND v_cm_count = 1;
    v_report := v_report || jsonb_build_object('id','P03','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s cm=%s', v_pay.id, v_pay.state, v_cm_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P03','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  BEGIN
    BEGIN PERFORM public.register_customer_payment(
      v_so, 100, v_method_cash, NULL, NULL, v_pfx||'P03_REF', v_pfx||'P03_IDEM');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    v_cm_count := (SELECT count(*) FROM customer_payments WHERE order_id=v_so AND idempotency_key=v_pfx||'P03_IDEM');
    v_pass := v_cm_count = 1
              AND (SELECT count(*) FROM cash_movements WHERE payment_id=v_pay.id AND kind='sale') = 1;
    v_report := v_report || jsonb_build_object('id','P03b','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', 'dup_pay='||v_cm_count);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- ============ P09 — pagamento total na entrega ============
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total,
                            fulfillment_status, payment_status)
      VALUES (v_pfx||'P09_SO',v_customer,v_wh,'confirmed','delivery',500,500,'undelivered','unpaid') RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,500,500,'product') RETURNING id INTO v_sol;
    UPDATE sale_order_lines SET qty_delivered=quantity WHERE order_id=v_so;
    PERFORM public.so_apply_delivery_rollup(v_so);
    SELECT * INTO v_pay FROM public.register_customer_payment(
      v_so, 500, v_method_cash, NULL, NULL, v_pfx||'P09_REF', v_pfx||'P09_IDEM');
    PERFORM public.recompute_sale_payment_status(v_so);
    SELECT payment_status::text, state::text, operational_status::text
      INTO v_pay_status, v_state, v_op FROM sale_orders WHERE id=v_so;
    v_pass := v_pay_status='paid' AND v_state='done' AND v_op='completed';
    v_report := v_report || jsonb_build_object('id','P09','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s op=%s', v_pay_status, v_state, v_op));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P09','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- ============ P10 — sinal + restante ============
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total,
                            fulfillment_status, payment_status)
      VALUES (v_pfx||'P10_SO',v_customer,v_wh,'confirmed','delivery',1000,1000,'undelivered','unpaid') RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,1000,1000,'product') RETURNING id INTO v_sol;
    PERFORM public.register_customer_payment(
      v_so, 400, v_method_cash, NULL, NULL, v_pfx||'P10A_REF', v_pfx||'P10A_IDEM');
    PERFORM public.recompute_sale_payment_status(v_so);
    SELECT payment_status::text, state::text INTO v_pay_status, v_state FROM sale_orders WHERE id=v_so;
    v_pass := v_pay_status='partial' AND v_state IN ('confirmed','sale');
    v_report := v_report || jsonb_build_object('id','P10a','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s', v_pay_status, v_state));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

    UPDATE sale_order_lines SET qty_delivered=quantity WHERE order_id=v_so;
    PERFORM public.so_apply_delivery_rollup(v_so);
    PERFORM public.register_customer_payment(
      v_so, 600, v_method_cash, NULL, NULL, v_pfx||'P10B_REF', v_pfx||'P10B_IDEM');
    PERFORM public.recompute_sale_payment_status(v_so);
    SELECT payment_status::text, state::text, operational_status::text
      INTO v_pay_status, v_state, v_op FROM sale_orders WHERE id=v_so;
    v_pass := v_pay_status='paid' AND v_state='done' AND v_op='completed';
    v_report := v_report || jsonb_build_object('id','P10b','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s op=%s', v_pay_status, v_state, v_op));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P10','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- ============ P11 — pré-pago ============
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total,
                            fulfillment_status, payment_status)
      VALUES (v_pfx||'P11_SO',v_customer,v_wh,'confirmed','delivery',300,300,'undelivered','unpaid') RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,300,300,'product') RETURNING id INTO v_sol;
    PERFORM public.register_customer_payment(
      v_so, 300, v_method_cash, NULL, NULL, v_pfx||'P11_REF', v_pfx||'P11_IDEM');
    PERFORM public.recompute_sale_payment_status(v_so);
    SELECT payment_status::text, state::text INTO v_pay_status, v_state FROM sale_orders WHERE id=v_so;
    v_pass := v_pay_status='paid' AND v_state IN ('confirmed','sale');
    v_report := v_report || jsonb_build_object('id','P11a','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s (pre-deliver)', v_pay_status, v_state));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

    UPDATE sale_order_lines SET qty_delivered=quantity WHERE order_id=v_so;
    PERFORM public.so_apply_delivery_rollup(v_so);
    SELECT payment_status::text, state::text, operational_status::text
      INTO v_pay_status, v_state, v_op FROM sale_orders WHERE id=v_so;
    v_pass := v_pay_status='paid' AND v_state='done' AND v_op='completed';
    v_report := v_report || jsonb_build_object('id','P11b','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('pay=%s state=%s op=%s', v_pay_status, v_state, v_op));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P11','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- ============ P12 — route cash summary / closure ============
  -- NOTA: hoje não existe RPC que ligue customer_payments → cash_movements.route_id.
  -- Inserimos depósitos PAY:* bound a route_id como fixture e exercitamos summary/close/idem/variance.
  BEGIN
    INSERT INTO delivery_routes(route_date, vehicle_id, zone_id, state, notes)
      VALUES (CURRENT_DATE+1,
              (SELECT id FROM vehicles WHERE active LIMIT 1),
              (SELECT id FROM delivery_zones WHERE active LIMIT 1),
              'in_progress', v_pfx||'route_a')
      RETURNING id INTO v_route;
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, route_id)
      VALUES (v_session, 'deposit', 200, 'PAY:CASH',  v_pfx||'r1', v_route),
             (v_session, 'deposit', 150, 'PAY:MBWAY', v_pfx||'r2', v_route),
             (v_session, 'deposit', 100, 'PAY:MB',    v_pfx||'r3', v_route);

    v_sum := public.delivery_route_cash_summary(v_route);
    v_pass := COALESCE((v_sum->>'ok')::boolean,false)
              AND (v_sum->>'expected_cash')::numeric = 200
              AND (v_sum->>'expected_mbway')::numeric = 150
              AND (v_sum->>'expected_multibanco')::numeric = 100
              AND (v_sum->>'total_expected')::numeric = 450;
    v_report := v_report || jsonb_build_object('id','P12a_summary','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', v_sum::text);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

    v_close := public.delivery_route_cash_close(v_route,
      jsonb_build_object('actual_cash',200,'actual_mbway',150,'actual_multibanco',100,'session_id',v_session::text),
      v_pfx||'close_zero');
    v_pass := COALESCE((v_close->>'ok')::boolean,false)
              AND COALESCE((v_close->>'variance')::numeric, -1) = 0;
    v_report := v_report || jsonb_build_object('id','P12b_close_zero','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', v_close::text);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

    v_close2 := public.delivery_route_cash_close(v_route,
      jsonb_build_object('actual_cash',200,'actual_mbway',150,'actual_multibanco',100,'session_id',v_session::text), NULL);
    v_pass := COALESCE((v_close2->>'ok')::boolean,false) AND (v_close2->>'noop') = 'already_closed';
    v_report := v_report || jsonb_build_object('id','P12c_idem','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', v_close2::text);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

    INSERT INTO delivery_routes(route_date, vehicle_id, zone_id, state, notes)
      VALUES (CURRENT_DATE+1,
              (SELECT id FROM vehicles WHERE active LIMIT 1),
              (SELECT id FROM delivery_zones WHERE active LIMIT 1),
              'in_progress', v_pfx||'route_b')
      RETURNING id INTO v_route2;
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, route_id)
      VALUES (v_session, 'deposit', 500, 'PAY:CASH', v_pfx||'rb1', v_route2);
    v_close := public.delivery_route_cash_close(v_route2,
      jsonb_build_object('actual_cash',480,'session_id',v_session::text), v_pfx||'var');
    v_var := COALESCE((v_close->>'variance')::numeric, 0);
    v_pass := COALESCE((v_close->>'ok')::boolean,false) AND v_var <> 0
              AND EXISTS (SELECT 1 FROM cash_movements
                          WHERE route_id=v_route2 AND reference='CASH_CLOSURE_VARIANCE');
    v_report := v_report || jsonb_build_object('id','P12d_variance','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,
      'observed', format('variance=%s', v_var));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','P12','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  IF _cleanup THEN
    PERFORM public._cleanup_phase17_payment_subcases();
    BEGIN PERFORM public._cleanup_golden_upm(); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object(
    'ok', v_fail = 0,
    'asserts_ok', v_ok,
    'asserts_fail', v_fail,
    'asserts_total', v_ok + v_fail,
    'report', v_report,
    'cleaned', _cleanup);
END $function$;
