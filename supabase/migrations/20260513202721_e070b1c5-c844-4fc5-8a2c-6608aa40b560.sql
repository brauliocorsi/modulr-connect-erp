
-- 1. Rastreabilidade nos cash_movements
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS picking_id uuid REFERENCES public.stock_pickings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cash_movements_route ON public.cash_movements(route_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_picking ON public.cash_movements(picking_id);

-- 2. Handover / reconcile nas cash_sessions
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handover_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS handover_by uuid,
  ADD COLUMN IF NOT EXISTS handover_cash_amount numeric,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_notes text;

DO $$ BEGIN
  ALTER TABLE public.cash_sessions
    ADD CONSTRAINT cash_sessions_handover_state_check
    CHECK (handover_state IN ('none','pending_handover','reconciled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_handover ON public.cash_sessions(handover_state)
  WHERE handover_state <> 'none';

-- 3. Service Requests (módulo Assistência)
CREATE TABLE IF NOT EXISTS public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  picking_id uuid REFERENCES public.stock_pickings(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
  reported_by uuid,
  assigned_to uuid,
  state text NOT NULL DEFAULT 'new'
    CHECK (state IN ('new','triaged','scheduled','in_progress','done','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  description text,
  resolution text,
  scheduled_for timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_requests_state ON public.service_requests(state);
CREATE INDEX IF NOT EXISTS idx_service_requests_partner ON public.service_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_assigned ON public.service_requests(assigned_to);

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sr_read ON public.service_requests;
CREATE POLICY sr_read ON public.service_requests FOR SELECT TO authenticated USING (
  has_group(auth.uid(),'system_admin')
  OR has_group(auth.uid(),'inventory_manager')
  OR has_group(auth.uid(),'inventory_user')
  OR has_group(auth.uid(),'sales_user')
  OR (has_group(auth.uid(),'delivery_driver') AND reported_by = auth.uid())
);

DROP POLICY IF EXISTS sr_insert ON public.service_requests;
CREATE POLICY sr_insert ON public.service_requests FOR INSERT TO authenticated WITH CHECK (
  has_group(auth.uid(),'system_admin')
  OR has_group(auth.uid(),'inventory_manager')
  OR has_group(auth.uid(),'inventory_user')
  OR has_group(auth.uid(),'delivery_driver')
);

DROP POLICY IF EXISTS sr_update ON public.service_requests;
CREATE POLICY sr_update ON public.service_requests FOR UPDATE TO authenticated USING (
  has_group(auth.uid(),'system_admin')
  OR has_group(auth.uid(),'inventory_manager')
  OR has_group(auth.uid(),'inventory_user')
);

DROP POLICY IF EXISTS sr_delete ON public.service_requests;
CREATE POLICY sr_delete ON public.service_requests FOR DELETE TO authenticated USING (
  has_group(auth.uid(),'system_admin')
);

CREATE TRIGGER tg_service_requests_updated
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.number_sequences(code, prefix, padding, next_number)
  VALUES ('service_request','SR/',5,1)
  ON CONFLICT (code) DO NOTHING;

-- 4. RPC: entregar com múltiplos métodos
CREATE OR REPLACE FUNCTION public.driver_deliver_picking_multi(
  _picking uuid,
  _payments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pk record; rt record; bt record;
  v_driver uuid; v_vehicle uuid; v_register uuid; v_session uuid; v_journal uuid;
  v_is_unassigned boolean := false;
  so_id uuid; total_open numeric; total_pay numeric := 0;
  pay record; pay_id uuid; pay_ids uuid[] := '{}';
  v_method record; v_method_name text;
  v_route_id uuid;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id=_picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;
  IF pk.kind <> 'outgoing' THEN RAISE EXCEPTION 'Apenas pickings de saída'; END IF;

  IF pk.route_id IS NOT NULL THEN
    SELECT * INTO rt FROM delivery_routes WHERE id = pk.route_id;
    v_driver := rt.driver_id; v_vehicle := rt.vehicle_id; v_route_id := rt.id;
  ELSIF pk.batch_id IS NOT NULL THEN
    SELECT * INTO bt FROM stock_picking_batches WHERE id = pk.batch_id;
    v_driver := bt.driver_id; v_vehicle := bt.vehicle_id;
  ELSE
    v_is_unassigned := true;
  END IF;

  IF NOT v_is_unassigned AND v_driver IS DISTINCT FROM auth.uid()
     AND NOT public.has_group(auth.uid(),'system_admin') THEN
    RAISE EXCEPTION 'Esta entrega não está atribuída ao motorista atual';
  END IF;

  -- Validar picking (auto-fill quantity_done)
  UPDATE stock_moves SET quantity_done = quantity
   WHERE picking_id = _picking AND coalesce(quantity_done,0) = 0 AND state NOT IN ('done','cancelled');
  PERFORM public.validate_picking(_picking);

  SELECT id, amount_total INTO so_id, total_open FROM sale_orders WHERE name = pk.origin;

  -- Recalcular saldo em aberto
  IF so_id IS NOT NULL THEN
    SELECT amount_total - COALESCE((SELECT SUM(amount) FROM customer_payments
      WHERE order_id = so_id AND state='posted'),0)
      INTO total_open FROM sale_orders WHERE id = so_id;
  END IF;

  -- Cash register / sessão (uma vez)
  IF v_vehicle IS NOT NULL THEN
    SELECT cash_register_id INTO v_register FROM vehicles WHERE id = v_vehicle;
  END IF;
  IF v_register IS NULL THEN
    SELECT id INTO v_register FROM cash_registers WHERE driver_id = auth.uid() AND active LIMIT 1;
  END IF;
  IF v_register IS NOT NULL THEN
    SELECT id INTO v_session FROM cash_sessions
      WHERE register_id = v_register AND state='open'
      ORDER BY opened_at DESC LIMIT 1;
    -- Marcar a sessão com a rota corrente, se ainda não tiver
    IF v_session IS NOT NULL AND v_route_id IS NOT NULL THEN
      UPDATE cash_sessions SET route_id = v_route_id WHERE id = v_session AND route_id IS NULL;
    END IF;
  END IF;

  -- Processar pagamentos
  IF _payments IS NOT NULL AND jsonb_array_length(_payments) > 0 THEN
    FOR pay IN SELECT * FROM jsonb_to_recordset(_payments) AS x(method_id uuid, amount numeric) LOOP
      IF pay.amount IS NULL OR pay.amount <= 0 THEN CONTINUE; END IF;
      total_pay := total_pay + pay.amount;
      IF so_id IS NULL THEN CONTINUE; END IF;

      SELECT * INTO v_method FROM payment_methods WHERE id = pay.method_id;
      v_method_name := COALESCE(v_method.name, 'Pagamento');
      v_journal := v_method.default_journal_id;

      INSERT INTO customer_payments(name, partner_id, order_id, payment_date, amount,
              method_id, journal_id, reference, state, created_by)
        VALUES (next_sequence('customer_payment'),
                pk.partner_id, so_id, current_date, pay.amount, pay.method_id, v_journal,
                'Entrega '||pk.name||' ('||v_method_name||')',
                'posted', auth.uid())
        RETURNING id INTO pay_id;
      pay_ids := pay_ids || pay_id;

      IF v_session IS NOT NULL THEN
        INSERT INTO cash_movements(session_id, kind, amount, reference, partner_id,
                user_id, payment_id, created_by, route_id, picking_id)
          VALUES (v_session, 'sale', pay.amount,
                  'Entrega '||pk.name||' ('||v_method_name||')',
                  pk.partner_id, auth.uid(), pay_id, auth.uid(), v_route_id, _picking);
      END IF;
    END LOOP;
  END IF;

  -- Validar soma vs. saldo
  IF total_open IS NOT NULL AND ABS(COALESCE(total_pay,0) - total_open) > 0.01 THEN
    RAISE EXCEPTION 'Soma dos pagamentos (% €) não bate com saldo em aberto (% €)',
      to_char(total_pay,'FM999G990D00'), to_char(total_open,'FM999G990D00');
  END IF;

  RETURN jsonb_build_object('picking',_picking,'payments',pay_ids,'sale_order',so_id,'total',total_pay);
END $$;

-- 5. RPC: entregador encerra/entrega o caixa
CREATE OR REPLACE FUNCTION public.driver_handover_session(
  _session uuid, _counted_cash numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM cash_sessions WHERE id=_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
  IF s.opened_by IS DISTINCT FROM auth.uid()
     AND NOT public.has_group(auth.uid(),'system_admin') THEN
    RAISE EXCEPTION 'Apenas o entregador da sessão pode encerrar';
  END IF;
  IF s.handover_state = 'reconciled' THEN
    RAISE EXCEPTION 'Sessão já conciliada';
  END IF;
  -- Fechar caixa se ainda aberto
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
END $$;

-- 6. RPC: financeiro concilia
CREATE OR REPLACE FUNCTION public.finance_reconcile_session(
  _session uuid, _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  IF NOT (public.has_group(auth.uid(),'finance_manager')
       OR public.has_group(auth.uid(),'finance_user')
       OR public.has_group(auth.uid(),'system_admin')) THEN
    RAISE EXCEPTION 'Sem permissão para conciliar';
  END IF;
  SELECT * INTO s FROM cash_sessions WHERE id=_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sessão não encontrada'; END IF;
  IF s.handover_state <> 'pending_handover' THEN
    RAISE EXCEPTION 'Sessão não está pendente de conferência';
  END IF;
  UPDATE cash_sessions
    SET handover_state='reconciled', reconciled_at=now(),
        reconciled_by=auth.uid(), reconciliation_notes=_notes
    WHERE id=_session;
  UPDATE cash_movements
    SET reconciled_at=now(), reconciled_by=auth.uid()
    WHERE session_id=_session AND reconciled_at IS NULL;
  PERFORM public.log_record_event('cash_session', _session,
    'Caixa conciliado pelo financeiro', jsonb_build_object('notes', _notes));
END $$;
