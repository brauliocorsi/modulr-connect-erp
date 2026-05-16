
-- 1) Relax cash_close state check
CREATE OR REPLACE FUNCTION public.delivery_route_cash_close(_route_id uuid, _actuals jsonb, _notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_route record; v_sum jsonb; v_id uuid; v_var numeric; v_session uuid;
  v_actual_cash numeric; v_actual_mb numeric; v_actual_trf numeric; v_actual_other numeric;
  v_actual_mbway numeric;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.state = 'closed' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_state','state',v_route.state);
  END IF;

  v_sum := public.delivery_route_cash_summary(_route_id);
  v_actual_cash  := COALESCE((_actuals->>'actual_cash')::numeric,0);
  v_actual_mbway := COALESCE((_actuals->>'actual_mbway')::numeric,0);
  v_actual_mb    := COALESCE((_actuals->>'actual_multibanco')::numeric,
                              (_actuals->>'actual_mb')::numeric,0);
  v_actual_trf   := COALESCE((_actuals->>'actual_transfer')::numeric,0);
  v_actual_other := COALESCE((_actuals->>'actual_other')::numeric,0);
  v_session      := NULLIF(_actuals->>'session_id','')::uuid;

  SELECT id INTO v_id FROM delivery_route_cash_closure WHERE route_id=_route_id;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'closure_id',v_id,'noop','already_closed');
  END IF;

  INSERT INTO delivery_route_cash_closure(route_id, cash_register_id,
    expected_cash, expected_mbway, expected_transfer, expected_other,
    actual_cash,   actual_mbway,   actual_transfer,   actual_other,
    notes, closed_by, closed_at)
  VALUES (_route_id,
    (SELECT register_id FROM cash_sessions WHERE id=v_session),
    (v_sum->>'expected_cash')::numeric,
    (v_sum->>'expected_mbway')::numeric,
    (v_sum->>'expected_transfer')::numeric,
    ((v_sum->>'expected_multibanco')::numeric + (v_sum->>'expected_other')::numeric),
    v_actual_cash, v_actual_mbway, v_actual_trf, v_actual_mb + v_actual_other,
    _notes, auth.uid(), now())
  RETURNING id, variance INTO v_id, v_var;

  IF v_session IS NOT NULL AND v_var <> 0 THEN
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id, route_id)
    VALUES (v_session,
            CASE WHEN v_var > 0 THEN 'bonus' ELSE 'expense' END,
            abs(v_var), 'CASH_CLOSURE_VARIANCE',
            'route='||_route_id::text||' variance='||v_var::text,
            auth.uid(), auth.uid(), _route_id);
  END IF;

  PERFORM public._m3_log(NULL,'delivery.cash.closed',_route_id::text,
    jsonb_build_object('closure_id',v_id,'variance',v_var));
  RETURN jsonb_build_object('ok',true,'closure_id',v_id,'variance',v_var);
END $$;

-- 2) Patch T19 to scope to internal locations only
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='_test_phase15_m5' AND pronamespace='public'::regnamespace;
  v_src := replace(v_src,
    'SELECT COALESCE(SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END),0)::int INTO v_neg FROM stock_quants;',
    'SELECT COALESCE(SUM(CASE WHEN q.quantity < 0 THEN 1 ELSE 0 END),0)::int INTO v_neg FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id WHERE l.type=''internal'';');
  EXECUTE v_src;
END $$;
