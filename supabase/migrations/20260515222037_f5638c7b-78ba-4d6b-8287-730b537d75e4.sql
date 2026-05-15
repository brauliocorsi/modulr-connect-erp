
DROP TRIGGER IF EXISTS trg_cash_movements_session_open_ins ON public.cash_movements;
DROP TRIGGER IF EXISTS trg_cash_movements_session_open_upd ON public.cash_movements;
DROP TRIGGER IF EXISTS trg_cash_movements_session_open_del ON public.cash_movements;
DROP FUNCTION IF EXISTS public.tg_cash_movements_session_open();

CREATE OR REPLACE FUNCTION public._test_phase7()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asserts jsonb := '[]'::jsonb;
  v_user uuid; v_register uuid; v_session uuid;
  bal numeric; summary jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('asserts', jsonb_build_array(jsonb_build_object('step','setup','ok',false,'observed','no user')));
  END IF;

  INSERT INTO public.cash_registers(name, user_id, active)
       VALUES ('PH7-REG-'||substr(gen_random_uuid()::text,1,8), v_user, true)
    RETURNING id INTO v_register;
  INSERT INTO public.cash_sessions(name, register_id, opened_by, opened_at, state, opening_balance)
       VALUES ('PH7-SESS-'||substr(gen_random_uuid()::text,1,8), v_register, v_user, now(), 'open', 0)
    RETURNING id INTO v_session;

  INSERT INTO public.cash_movements(session_id, kind, amount, reference, user_id, created_by)
       VALUES (v_session, 'sale', 50, 'PH7-A', v_user, v_user);
  INSERT INTO public.cash_movements(session_id, kind, amount, reference, user_id, created_by)
       VALUES (v_session, 'refund', -10, 'PH7-B', v_user, v_user);

  bal := public.cash_session_balance(v_session);
  asserts := asserts || jsonb_build_object('step','live_balance','ok',bal=40,'observed',jsonb_build_object('balance',bal));

  summary := public.cash_session_summary(v_session);
  asserts := asserts || jsonb_build_object('step','summary_open',
    'ok', (summary->>'sales')::numeric=50 AND (summary->>'refunds')::numeric=-10 AND (summary->>'theoretical')::numeric=40,
    'observed', summary);

  UPDATE public.cash_sessions SET state='closed', closing_balance_theoretical=40, closing_balance_counted=40, difference=0, closed_at=now()
   WHERE id=v_session;

  BEGIN
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, user_id, created_by)
         VALUES (v_session, 'sale', 99, 'PH7-X', v_user, v_user);
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_insert','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_insert','ok',true,'observed',SQLERRM);
  END;

  BEGIN
    UPDATE public.cash_movements SET notes='attempted' WHERE session_id=v_session AND reference='PH7-A';
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_update','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_update','ok',true,'observed',SQLERRM);
  END;

  BEGIN
    DELETE FROM public.cash_movements WHERE session_id=v_session AND reference='PH7-B';
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_delete','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_delete','ok',true,'observed',SQLERRM);
  END;

  BEGIN
    UPDATE public.cash_sessions SET state='open' WHERE id=v_session;
    asserts := asserts || jsonb_build_object('step','no_reopen','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','no_reopen','ok',true,'observed',SQLERRM);
  END;

  RETURN jsonb_build_object('asserts', asserts);
END $$;
