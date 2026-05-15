
-- Phase 7: cash session immutability + helpers

CREATE OR REPLACE FUNCTION public.tg_cash_movements_session_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s_state text; target uuid;
BEGIN
  target := COALESCE(NEW.session_id, OLD.session_id);
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT state INTO s_state FROM public.cash_sessions WHERE id = target;
  IF s_state IS NULL THEN
    RAISE EXCEPTION 'Cash session % not found', target;
  END IF;
  IF s_state <> 'open' THEN
    RAISE EXCEPTION 'Cash session % is %, no movements allowed', target, s_state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_cash_movements_session_open_ins ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_session_open_ins
BEFORE INSERT ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_movements_session_open();

DROP TRIGGER IF EXISTS trg_cash_movements_session_open_upd ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_session_open_upd
BEFORE UPDATE ON public.cash_movements
FOR EACH ROW WHEN (NEW.reconciled_at IS NULL AND OLD.reconciled_at IS NULL)
EXECUTE FUNCTION public.tg_cash_movements_session_open();

DROP TRIGGER IF EXISTS trg_cash_movements_session_open_del ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_session_open_del
BEFORE DELETE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_movements_session_open();

-- Prevent reopening a closed session
CREATE OR REPLACE FUNCTION public.tg_cash_sessions_no_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'closed' AND NEW.state <> 'closed' THEN
    RAISE EXCEPTION 'Closed cash session % cannot be reopened', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cash_sessions_no_reopen ON public.cash_sessions;
CREATE TRIGGER trg_cash_sessions_no_reopen
BEFORE UPDATE OF state ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_sessions_no_reopen();

-- Helpers
CREATE OR REPLACE FUNCTION public.cash_session_balance(_session uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount),0) FROM public.cash_movements WHERE session_id = _session;
$$;

CREATE OR REPLACE FUNCTION public.cash_session_summary(_session uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'session_id', s.id,
    'state', s.state,
    'opening', COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind='opening'),0),
    'sales',   COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind='sale'),0),
    'refunds', COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind='refund'),0),
    'cash_in',  COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind='in'),0),
    'cash_out', COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind='out'),0),
    'other',   COALESCE(SUM(cm.amount) FILTER (WHERE cm.kind NOT IN ('opening','sale','refund','in','out')),0),
    'theoretical', COALESCE(SUM(cm.amount),0),
    'counted', s.closing_balance_counted,
    'difference', s.difference
  )
  FROM public.cash_sessions s
  LEFT JOIN public.cash_movements cm ON cm.session_id = s.id
  WHERE s.id = _session
  GROUP BY s.id, s.state, s.closing_balance_counted, s.difference;
$$;

-- =====================================================================
-- Self test
-- =====================================================================
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

  -- Insert in open session — OK
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

  -- Close session
  UPDATE public.cash_sessions SET state='closed', closing_balance_theoretical=40, closing_balance_counted=40, difference=0, closed_at=now()
   WHERE id=v_session;

  -- Insert into closed session — should fail
  BEGIN
    INSERT INTO public.cash_movements(session_id, kind, amount, reference, user_id, created_by)
         VALUES (v_session, 'sale', 99, 'PH7-X', v_user, v_user);
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_insert','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_insert','ok',true,'observed',SQLERRM);
  END;

  -- Update existing movement → should fail (when not reconciled)
  BEGIN
    UPDATE public.cash_movements SET notes='attempted' WHERE session_id=v_session AND reference='PH7-A';
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_update','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','closed_session_blocks_update','ok',true,'observed',SQLERRM);
  END;

  -- Try reopen — should fail
  BEGIN
    UPDATE public.cash_sessions SET state='open' WHERE id=v_session;
    asserts := asserts || jsonb_build_object('step','no_reopen','ok',false,'observed','no exception');
  EXCEPTION WHEN OTHERS THEN
    asserts := asserts || jsonb_build_object('step','no_reopen','ok',true,'observed',SQLERRM);
  END;

  -- Reconciliation update should still pass through (allowed)
  UPDATE public.cash_movements SET reconciled_at=now(), reconciled_by=v_user WHERE session_id=v_session AND reference='PH7-A';
  asserts := asserts || jsonb_build_object('step','reconciliation_allowed','ok',true,'observed','ok');

  RETURN jsonb_build_object('asserts', asserts);
END $$;
