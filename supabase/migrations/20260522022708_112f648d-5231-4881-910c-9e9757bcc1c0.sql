CREATE OR REPLACE FUNCTION public.cash_session_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  msg text;
  payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    payload := jsonb_build_object(
      'register_id', NEW.register_id,
      'route_id', NEW.route_id,
      'opening_balance', NEW.opening_balance,
      'opened_by', NEW.opened_by,
      'opened_at', NEW.opened_at
    );
    INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES ('cash_session', NEW.id, COALESCE(NEW.opened_by, auth.uid()), 'log',
            format('Sessão %s aberta (saldo inicial %s)', NEW.name, NEW.opening_balance), payload);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.route_id IS DISTINCT FROM OLD.route_id THEN
    INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES ('cash_session', NEW.id, auth.uid(), 'log',
      CASE WHEN NEW.route_id IS NULL
        THEN 'Vínculo de rota removido'
        ELSE format('Rota vinculada (%s)', NEW.route_id) END,
      jsonb_build_object('old_route', OLD.route_id, 'new_route', NEW.route_id));
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES ('cash_session', NEW.id, auth.uid(), 'log',
      format('Estado alterado: %s → %s', OLD.state, NEW.state),
      jsonb_build_object(
        'closed_by', NEW.closed_by,
        'closed_at', NEW.closed_at,
        'closing_theoretical', NEW.closing_balance_theoretical,
        'closing_counted', NEW.closing_balance_counted,
        'difference', NEW.difference
      ));
  END IF;

  IF NEW.handover_state IS DISTINCT FROM OLD.handover_state THEN
    msg := CASE NEW.handover_state
      WHEN 'pending_handover' THEN format('Caixa entregue para conferência (contado %s)', COALESCE(NEW.handover_cash_amount,0))
      WHEN 'reconciled' THEN 'Caixa conciliado pelo financeiro'
      ELSE format('Estado de entrega: %s', NEW.handover_state)
    END;
    INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES ('cash_session', NEW.id,
      COALESCE(CASE WHEN NEW.handover_state='reconciled' THEN NEW.reconciled_by ELSE NEW.handover_by END, auth.uid()),
      'log', msg,
      jsonb_build_object(
        'handover_at', NEW.handover_at,
        'handover_by', NEW.handover_by,
        'handover_cash_amount', NEW.handover_cash_amount,
        'reconciled_at', NEW.reconciled_at,
        'reconciled_by', NEW.reconciled_by,
        'reconciliation_notes', NEW.reconciliation_notes
      ));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_session_audit ON public.cash_sessions;
CREATE TRIGGER trg_cash_session_audit
AFTER INSERT OR UPDATE ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.cash_session_audit_trigger();

-- Audit cash_movements as well (insert + reversals)
CREATE OR REPLACE FUNCTION public.cash_movement_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES ('cash_session', NEW.session_id, COALESCE(NEW.created_by, auth.uid()), 'log',
      format('Movimento %s: %s (%s)', NEW.kind, NEW.amount, COALESCE(NEW.reference,'')),
      jsonb_build_object(
        'movement_id', NEW.id,
        'kind', NEW.kind,
        'amount', NEW.amount,
        'payment_id', NEW.payment_id,
        'picking_id', NEW.picking_id,
        'reversal_of_id', NEW.reversal_of_id
      ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_movement_audit ON public.cash_movements;
CREATE TRIGGER trg_cash_movement_audit
AFTER INSERT ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.cash_movement_audit_trigger();