CREATE OR REPLACE FUNCTION public.driver_reopen_session(_session uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; r record;
BEGIN
  SELECT * INTO s FROM cash_sessions WHERE id=_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
  SELECT * INTO r FROM cash_registers WHERE id = s.register_id;
  IF r.driver_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_group(auth.uid(),'system_admin') THEN
    RAISE EXCEPTION 'Apenas o entregador vinculado pode reabrir';
  END IF;
  IF s.handover_state <> 'pending_handover' THEN
    RAISE EXCEPTION 'Sessão não está pendente';
  END IF;
  IF COALESCE(s.reconciliation_notes,'') !~* 'devolv' THEN
    RAISE EXCEPTION 'A sessão ainda não foi devolvida pelo financeiro';
  END IF;
  UPDATE cash_sessions
    SET state='open',
        handover_state='none',
        handover_at=NULL,
        handover_by=NULL,
        closed_at=NULL,
        closed_by=NULL,
        closing_balance_theoretical=NULL,
        closing_balance_counted=NULL,
        difference=NULL
    WHERE id=_session;
  PERFORM public.log_record_event('cash_session', _session,
    'Sessão reaberta pelo entregador após devolução do financeiro', '{}'::jsonb);
END;
$$;