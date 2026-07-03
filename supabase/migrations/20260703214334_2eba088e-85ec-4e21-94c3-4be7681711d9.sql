
CREATE OR REPLACE FUNCTION public._mfg_assert_sequence_ok(_op uuid, _override_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  op record; v_pending text;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada' USING ERRCODE='P0002'; END IF;

  SELECT string_agg(format('#%s %s (state=%s)', sequence, COALESCE(name,'—'), state), ', ' ORDER BY sequence)
    INTO v_pending
    FROM public.mo_operations
   WHERE mo_id = op.mo_id
     AND sequence < op.sequence
     AND state IN ('pending','ready','in_progress','paused','blocked')
     AND COALESCE(is_qc,false) = false;

  IF v_pending IS NULL THEN RETURN; END IF;

  IF _override_reason IS NULL OR btrim(_override_reason) = '' THEN
    RAISE EXCEPTION 'PREVIOUS_OPERATIONS_PENDING: %', v_pending USING ERRCODE='P0001';
  END IF;

  BEGIN
    INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, notes)
    VALUES (_op, op.mo_id, auth.uid(), now(),
            format('override sequência: %s — operações pendentes: %s', _override_reason, v_pending));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    PERFORM public.log_record_event(
      'manufacturing_orders'::text, op.mo_id, 'mfg.sequence_override'::text,
      format('início fora de sequência (op #%s): %s — pendentes: %s', op.sequence, _override_reason, v_pending)::text,
      jsonb_build_object('op_id', _op, 'reason', _override_reason, 'pending', v_pending)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $function$;
