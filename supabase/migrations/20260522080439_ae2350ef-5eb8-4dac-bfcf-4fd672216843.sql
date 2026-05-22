CREATE OR REPLACE FUNCTION public.tg_cash_movement_block_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_state text; v_session uuid;
BEGIN
  v_session := COALESCE(NEW.session_id, OLD.session_id);
  IF v_session IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Permitir updates que apenas marcam conciliação (reconciled_at / reconciled_by)
  IF TG_OP = 'UPDATE'
     AND NEW.session_id   IS NOT DISTINCT FROM OLD.session_id
     AND NEW.kind         IS NOT DISTINCT FROM OLD.kind
     AND NEW.amount       IS NOT DISTINCT FROM OLD.amount
     AND NEW.reference    IS NOT DISTINCT FROM OLD.reference
     AND NEW.partner_id   IS NOT DISTINCT FROM OLD.partner_id
     AND NEW.payment_id   IS NOT DISTINCT FROM OLD.payment_id
     AND NEW.route_id     IS NOT DISTINCT FROM OLD.route_id
     AND NEW.picking_id   IS NOT DISTINCT FROM OLD.picking_id
  THEN
    RETURN NEW;
  END IF;

  SELECT state INTO v_state FROM cash_sessions WHERE id = v_session;
  IF v_state = 'closed' THEN
    RAISE EXCEPTION 'A sessão de caixa está fechada — não é possível movimentar valores.'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;