CREATE OR REPLACE FUNCTION public.cash_movement_create(
  _session_id uuid,
  _kind text,
  _amount numeric,
  _reference text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_state text;
  v_uid uuid := auth.uid();
  v_id uuid;
  v_sign int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error','unauthenticated');
  END IF;
  IF _kind NOT IN ('withdrawal','expense','bonus','advance','sangria','deposit') THEN
    RETURN jsonb_build_object('error','invalid_kind');
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('error','invalid_amount');
  END IF;

  SELECT state INTO v_state FROM cash_sessions WHERE id=_session_id;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('error','session_not_found');
  END IF;
  IF v_state <> 'open' THEN
    RETURN jsonb_build_object('error','session_not_open','state',v_state);
  END IF;

  v_sign := CASE WHEN _kind='deposit' THEN 1 ELSE -1 END;

  INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id)
  VALUES (_session_id, _kind, v_sign * abs(_amount), _reference, _notes, v_uid, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok',true,'id',v_id);
END$$;

GRANT EXECUTE ON FUNCTION public.cash_movement_create(uuid,text,numeric,text,text) TO authenticated;