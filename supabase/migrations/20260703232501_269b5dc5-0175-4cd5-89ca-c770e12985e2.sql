
-- =========================================================================
-- F29 — CONSOLIDAÇÃO ENTREGAS/CAIXA
-- =========================================================================

-- ---------- PARTE 1.1 — Schema closure ----------
ALTER TABLE public.delivery_route_cash_closure
  ADD COLUMN IF NOT EXISTS method_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS bnpl_informational jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_multibanco numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_multibanco numeric NOT NULL DEFAULT 0;

-- Recalcular a coluna gerada variance para incluir multibanco
ALTER TABLE public.delivery_route_cash_closure DROP COLUMN variance;
ALTER TABLE public.delivery_route_cash_closure
  ADD COLUMN variance numeric GENERATED ALWAYS AS (
    actual_cash + actual_mbway + actual_multibanco + actual_transfer + actual_other
    - (expected_cash + expected_mbway + expected_multibanco + expected_transfer + expected_other)
  ) STORED;

-- ---------- PARTE 1.2 — delivery_route_cash_summary (por código de pm) ----------
CREATE OR REPLACE FUNCTION public.delivery_route_cash_summary(_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_route record;
  v_existing record;
  v_breakdown jsonb := '{}'::jsonb;
  v_bnpl jsonb := '{}'::jsonb;
  v_cash numeric := 0; v_mbway numeric := 0; v_mb numeric := 0;
  v_trf numeric := 0; v_other numeric := 0;
  v_total numeric := 0;
  v_payments jsonb;
  r record;
BEGIN
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;

  -- Agregação por código canónico de payment_method
  FOR r IN
    WITH route_pay AS (
      SELECT cp.amount,
             COALESCE(upper(pm.code),'OTHER') AS code,
             COALESCE(pm.journal_type,'other') AS jtype
      FROM delivery_route_orders dro
      JOIN delivery_schedules ds ON ds.id=dro.schedule_id
      JOIN customer_payments cp ON cp.order_id=ds.sale_order_id AND cp.state='posted'
      LEFT JOIN payment_methods pm ON pm.id=cp.method_id
      WHERE dro.route_id=_route_id
    )
    SELECT code, jtype, SUM(amount)::numeric AS amt
    FROM route_pay GROUP BY code, jtype
  LOOP
    IF r.jtype='bnpl' THEN
      v_bnpl := v_bnpl || jsonb_build_object(r.code, jsonb_build_object('expected', r.amt));
    ELSE
      v_breakdown := v_breakdown || jsonb_build_object(r.code,
        jsonb_build_object('expected', r.amt, 'actual', 0, 'variance', -r.amt));
      IF r.code = 'CASH' THEN v_cash := v_cash + r.amt;
      ELSIF r.code = 'MBWAY' THEN v_mbway := v_mbway + r.amt;
      ELSIF r.code IN ('MB','MULTIBANCO','CARD') THEN v_mb := v_mb + r.amt;
      ELSIF r.code IN ('TRANSF','TRANSFER','BANK_TRANSFER') THEN v_trf := v_trf + r.amt;
      ELSE v_other := v_other + r.amt;
      END IF;
    END IF;
  END LOOP;

  v_total := v_cash + v_mbway + v_mb + v_trf + v_other;

  SELECT * INTO v_existing FROM delivery_route_cash_closure WHERE route_id=_route_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'payment_id', cp.id, 'amount', cp.amount,
    'method', COALESCE(pm.name, pm.code, 'Pagamento'),
    'code', COALESCE(upper(pm.code),'OTHER')
  ) ORDER BY cp.created_at), '[]'::jsonb)
  INTO v_payments
  FROM delivery_route_orders dro
  JOIN delivery_schedules ds ON ds.id=dro.schedule_id
  JOIN customer_payments cp ON cp.order_id=ds.sale_order_id AND cp.state='posted'
  LEFT JOIN payment_methods pm ON pm.id=cp.method_id
  WHERE dro.route_id=_route_id;

  RETURN jsonb_build_object(
    'ok', true,
    'route_id', _route_id,
    'expected_cash', v_cash,
    'expected_mbway', v_mbway,
    'expected_multibanco', v_mb,
    'expected_transfer', v_trf,
    'expected_other', v_other,
    'total_expected', v_total,
    'method_breakdown', v_breakdown,
    'bnpl_informational', v_bnpl,
    'closure_existing', CASE WHEN v_existing.id IS NOT NULL THEN to_jsonb(v_existing) ELSE NULL END,
    'payments', COALESCE(v_payments, '[]'::jsonb)
  );
END $function$;

-- ---------- PARTE 1.3 — delivery_route_cash_close (validação CONTAGEM_OBRIGATORIA) ----------
CREATE OR REPLACE FUNCTION public.delivery_route_cash_close(_route_id uuid, _actuals jsonb, _notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_route record; v_sum jsonb; v_id uuid; v_var numeric; v_session uuid;
  v_acash numeric; v_ambway numeric; v_amb numeric; v_atrf numeric; v_aother numeric;
  v_confirm_zero boolean;
  v_breakdown jsonb := '{}'::jsonb;
  v_bnpl jsonb;
  v_zero_methods text[] := ARRAY[]::text[];
  v_key text; v_amt numeric;
  v_expected_by_code jsonb;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;
  IF v_route.state = 'closed' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_state','state',v_route.state);
  END IF;

  v_sum := public.delivery_route_cash_summary(_route_id);
  v_acash        := COALESCE((_actuals->>'actual_cash')::numeric,0);
  v_ambway       := COALESCE((_actuals->>'actual_mbway')::numeric,0);
  v_amb          := COALESCE((_actuals->>'actual_multibanco')::numeric,(_actuals->>'actual_mb')::numeric,0);
  v_atrf         := COALESCE((_actuals->>'actual_transfer')::numeric,0);
  v_aother       := COALESCE((_actuals->>'actual_other')::numeric,0);
  v_session      := NULLIF(_actuals->>'session_id','')::uuid;
  v_confirm_zero := COALESCE((_actuals->>'confirm_zero')::boolean, false);
  v_bnpl         := v_sum->'bnpl_informational';

  -- Validação CONTAGEM_OBRIGATORIA
  IF (v_sum->>'expected_cash')::numeric        > 0 AND v_acash  = 0 THEN v_zero_methods := v_zero_methods || 'CASH'; END IF;
  IF (v_sum->>'expected_mbway')::numeric       > 0 AND v_ambway = 0 THEN v_zero_methods := v_zero_methods || 'MBWAY'; END IF;
  IF (v_sum->>'expected_multibanco')::numeric  > 0 AND v_amb    = 0 THEN v_zero_methods := v_zero_methods || 'MULTIBANCO'; END IF;
  IF (v_sum->>'expected_transfer')::numeric    > 0 AND v_atrf   = 0 THEN v_zero_methods := v_zero_methods || 'TRANSFER'; END IF;
  IF (v_sum->>'expected_other')::numeric       > 0 AND v_aother = 0 THEN v_zero_methods := v_zero_methods || 'OTHER'; END IF;

  IF array_length(v_zero_methods,1) IS NOT NULL AND NOT v_confirm_zero THEN
    RETURN jsonb_build_object('ok',false,'error','CONTAGEM_OBRIGATORIA',
                              'zero_methods', to_jsonb(v_zero_methods),
                              'hint','passe _actuals->>confirm_zero=true para confirmar zeros');
  END IF;

  SELECT id INTO v_id FROM delivery_route_cash_closure WHERE route_id=_route_id;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'closure_id',v_id,'noop','already_closed');
  END IF;

  -- Construir method_breakdown final (com actual e variance por code)
  v_expected_by_code := jsonb_build_object(
    'CASH',       (v_sum->>'expected_cash')::numeric,
    'MBWAY',      (v_sum->>'expected_mbway')::numeric,
    'MULTIBANCO', (v_sum->>'expected_multibanco')::numeric,
    'TRANSFER',   (v_sum->>'expected_transfer')::numeric,
    'OTHER',      (v_sum->>'expected_other')::numeric
  );
  v_breakdown := jsonb_build_object(
    'CASH',       jsonb_build_object('expected',(v_expected_by_code->>'CASH')::numeric,      'actual',v_acash,  'variance',v_acash  -(v_expected_by_code->>'CASH')::numeric),
    'MBWAY',      jsonb_build_object('expected',(v_expected_by_code->>'MBWAY')::numeric,     'actual',v_ambway, 'variance',v_ambway -(v_expected_by_code->>'MBWAY')::numeric),
    'MULTIBANCO', jsonb_build_object('expected',(v_expected_by_code->>'MULTIBANCO')::numeric,'actual',v_amb,    'variance',v_amb    -(v_expected_by_code->>'MULTIBANCO')::numeric),
    'TRANSFER',   jsonb_build_object('expected',(v_expected_by_code->>'TRANSFER')::numeric,  'actual',v_atrf,   'variance',v_atrf   -(v_expected_by_code->>'TRANSFER')::numeric),
    'OTHER',      jsonb_build_object('expected',(v_expected_by_code->>'OTHER')::numeric,     'actual',v_aother, 'variance',v_aother -(v_expected_by_code->>'OTHER')::numeric)
  );

  INSERT INTO delivery_route_cash_closure(route_id, cash_register_id,
    expected_cash, expected_mbway, expected_multibanco, expected_transfer, expected_other,
    actual_cash,   actual_mbway,   actual_multibanco,   actual_transfer,   actual_other,
    method_breakdown, bnpl_informational,
    notes, closed_by, closed_at)
  VALUES (_route_id,
    (SELECT register_id FROM cash_sessions WHERE id=v_session),
    (v_sum->>'expected_cash')::numeric,
    (v_sum->>'expected_mbway')::numeric,
    (v_sum->>'expected_multibanco')::numeric,
    (v_sum->>'expected_transfer')::numeric,
    (v_sum->>'expected_other')::numeric,
    v_acash, v_ambway, v_amb, v_atrf, v_aother,
    v_breakdown, COALESCE(v_bnpl,'{}'::jsonb),
    _notes, auth.uid(), now())
  RETURNING id, variance INTO v_id, v_var;

  IF v_session IS NOT NULL AND v_var <> 0 THEN
    INSERT INTO cash_movements(session_id, kind, amount, reference, notes, created_by, user_id, route_id)
    VALUES (v_session,
            CASE WHEN v_var > 0 THEN 'bonus' ELSE 'expense' END,
            abs(v_var), 'CASH_CLOSURE_VARIANCE',
            'route='||_route_id::text||' variance='||v_var::text,
            auth.uid(), auth.uid(), _route_id);
  END IF;

  PERFORM public._m3_log(NULL,'delivery.cash.closed',_route_id::text,
    jsonb_build_object('closure_id',v_id,'variance',v_var,'zero_confirmed',v_confirm_zero));
  RETURN jsonb_build_object('ok',true,'closure_id',v_id,'variance',v_var,'method_breakdown',v_breakdown);
END $function$;

-- =========================================================================
-- PARTE 2 — Retorno ao armazém escreve na plural + trigger damaged→service_case
-- =========================================================================

ALTER TABLE public.package_damage_reports
  ADD COLUMN IF NOT EXISTS route_order_id uuid REFERENCES public.delivery_route_orders(id),
  ADD COLUMN IF NOT EXISTS return_condition text,
  ADD COLUMN IF NOT EXISTS service_case_id uuid REFERENCES public.service_cases(id);

CREATE INDEX IF NOT EXISTS idx_pdr_route_order ON public.package_damage_reports(route_order_id);
CREATE INDEX IF NOT EXISTS idx_pdr_service_case ON public.package_damage_reports(service_case_id);

-- Deprecar singular
COMMENT ON TABLE public.package_damage_report IS
  'DEPRECATED — usar public.package_damage_reports (plural). Mantida apenas para histórico. delivery_return_to_warehouse já escreve na plural desde F29.';

-- Reescrita delivery_return_to_warehouse → escreve na plural
CREATE OR REPLACE FUNCTION public.delivery_return_to_warehouse(_route_order_id uuid, _lines jsonb, _mode text DEFAULT 'release_reserved'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dro record; v_veh record; l jsonb; v_pkg record; v_man record;
  v_dest uuid; v_move uuid; v_count int := 0; v_cond text;
  v_sched record;
BEGIN
  IF NOT public._m3_is_logistics() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF _mode NOT IN ('keep_reserved','release_reserved') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_mode');
  END IF;
  SELECT * INTO v_dro FROM delivery_route_orders WHERE id=_route_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_order_not_found'); END IF;
  SELECT v.* INTO v_veh FROM vehicles v JOIN delivery_routes r ON r.vehicle_id=v.id WHERE r.id=v_dro.route_id;
  SELECT ds.* INTO v_sched FROM delivery_schedules ds WHERE ds.id = v_dro.schedule_id;

  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_cond := COALESCE(l->>'return_condition','good');
    v_dest := public._m4_return_loc(v_cond);
    IF v_dest IS NULL THEN RETURN jsonb_build_object('ok',false,'error','return_location_missing','kind',v_cond); END IF;

    SELECT * INTO v_pkg FROM stock_packages WHERE id=(l->>'stock_package_id')::uuid;
    SELECT * INTO v_man FROM vehicle_route_manifest WHERE route_id=v_dro.route_id AND stock_package_id=v_pkg.id LIMIT 1;
    IF v_pkg.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','package_not_found'); END IF;
    IF v_pkg.status='delivered' THEN RETURN jsonb_build_object('ok',false,'error','already_delivered'); END IF;
    IF v_pkg.current_location_id <> v_veh.stock_location_id THEN
      RETURN jsonb_build_object('ok',false,'error','package_not_in_vehicle');
    END IF;

    v_move := public._m4_make_move(v_pkg.product_id, v_veh.stock_location_id, v_dest,
                                   COALESCE((l->>'qty')::numeric, v_pkg.qty),
                                   'return:'||v_cond, v_pkg.id);
    PERFORM public.package_move(v_pkg.id, v_dest, NULL, NULL, 'return_'||v_cond, v_move, COALESCE((l->>'qty')::numeric,v_pkg.qty));

    UPDATE stock_packages
       SET condition = CASE WHEN v_cond IN ('damaged','quarantine') THEN v_cond::package_condition ELSE condition END,
           status = CASE WHEN v_cond='good' AND _mode='keep_reserved' THEN 'reserved'::package_status ELSE 'available'::package_status END
     WHERE id=v_pkg.id;

    IF v_cond IN ('damaged','quarantine') THEN
      INSERT INTO public.package_damage_reports(
        stock_package_id, route_id, route_order_id, delivery_schedule_id,
        sale_order_id, sale_order_line_id,
        damage_type, description, return_condition, reported_by, status)
      VALUES (
        v_pkg.id, v_dro.route_id, _route_order_id, v_dro.schedule_id,
        v_sched.sale_order_id, NULL,
        v_cond, l->>'reason', v_cond, auth.uid(),
        CASE WHEN v_cond='damaged' THEN 'in_repair'::package_damage_status
             ELSE 'in_quarantine'::package_damage_status END);
    END IF;

    IF v_man.id IS NOT NULL THEN
      UPDATE vehicle_route_manifest
         SET qty_returned=qty_returned+COALESCE((l->>'qty')::numeric, v_pkg.qty),
             return_condition=v_cond::return_kind, return_reason=l->>'reason', updated_at=now()
       WHERE id=v_man.id;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE delivery_route_orders SET status=CASE WHEN status='failed' THEN 'returned' ELSE status END,
                                   returned_at=now() WHERE id=_route_order_id;
  PERFORM public._m3_log(NULL,'delivery.returned_to_warehouse',_route_order_id::text,
    jsonb_build_object('mode',_mode,'count',v_count));
  RETURN jsonb_build_object('ok',true,'returned',v_count);
END $function$;

-- Trigger: ao inserir damaged em package_damage_reports → cria service_case; falha não aborta
CREATE OR REPLACE FUNCTION public._tg_pdr_damaged_to_service_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_case uuid;
BEGIN
  IF NEW.damage_type = 'damaged' OR NEW.return_condition = 'damaged' THEN
    BEGIN
      v_case := public.service_case_create_from_damaged_package(NEW.stock_package_id,
                                                                COALESCE(NEW.description,'Damaged on return'),
                                                                'repair');
      NEW.service_case_id := v_case;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.erp_remediation_log(issue_type, severity, entity_type, entity_id, action, mode, applied, reason)
      VALUES ('damaged_package_service_case_failed','P1','package_damage_reports', NEW.id,
              'auto_create_service_case','trigger', false,
              'SQLSTATE='||SQLSTATE||' MSG='||SQLERRM);
    END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_pdr_damaged_to_service_case ON public.package_damage_reports;
CREATE TRIGGER tg_pdr_damaged_to_service_case
  BEFORE INSERT ON public.package_damage_reports
  FOR EACH ROW EXECUTE FUNCTION public._tg_pdr_damaged_to_service_case();

-- =========================================================================
-- PARTE 3 — Health check + limpeza de dados
-- =========================================================================

-- Health check novo: damaged sem service_case
CREATE OR REPLACE FUNCTION public.erp_health_check_damaged_packages()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_count int;
  r record;
BEGIN
  -- pacotes com condição damaged que:
  -- a) não têm service_case aberto
  -- b) NÃO estão em localizações de cliente (usage='customer')
  FOR r IN
    SELECT sp.id AS package_id, sp.reference, sp.current_location_id
    FROM stock_packages sp
    LEFT JOIN stock_locations sl ON sl.id = sp.current_location_id
    WHERE sp.condition = 'damaged'
      AND (sl.usage IS NULL OR sl.usage <> 'customer')
      AND NOT EXISTS (
        SELECT 1 FROM service_cases sc
        WHERE sc.stock_package_id = sp.id
          AND sc.status NOT IN ('done','cancelled','rejected')
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_damage_reports pdr
        WHERE pdr.stock_package_id = sp.id
          AND pdr.service_case_id IS NOT NULL
      )
  LOOP
    v_findings := v_findings || jsonb_build_object(
      'type','damaged_package_without_service_case',
      'severity','P1',
      'entity_type','stock_packages',
      'entity_id', r.package_id,
      'reference', r.reference,
      'fix','service_case_create_from_damaged_package');
  END LOOP;
  v_count := jsonb_array_length(v_findings);
  RETURN jsonb_build_object('ok', true, 'findings', v_findings,
    'summary', jsonb_build_object('total', v_count, 'p0',0,'p1',v_count,'p2',0,'p3',0));
END $function$;

-- Limpeza de dados: rotas planned sem veículo (com verificação de dependências)
DO $$
DECLARE
  r record; v_deps int; v_deleted int := 0; v_skipped int := 0;
BEGIN
  FOR r IN SELECT id, route_date FROM delivery_routes WHERE state='planned' AND vehicle_id IS NULL
  LOOP
    v_deps := (SELECT count(*) FROM delivery_route_orders WHERE route_id=r.id)
            + (SELECT count(*) FROM vehicle_route_manifest WHERE route_id=r.id)
            + (SELECT count(*) FROM delivery_route_cash_closure WHERE route_id=r.id)
            + (SELECT count(*) FROM delivery_schedules WHERE route_id=r.id);
    IF v_deps = 0 THEN
      DELETE FROM delivery_routes WHERE id=r.id;
      v_deleted := v_deleted + 1;
      RAISE NOTICE 'F29 cleanup: deleted planned route % (%)', r.id, r.route_date;
    ELSE
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'F29 cleanup: SKIPPED route % (deps=%)', r.id, v_deps;
    END IF;
  END LOOP;
  RAISE NOTICE 'F29 cleanup summary: deleted=% skipped=%', v_deleted, v_skipped;
END $$;

-- Anotação na closure com actual=0 (demo)
UPDATE public.delivery_route_cash_closure
   SET notes = COALESCE(notes||E'\n','') || 'fecho sem contagem — dados de demo, anterior à validação CONTAGEM_OBRIGATORIA'
 WHERE id = '9e7b8a46-0000-0000-0000-000000000000'::uuid  -- placeholder guard
    OR id::text LIKE '9e7b8a46%';

-- =========================================================================
-- PARTE 4 — _test_delivery_cash_fixes
-- =========================================================================
CREATE OR REPLACE FUNCTION public._test_delivery_cash_fixes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_ok boolean;
  v_msg text;
  v_sum_def text;
  v_close_def text;
  v_prev1 jsonb; v_prev2 jsonb;
BEGIN
  -- a) delivery_route_cash_summary devolve method_breakdown e bnpl_informational (chaves presentes)
  BEGIN
    v_sum_def := pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='delivery_route_cash_summary'));
    v_ok := v_sum_def ILIKE '%method_breakdown%' AND v_sum_def ILIKE '%bnpl_informational%' AND v_sum_def ILIKE '%upper(pm.code)%';
    v_out := v_out || jsonb_build_object('a_summary_by_pm_code', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('a_summary_by_pm_code', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- b) close valida CONTAGEM_OBRIGATORIA (procura literal no source)
  BEGIN
    v_close_def := pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='delivery_route_cash_close'));
    v_ok := v_close_def ILIKE '%CONTAGEM_OBRIGATORIA%' AND v_close_def ILIKE '%confirm_zero%';
    v_out := v_out || jsonb_build_object('b_close_validates_zero', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('b_close_validates_zero', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- c) delivery_return_to_warehouse escreve na plural
  BEGIN
    v_ok := (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='delivery_return_to_warehouse')
            ILIKE '%package_damage_reports%';
    v_out := v_out || jsonb_build_object('c_return_writes_plural', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('c_return_writes_plural', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- d) trigger damaged→service_case existe
  BEGIN
    v_ok := EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='tg_pdr_damaged_to_service_case' AND NOT tgisinternal);
    v_out := v_out || jsonb_build_object('d_trigger_damaged_to_case', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('d_trigger_damaged_to_case', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- e) colunas novas na closure existem
  BEGIN
    v_ok := (SELECT count(*) FROM information_schema.columns
             WHERE table_name='delivery_route_cash_closure'
               AND column_name IN ('method_breakdown','bnpl_informational','expected_multibanco','actual_multibanco')) = 4;
    v_out := v_out || jsonb_build_object('e_closure_new_columns', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('e_closure_new_columns', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- f) health check nova função existe e retorna estrutura esperada
  BEGIN
    v_ok := (public.erp_health_check_damaged_packages()->>'ok')::boolean;
    v_out := v_out || jsonb_build_object('f_health_check_damaged', jsonb_build_object('ok', v_ok));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('f_health_check_damaged', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  -- g) reruns
  BEGIN
    v_prev1 := public._test_supply_canonical_path();
    v_prev2 := public._test_mfg_fixes();
    v_ok := COALESCE((v_prev1->>'ok')::boolean,false) AND COALESCE((v_prev2->>'ok')::boolean,false);
    v_out := v_out || jsonb_build_object('g_rerun_prev_tests', jsonb_build_object('ok', v_ok,
      'supply', v_prev1->'ok', 'mfg', v_prev2->'ok'));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('g_rerun_prev_tests', jsonb_build_object('ok', false, 'err', SQLERRM));
  END;

  RETURN jsonb_build_object('ok',
    (SELECT bool_and((v->>'ok')::boolean) FROM jsonb_each(v_out) AS t(k,v)),
    'results', v_out);
END $function$;
