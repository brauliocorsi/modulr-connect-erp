
-- =========================================================
-- F24-B2: Store Cash + Delivery Mode Guardrails
-- =========================================================

-- 1) user_store_assignments
CREATE TABLE IF NOT EXISTS public.user_store_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS user_store_assignments_uid_store_uq
  ON public.user_store_assignments(user_id, store_id);

CREATE UNIQUE INDEX IF NOT EXISTS user_store_assignments_one_default_uq
  ON public.user_store_assignments(user_id)
  WHERE is_default = true AND active = true;

ALTER TABLE public.user_store_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usa_self_read ON public.user_store_assignments;
CREATE POLICY usa_self_read ON public.user_store_assignments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(),'finance','payments','view') OR public.has_permission(auth.uid(),'cashbox','registers','view'));

DROP POLICY IF EXISTS usa_admin_write ON public.user_store_assignments;
CREATE POLICY usa_admin_write ON public.user_store_assignments
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'finance','payments','edit') OR public.has_permission(auth.uid(),'cashbox','registers','edit') OR public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (public.has_permission(auth.uid(),'finance','payments','edit') OR public.has_permission(auth.uid(),'cashbox','registers','edit') OR public.has_group(auth.uid(),'system_admin'));

CREATE OR REPLACE FUNCTION public.tg_user_store_assignments_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS user_store_assignments_touch ON public.user_store_assignments;
CREATE TRIGGER user_store_assignments_touch
  BEFORE UPDATE ON public.user_store_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_store_assignments_touch();

-- 2) customer_payments columns
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES public.cash_sessions(id),
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id);

CREATE INDEX IF NOT EXISTS customer_payments_cash_session_idx
  ON public.customer_payments(cash_session_id) WHERE cash_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_payments_store_idx
  ON public.customer_payments(store_id) WHERE store_id IS NOT NULL;

-- 3) Helpers
CREATE OR REPLACE FUNCTION public.current_user_store_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(store_id), ARRAY[]::uuid[])
  FROM public.user_store_assignments
  WHERE user_id = auth.uid() AND active = true;
$$;

CREATE OR REPLACE FUNCTION public.current_user_default_store_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_cnt int;
BEGIN
  SELECT store_id INTO v_id FROM public.user_store_assignments
    WHERE user_id=auth.uid() AND active AND is_default=true LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT count(*) INTO v_cnt FROM public.user_store_assignments
    WHERE user_id=auth.uid() AND active;
  IF v_cnt = 1 THEN
    SELECT store_id INTO v_id FROM public.user_store_assignments
      WHERE user_id=auth.uid() AND active LIMIT 1;
    RETURN v_id;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_cash_session_for_user(
  _store_ids uuid[],
  _explicit_session uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_cnt int; v_ok boolean;
BEGIN
  IF _store_ids IS NULL OR array_length(_store_ids,1) IS NULL THEN
    RAISE EXCEPTION 'user_without_store';
  END IF;

  IF _explicit_session IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.cash_sessions s
      JOIN public.cash_registers r ON r.id = s.register_id
      WHERE s.id = _explicit_session
        AND s.state='open'
        AND r.store_id = ANY(_store_ids)
    ) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'cash_session_not_allowed'; END IF;
    RETURN _explicit_session;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.cash_sessions s
    JOIN public.cash_registers r ON r.id = s.register_id
   WHERE s.state='open' AND r.store_id = ANY(_store_ids);

  IF v_cnt = 0 THEN RAISE EXCEPTION 'no_open_cash_session_for_store'; END IF;
  IF v_cnt > 1 THEN RAISE EXCEPTION 'multiple_open_cash_sessions'; END IF;

  SELECT s.id INTO v_id
    FROM public.cash_sessions s
    JOIN public.cash_registers r ON r.id = s.register_id
   WHERE s.state='open' AND r.store_id = ANY(_store_ids)
   LIMIT 1;
  RETURN v_id;
END $$;

-- 4) cash_session_for_current_user (read-only RPC)
CREATE OR REPLACE FUNCTION public.cash_session_for_current_user(_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_store_ids uuid[]; v_sessions jsonb; v_cnt int; v_default uuid;
BEGIN
  v_store_ids := public.current_user_store_ids();
  IF _store_id IS NOT NULL THEN
    IF NOT (_store_id = ANY(v_store_ids)) THEN
      RETURN jsonb_build_object('status','no_store','sessions','[]'::jsonb);
    END IF;
    v_store_ids := ARRAY[_store_id];
  END IF;

  IF v_store_ids IS NULL OR array_length(v_store_ids,1) IS NULL THEN
    RETURN jsonb_build_object('status','no_store','sessions','[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', s.id,
    'register_id', r.id,
    'register_name', r.name,
    'store_id', r.store_id,
    'store_name', st.name,
    'opened_at', s.opened_at
  ) ORDER BY s.opened_at DESC), '[]'::jsonb), count(*)
  INTO v_sessions, v_cnt
  FROM public.cash_sessions s
  JOIN public.cash_registers r ON r.id = s.register_id
  LEFT JOIN public.stores st ON st.id = r.store_id
  WHERE s.state='open' AND r.store_id = ANY(v_store_ids);

  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('status','no_open_session','sessions','[]'::jsonb);
  ELSIF v_cnt = 1 THEN
    v_default := (v_sessions->0->>'session_id')::uuid;
    RETURN jsonb_build_object('status','ok','sessions',v_sessions,'default_session_id',v_default);
  ELSE
    RETURN jsonb_build_object('status','multiple_open_sessions','sessions',v_sessions);
  END IF;
END $$;

-- 5) Rewrite register_customer_payment with store-bound cash session
CREATE OR REPLACE FUNCTION public.register_customer_payment(
  _order uuid, _amount numeric, _method uuid, _journal uuid DEFAULT NULL,
  _schedule uuid DEFAULT NULL, _reference text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL, _payment_date date DEFAULT NULL,
  _notes text DEFAULT NULL, _cash_session_id uuid DEFAULT NULL
) RETURNS public.customer_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_partner uuid; v_existing public.customer_payments; v_new public.customer_payments;
  v_name text; v_mode text; v_state text; v_requires_ref boolean;
  v_feeds_cash boolean; v_store_ids uuid[]; v_session uuid; v_store uuid; v_register uuid;
  v_session_journal uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Valor inválido: %', _amount USING ERRCODE='check_violation'; END IF;
  IF _order IS NULL THEN RAISE EXCEPTION 'order_id obrigatório'; END IF;
  IF _method IS NULL THEN RAISE EXCEPTION 'method obrigatório'; END IF;

  PERFORM public.lock_order_payments(_order);

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.customer_payments
      WHERE order_id=_order AND idempotency_key=_idempotency_key LIMIT 1;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT confirmation_mode, requires_reference, COALESCE(feeds_cash_session,false)
    INTO v_mode, v_requires_ref, v_feeds_cash
    FROM public.payment_methods WHERE id=_method;

  IF COALESCE(v_requires_ref,false) AND (_reference IS NULL OR length(trim(_reference))=0) THEN
    RAISE EXCEPTION 'payment_method_requires_reference';
  END IF;

  IF v_feeds_cash THEN
    v_store_ids := public.current_user_store_ids();
    IF v_store_ids IS NULL OR array_length(v_store_ids,1) IS NULL THEN
      RAISE EXCEPTION 'user_without_store';
    END IF;
    v_session := public.resolve_cash_session_for_user(v_store_ids, _cash_session_id);
    SELECT r.id, r.store_id, r.journal_id
      INTO v_register, v_store, v_session_journal
      FROM public.cash_sessions s
      JOIN public.cash_registers r ON r.id = s.register_id
      WHERE s.id = v_session;
  END IF;

  v_state := CASE
    WHEN v_mode = 'pending_finance'  THEN 'pending'
    WHEN v_mode = 'pending_delivery' THEN 'pending_delivery'
    ELSE 'posted'
  END;

  SELECT partner_id INTO v_partner FROM public.sale_orders WHERE id=_order;
  v_name := 'PAY/'||to_char(now(),'YYYYMMDDHH24MISSMS')||'/'||replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.customer_payments
    (name, partner_id, order_id, schedule_id, payment_date, amount, method_id, journal_id,
     reference, notes, state, idempotency_key, created_by, cash_session_id, store_id)
  VALUES (v_name, v_partner, _order, _schedule, COALESCE(_payment_date, CURRENT_DATE),
          _amount, _method, COALESCE(_journal, v_session_journal),
          _reference, _notes, v_state, _idempotency_key, auth.uid(), v_session, v_store)
  RETURNING * INTO v_new;
  RETURN v_new;
END $function$;

-- 6) Trigger: prefer NEW.cash_session_id when present
CREATE OR REPLACE FUNCTION public.tg_payment_register_cash_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_user uuid; v_register uuid; v_session uuid; v_method record;
BEGIN
  IF NEW.state <> 'posted' OR COALESCE(NEW.amount,0) <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;
  v_user := COALESCE(NEW.created_by, auth.uid());
  SELECT * INTO v_method FROM public.payment_methods WHERE id = NEW.method_id;
  IF FOUND AND v_method.feeds_cash_session = false THEN RETURN NEW; END IF;

  v_session := NEW.cash_session_id;
  IF v_session IS NULL AND v_user IS NOT NULL THEN
    SELECT id INTO v_register FROM public.cash_registers WHERE user_id=v_user AND active ORDER BY created_at LIMIT 1;
    IF v_register IS NOT NULL THEN
      SELECT id INTO v_session FROM public.cash_sessions WHERE register_id=v_register AND state='open' ORDER BY opened_at DESC LIMIT 1;
    END IF;
  END IF;
  IF v_session IS NULL THEN RETURN NEW; END IF;

  PERFORM public.lock_cash_session(v_session);
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id = NEW.id) THEN RETURN NEW; END IF;

  INSERT INTO public.cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by, notes)
  VALUES (v_session,'sale',NEW.amount,COALESCE(NEW.reference,NEW.name),NEW.partner_id,v_user,NEW.id,v_user,'Auto: pagamento '||NEW.name);
  RETURN NEW;
END $function$;

-- 7) sale_order_set_delivery_mode with guardrails
CREATE OR REPLACE FUNCTION public.sale_order_set_delivery_mode(_order_id uuid, _delivery_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_state text; v_old text; v_active_schedules int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _delivery_mode NOT IN ('delivery','pickup','direct') THEN RAISE EXCEPTION 'invalid_delivery_mode:%', _delivery_mode; END IF;
  SELECT state, delivery_mode INTO v_state, v_old FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  IF _delivery_mode = 'pickup' THEN
    SELECT count(*) INTO v_active_schedules
      FROM public.delivery_schedules
     WHERE sale_order_id = _order_id
       AND status NOT IN ('delivered','failed')
       AND cancelled_at IS NULL;
    IF v_active_schedules > 0 THEN RAISE EXCEPTION 'pickup_with_active_delivery_schedule'; END IF;

    UPDATE public.sale_orders
      SET delivery_mode='pickup', include_delivery=false, include_assembly=false
      WHERE id=_order_id;
  ELSIF _delivery_mode = 'delivery' THEN
    UPDATE public.sale_orders
      SET delivery_mode='delivery', include_delivery=true
      WHERE id=_order_id;
  ELSE
    UPDATE public.sale_orders SET delivery_mode=_delivery_mode WHERE id=_order_id;
  END IF;

  IF v_old IS DISTINCT FROM _delivery_mode THEN
    PERFORM activity_log_event(
      'sale_order', _order_id, 'sale_order_delivery_mode_updated',
      'Modo de entrega: '||_delivery_mode,
      jsonb_build_object('from', v_old, 'to', _delivery_mode),
      'internal'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'order_id', _order_id, 'delivery_mode', _delivery_mode);
END $function$;

-- 8) sale_order_set_services with pickup guardrail
CREATE OR REPLACE FUNCTION public.sale_order_set_services(_order_id uuid, _include_assembly boolean, _include_delivery boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_state text; v_mode text;
  v_changed text[] := ARRAY[]::text[]; v_old_a boolean; v_old_d boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT state, delivery_mode, include_assembly, include_delivery
    INTO v_state, v_mode, v_old_a, v_old_d
    FROM sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale_order_not_found'; END IF;
  IF v_state = 'cancelled' THEN RAISE EXCEPTION 'sale_order_cancelled'; END IF;

  IF v_mode = 'pickup' THEN
    IF COALESCE(_include_delivery,false) = true THEN RAISE EXCEPTION 'pickup_cannot_include_delivery'; END IF;
    IF COALESCE(_include_assembly,false) = true THEN RAISE EXCEPTION 'pickup_cannot_include_assembly'; END IF;
  END IF;

  UPDATE sale_orders
     SET include_assembly = COALESCE(_include_assembly, include_assembly),
         include_delivery = COALESCE(_include_delivery, include_delivery)
   WHERE id = _order_id;

  IF v_old_a IS DISTINCT FROM _include_assembly THEN v_changed := v_changed || 'include_assembly'; END IF;
  IF v_old_d IS DISTINCT FROM _include_delivery THEN v_changed := v_changed || 'include_delivery'; END IF;

  IF array_length(v_changed, 1) > 0 THEN
    PERFORM activity_log_event(
      'sale_order', _order_id, 'sale_order_services_updated',
      'Serviços atualizados',
      jsonb_build_object('include_assembly', _include_assembly, 'include_delivery', _include_delivery),
      'internal'
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'order_id', _order_id, 'changed_fields', to_jsonb(v_changed));
END $function$;

-- 9) View sale_orders_with_schedule_summary
CREATE OR REPLACE VIEW public.sale_orders_with_schedule_summary AS
SELECT
  so.id AS sale_order_id,
  so.name,
  so.partner_id,
  so.state,
  so.fulfillment_status,
  so.payment_status,
  so.invoice_status,
  so.operational_status,
  so.commitment_date,
  so.amount_total,
  so.date_order,
  so.store_id,
  so.delivery_mode,
  so.include_delivery,
  so.include_assembly,
  so.delivery_zone_label,
  ds.id AS schedule_id,
  ds.scheduled_date,
  ds.slot_start,
  ds.slot_end,
  ds.status AS schedule_status,
  (ds.id IS NOT NULL AND ds.status NOT IN ('requested') AND ds.cancelled_at IS NULL) AS schedule_confirmed,
  ds.route_id,
  dr.route_date AS route_date,
  dr.route_type AS route_type
FROM public.sale_orders so
LEFT JOIN LATERAL (
  SELECT * FROM public.delivery_schedules d
  WHERE d.sale_order_id = so.id AND d.cancelled_at IS NULL
  ORDER BY d.scheduled_date DESC NULLS LAST, d.created_at DESC
  LIMIT 1
) ds ON true
LEFT JOIN public.delivery_routes dr ON dr.id = ds.route_id;

GRANT SELECT ON public.sale_orders_with_schedule_summary TO authenticated;

-- 10) Test function
CREATE OR REPLACE FUNCTION public._test_phase24b2_store_cash_delivery_guardrails()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_results jsonb := '[]'::jsonb; v_count int; v_ok boolean;
BEGIN
  -- A1: tabela existe
  SELECT count(*) INTO v_count FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_store_assignments';
  v_results := v_results || jsonb_build_object('check','user_store_assignments_exists','pass', v_count=1);

  -- A2: customer_payments tem cash_session_id
  SELECT count(*) INTO v_count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customer_payments' AND column_name='cash_session_id';
  v_results := v_results || jsonb_build_object('check','customer_payments_cash_session_id','pass', v_count=1);

  -- A3: helpers existem
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('current_user_store_ids','current_user_default_store_id','resolve_cash_session_for_user','cash_session_for_current_user');
  v_results := v_results || jsonb_build_object('check','helpers_exist','pass', v_count=4);

  -- A4: RPC register_customer_payment tem _cash_session_id
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='register_customer_payment'
      AND pg_get_function_arguments(p.oid) LIKE '%_cash_session_id%';
  v_results := v_results || jsonb_build_object('check','register_customer_payment_has_session_param','pass', v_count=1);

  -- A5: resolve_cash_session_for_user erra com array vazio
  BEGIN
    PERFORM public.resolve_cash_session_for_user(NULL, NULL);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := (SQLERRM='user_without_store');
  END;
  v_results := v_results || jsonb_build_object('check','resolve_empty_raises_user_without_store','pass', v_ok);

  -- A6: pickup invariants — sale_order_set_delivery_mode rejeita pickup com schedule ativa
  -- (smoke: função existe e definição contém 'pickup_with_active_delivery_schedule')
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='sale_order_set_delivery_mode'
      AND pg_get_functiondef(p.oid) LIKE '%pickup_with_active_delivery_schedule%';
  v_results := v_results || jsonb_build_object('check','pickup_schedule_guard_present','pass', v_count=1);

  -- A7: set_services bloqueia delivery=true em pickup
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='sale_order_set_services'
      AND pg_get_functiondef(p.oid) LIKE '%pickup_cannot_include_delivery%';
  v_results := v_results || jsonb_build_object('check','services_pickup_guard_present','pass', v_count=1);

  -- A8: view existe
  SELECT count(*) INTO v_count FROM information_schema.views
    WHERE table_schema='public' AND table_name='sale_orders_with_schedule_summary';
  v_results := v_results || jsonb_build_object('check','schedule_summary_view_exists','pass', v_count=1);

  -- A9: trigger feeds_cash_session=false ainda respeitado
  SELECT count(*) INTO v_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='tg_payment_register_cash_movement'
      AND pg_get_functiondef(p.oid) LIKE '%feeds_cash_session = false%';
  v_results := v_results || jsonb_build_object('check','trigger_respects_feeds_cash','pass', v_count=1);

  RETURN jsonb_build_object(
    'phase','F24-B2',
    'results', v_results,
    'all_pass', NOT (v_results @> '[{"pass": false}]'::jsonb)
  );
END $function$;
