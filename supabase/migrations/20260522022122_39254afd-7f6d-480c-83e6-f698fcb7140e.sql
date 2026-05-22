CREATE OR REPLACE FUNCTION public.driver_handover_session(_session uuid, _counted_cash numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; r record;
BEGIN
  SELECT * INTO s FROM cash_sessions WHERE id=_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
  SELECT * INTO r FROM cash_registers WHERE id = s.register_id;
  IF r.driver_id IS DISTINCT FROM auth.uid()
     AND s.opened_by IS DISTINCT FROM auth.uid()
     AND NOT public.has_group(auth.uid(),'system_admin')
     AND NOT public.has_group(auth.uid(),'finance_manager') THEN
    RAISE EXCEPTION 'Apenas o entregador vinculado ao caixa pode encerrar';
  END IF;
  IF s.handover_state = 'reconciled' THEN
    RAISE EXCEPTION 'Sessão já conciliada';
  END IF;
  IF s.state = 'open' THEN
    PERFORM public.close_cash_session(_session, COALESCE(_counted_cash,0));
  END IF;
  UPDATE cash_sessions
    SET handover_state='pending_handover',
        handover_at=now(),
        handover_by=auth.uid(),
        handover_cash_amount=COALESCE(_counted_cash, closing_balance_counted, 0)
    WHERE id=_session;
  PERFORM public.log_record_event('cash_session', _session,
    'Caixa entregue para conferência financeira', '{}'::jsonb);
END $function$;