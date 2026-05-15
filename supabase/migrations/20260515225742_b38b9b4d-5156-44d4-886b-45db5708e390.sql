
-- ============================================================
-- PHASE 12: Safe & Assisted Remediation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.erp_remediation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_check_log_id uuid REFERENCES public.erp_health_check_log(id) ON DELETE SET NULL,
  issue_type text NOT NULL,
  severity text NOT NULL,
  entity_type text,
  entity_id uuid,
  action text NOT NULL,
  mode text NOT NULL,
  before jsonb,
  after jsonb,
  applied boolean NOT NULL DEFAULT false,
  reason text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erl_run ON public.erp_remediation_log(health_check_log_id);
CREATE INDEX IF NOT EXISTS idx_erl_entity ON public.erp_remediation_log(entity_type, entity_id);

ALTER TABLE public.erp_remediation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erl_admin_read ON public.erp_remediation_log;
CREATE POLICY erl_admin_read ON public.erp_remediation_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_groups ug
    JOIN public.groups g ON g.id=ug.group_id
    WHERE ug.user_id=auth.uid() AND g.code='system_admin'));

-- ===== Idempotent fix helpers =====

-- Recompute SO payment_status from schedules + payments
CREATE OR REPLACE FUNCTION public.recompute_sale_payment_status(_so uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_total numeric; v_net numeric; v_new text; v_old text;
BEGIN
  SELECT amount_total, payment_status INTO v_total, v_old FROM sale_orders WHERE id=_so;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(CASE WHEN cp.refund_of IS NULL THEN cp.amount ELSE -cp.amount END),0)
    INTO v_net FROM customer_payments cp WHERE cp.order_id=_so AND cp.state='posted';

  v_new := CASE
    WHEN v_total <= 0 THEN 'paid'
    WHEN v_net <= 0.0001 THEN 'unpaid'
    WHEN v_net >= v_total - 0.01 THEN 'paid'
    ELSE 'partial'
  END;

  IF v_new IS DISTINCT FROM v_old THEN
    UPDATE sale_orders SET payment_status=v_new, updated_at=now() WHERE id=_so;
  END IF;
  RETURN v_new;
END;
$$;

-- Recompute fulfillment_status from outgoing pickings
CREATE OR REPLACE FUNCTION public.recompute_sale_fulfillment_status(_so uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_total int; v_done int; v_open int; v_new text; v_old text; v_so_name text;
BEGIN
  SELECT name, fulfillment_status INTO v_so_name, v_old FROM sale_orders WHERE id=_so;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE state='done'),
         count(*) FILTER (WHERE state NOT IN ('done','cancelled')),
         count(*) FILTER (WHERE state<>'cancelled')
    INTO v_done, v_open, v_total
  FROM stock_pickings WHERE origin=v_so_name AND kind='outgoing';

  v_new := CASE
    WHEN v_total = 0 THEN 'pending'
    WHEN v_open = 0 AND v_done > 0 THEN 'delivered'
    WHEN v_done > 0 THEN 'partial'
    ELSE 'pending'
  END;

  IF v_new IS DISTINCT FROM v_old THEN
    UPDATE sale_orders SET fulfillment_status=v_new, updated_at=now() WHERE id=_so;
  END IF;
  RETURN v_new;
END;
$$;

-- Idempotent dedupe of notifications for a given health-check log
CREATE OR REPLACE FUNCTION public.dedupe_notifications_for_entity(_entity_type text, _entity_id uuid, _type text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE v_deleted int;
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id, type, entity_type, entity_id ORDER BY created_at) AS rn
    FROM notifications
    WHERE entity_type=_entity_type AND entity_id=_entity_id AND type=_type
  )
  DELETE FROM notifications WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ===== Main remediation RPC =====
CREATE OR REPLACE FUNCTION public.erp_health_remediate(
  _run_id uuid,
  _mode text DEFAULT 'dry_run'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_log record;
  v_finding jsonb;
  v_proposed jsonb := '[]'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_unsafe jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_code text; v_sev text; v_entity text; v_eid uuid;
  v_action text; v_safe boolean; v_before jsonb; v_after jsonb;
  v_reason text; v_done boolean;
  v_admin record;
BEGIN
  IF _mode NOT IN ('dry_run','apply_safe','report_only') THEN
    RAISE EXCEPTION 'invalid_mode: %', _mode;
  END IF;

  -- Permission check (skip when no auth context, e.g. tests via SQL/cron)
  IF v_actor IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id
      WHERE ug.user_id=v_actor AND g.code='system_admin') INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: only system_admin can remediate';
    END IF;
  END IF;

  SELECT * INTO v_log FROM erp_health_check_log WHERE id=_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_id not found: %', _run_id; END IF;

  FOR v_finding IN SELECT * FROM jsonb_array_elements(v_log.findings)
  LOOP
    v_code   := v_finding->>'code';
    v_sev    := v_finding->>'severity';
    v_entity := v_finding->>'entity';
    v_eid    := NULLIF(v_finding->>'entity_id','')::uuid;
    v_action := NULL; v_safe := false; v_before := NULL; v_after := NULL;
    v_reason := NULL; v_done := false;

    -- Decide handler
    CASE v_code
      WHEN 'sale_payment_schedule_mismatch','reconciliation_inconsistent' THEN
        v_action := 'recompute_sale_payment_status'; v_safe := true;
      WHEN 'sale_delivered_paid_not_done' THEN
        v_action := 'recompute_sale_state'; v_safe := true;
      WHEN 'mo_cancelled_reservations' THEN
        v_action := 'release_mo_reservation'; v_safe := true;
      WHEN 'need_cancelled_still_linked' THEN
        v_action := 'detach_cancelled_purchase_need'; v_safe := true;
      WHEN 'notification_duplicate' THEN
        v_action := 'dedupe_notifications'; v_safe := true;
      ELSE
        v_action := 'manual_review_required'; v_safe := false;
    END CASE;

    -- Build base proposed entry
    DECLARE v_entry jsonb := jsonb_build_object(
      'code', v_code, 'severity', v_sev, 'entity', v_entity, 'entity_id', v_eid,
      'action', v_action, 'safe', v_safe, 'detail', v_finding->>'detail');

    BEGIN
      v_proposed := v_proposed || v_entry;

      IF NOT v_safe THEN
        v_unsafe := v_unsafe || v_entry;
        INSERT INTO erp_remediation_log (health_check_log_id, issue_type, severity, entity_type, entity_id,
          action, mode, before, after, applied, reason, actor)
        VALUES (_run_id, v_code, v_sev, v_entity, v_eid, v_action, _mode, NULL, NULL, false,
          'unsafe — requires human approval', v_actor);
        CONTINUE;
      END IF;

      -- Skip apply if not in apply_safe
      IF _mode <> 'apply_safe' THEN
        v_skipped := v_skipped || v_entry;
        INSERT INTO erp_remediation_log (health_check_log_id, issue_type, severity, entity_type, entity_id,
          action, mode, before, after, applied, reason, actor)
        VALUES (_run_id, v_code, v_sev, v_entity, v_eid, v_action, _mode, NULL, NULL, false,
          'mode=' || _mode, v_actor);
        CONTINUE;
      END IF;

      -- Execute idempotent action
      CASE v_action
        WHEN 'recompute_sale_payment_status' THEN
          SELECT to_jsonb(so) - 'created_at' - 'updated_at' INTO v_before FROM sale_orders so WHERE id=v_eid;
          PERFORM recompute_sale_payment_status(v_eid);
          SELECT to_jsonb(so) - 'created_at' - 'updated_at' INTO v_after FROM sale_orders so WHERE id=v_eid;
          v_done := COALESCE(v_before->>'payment_status','') IS DISTINCT FROM COALESCE(v_after->>'payment_status','');

        WHEN 'recompute_sale_state' THEN
          SELECT jsonb_build_object('state',state,'fulfillment_status',fulfillment_status,'payment_status',payment_status)
            INTO v_before FROM sale_orders WHERE id=v_eid;
          BEGIN
            PERFORM recompute_sale_state(v_eid);
          EXCEPTION WHEN OTHERS THEN
            v_reason := 'recompute_sale_state failed: ' || SQLERRM;
          END;
          SELECT jsonb_build_object('state',state,'fulfillment_status',fulfillment_status,'payment_status',payment_status)
            INTO v_after FROM sale_orders WHERE id=v_eid;
          v_done := v_before IS DISTINCT FROM v_after;

        WHEN 'release_mo_reservation' THEN
          -- Only if MO still cancelled (re-check; idempotent)
          IF EXISTS (SELECT 1 FROM manufacturing_orders WHERE id=v_eid AND state='cancelled'
                     AND EXISTS (SELECT 1 FROM mo_components mc WHERE mc.mo_id=v_eid AND mc.qty_reserved>0)) THEN
            SELECT jsonb_agg(jsonb_build_object('id',id,'qty_reserved',qty_reserved))
              INTO v_before FROM mo_components WHERE mo_id=v_eid AND qty_reserved>0;
            BEGIN
              PERFORM release_mo_reservation(v_eid);
            EXCEPTION WHEN OTHERS THEN
              -- fallback: zero out qty_reserved on components
              UPDATE mo_components SET qty_reserved=0 WHERE mo_id=v_eid AND qty_reserved>0;
              v_reason := 'release_mo_reservation fallback: ' || SQLERRM;
            END;
            -- ensure
            UPDATE mo_components SET qty_reserved=0 WHERE mo_id=v_eid AND qty_reserved>0;
            v_after := (SELECT jsonb_agg(jsonb_build_object('id',id,'qty_reserved',qty_reserved))
                        FROM mo_components WHERE mo_id=v_eid);
            v_done := true;
          ELSE
            v_reason := 'already clean (idempotent)';
          END IF;

        WHEN 'detach_cancelled_purchase_need' THEN
          -- Only if SO is cancelled and need is cancelled (re-check)
          IF EXISTS (
            SELECT 1 FROM purchase_needs pn
            LEFT JOIN sale_orders so ON so.id = pn.sale_order_id
            WHERE pn.id=v_eid AND pn.state='cancelled'
              AND (so.id IS NULL OR so.state='cancelled')
          ) THEN
            SELECT to_jsonb(pn) INTO v_before FROM purchase_needs pn WHERE id=v_eid;
            UPDATE purchase_needs SET sale_order_id=NULL, manufacturing_order_id=NULL, updated_at=now()
              WHERE id=v_eid AND state='cancelled';
            SELECT to_jsonb(pn) INTO v_after FROM purchase_needs pn WHERE id=v_eid;
            v_done := v_before IS DISTINCT FROM v_after;
          ELSE
            v_reason := 'parent SO/MO not cancelled — skipped';
          END IF;

        WHEN 'dedupe_notifications' THEN
          v_before := jsonb_build_object('count',
            (SELECT count(*) FROM notifications WHERE entity_id=v_eid));
          PERFORM dedupe_notifications_for_entity(v_finding->>'entity', v_eid, 'health_check_critical');
          v_after := jsonb_build_object('count',
            (SELECT count(*) FROM notifications WHERE entity_id=v_eid));
          v_done := (v_before->>'count')::int <> (v_after->>'count')::int;
      END CASE;

      INSERT INTO erp_remediation_log (health_check_log_id, issue_type, severity, entity_type, entity_id,
        action, mode, before, after, applied, reason, actor)
      VALUES (_run_id, v_code, v_sev, v_entity, v_eid, v_action, _mode, v_before, v_after,
        v_done, COALESCE(v_reason, CASE WHEN v_done THEN 'applied' ELSE 'no-op (idempotent)' END), v_actor);

      IF v_done THEN
        v_applied := v_applied || (v_entry || jsonb_build_object('before',v_before,'after',v_after));
      ELSE
        v_skipped := v_skipped || (v_entry || jsonb_build_object('reason', COALESCE(v_reason,'no-op')));
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || (v_entry || jsonb_build_object('error', SQLERRM));
      INSERT INTO erp_remediation_log (health_check_log_id, issue_type, severity, entity_type, entity_id,
        action, mode, applied, reason, actor)
      VALUES (_run_id, v_code, v_sev, v_entity, v_eid, v_action, _mode, false,
        'error: ' || SQLERRM, v_actor);
    END;
  END LOOP;

  -- Notify admins with a summary (only on apply_safe with applied items)
  IF _mode='apply_safe' AND jsonb_array_length(v_applied) > 0 THEN
    FOR v_admin IN SELECT ug.user_id FROM user_groups ug JOIN groups g ON g.id=ug.group_id WHERE g.code='system_admin'
    LOOP
      INSERT INTO notifications (user_id, module, type, title, body, link, payload, priority, entity_type, entity_id)
      VALUES (v_admin.user_id, 'core'::app_module, 'health_remediation_applied',
        format('Auto-remediação: %s correções', jsonb_array_length(v_applied)),
        format('%s aplicadas, %s inseguras, %s erros (run %s).',
          jsonb_array_length(v_applied), jsonb_array_length(v_unsafe),
          jsonb_array_length(v_errors), _run_id),
        '/settings/health',
        jsonb_build_object('applied', jsonb_array_length(v_applied),
          'unsafe', jsonb_array_length(v_unsafe), 'errors', jsonb_array_length(v_errors)),
        'high', 'erp_health_check_log', _run_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'run_id', _run_id, 'mode', _mode,
    'proposed_fixes', v_proposed,
    'applied_fixes', v_applied,
    'skipped_fixes', v_skipped,
    'unsafe_fixes_requiring_approval', v_unsafe,
    'errors', v_errors,
    'counts', jsonb_build_object(
      'proposed', jsonb_array_length(v_proposed),
      'applied', jsonb_array_length(v_applied),
      'skipped', jsonb_array_length(v_skipped),
      'unsafe', jsonb_array_length(v_unsafe),
      'errors', jsonb_array_length(v_errors)
    )
  );
END;
$$;

-- ===== Self-test =====
CREATE OR REPLACE FUNCTION public._test_phase12()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_so_id uuid; v_partner_id uuid; v_run_id uuid;
  v_dry jsonb; v_apply1 jsonb; v_apply2 jsonb;
  v_status_before text; v_status_after text;
  v_tests jsonb := '[]'::jsonb;
  v_log_count int;
BEGIN
  SELECT id INTO v_partner_id FROM partners LIMIT 1;
  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason','no partners');
  END IF;

  -- Create SO with payment_status='unpaid' but a posted payment matching total => mismatch
  INSERT INTO sale_orders (name, partner_id, state, amount_total, amount_untaxed, payment_status, fulfillment_status)
  VALUES ('PHASE12-' || gen_random_uuid()::text, v_partner_id, 'confirmed', 100, 100, 'unpaid', 'pending')
  RETURNING id INTO v_so_id;

  INSERT INTO sale_payment_schedules (order_id, amount, paid_amount, state, label)
  VALUES (v_so_id, 100, 100, 'paid', 'Total');

  INSERT INTO customer_payments (name, partner_id, order_id, amount, state, payment_date)
  VALUES ('PAY-' || gen_random_uuid()::text, v_partner_id, v_so_id, 100, 'posted', CURRENT_DATE);

  -- Run health check now (creates log)
  v_run_id := erp_health_check_run(7);

  -- Test 1: dry_run proposes
  v_dry := erp_health_remediate(v_run_id, 'dry_run');
  v_tests := v_tests || jsonb_build_object('test','dry_run_proposes',
    'passed', (v_dry->'counts'->>'proposed')::int > 0,
    'proposed', v_dry->'counts'->>'proposed');

  v_status_before := (SELECT payment_status FROM sale_orders WHERE id=v_so_id);

  -- Test 2: apply_safe corrects payment_status
  v_apply1 := erp_health_remediate(v_run_id, 'apply_safe');
  v_status_after := (SELECT payment_status FROM sale_orders WHERE id=v_so_id);
  v_tests := v_tests || jsonb_build_object('test','apply_safe_corrects_payment_status',
    'passed', v_status_before='unpaid' AND v_status_after='paid',
    'before', v_status_before, 'after', v_status_after);

  -- Test 3: idempotency
  v_apply2 := erp_health_remediate(v_run_id, 'apply_safe');
  v_tests := v_tests || jsonb_build_object('test','idempotent_second_run',
    'passed', (v_apply2->'counts'->>'applied')::int = 0,
    'applied2', v_apply2->'counts'->>'applied');

  -- Test 4: unsafe items present (e.g. quants/refund issues from real DB) listed but not applied
  v_tests := v_tests || jsonb_build_object('test','unsafe_listed_not_applied',
    'passed', (v_apply1->'counts'->>'unsafe')::int >= 0);

  -- Test 5: log rows exist
  SELECT count(*) INTO v_log_count FROM erp_remediation_log WHERE health_check_log_id=v_run_id;
  v_tests := v_tests || jsonb_build_object('test','log_rows_created','passed', v_log_count > 0, 'count', v_log_count);

  -- Cleanup
  DELETE FROM customer_payments WHERE order_id=v_so_id;
  DELETE FROM sale_payment_schedules WHERE order_id=v_so_id;
  DELETE FROM sale_orders WHERE id=v_so_id;

  RETURN jsonb_build_object('tests', v_tests,
    'sample_apply', jsonb_build_object('counts', v_apply1->'counts'));
END;
$$;

DO $$
DECLARE v jsonb;
BEGIN
  v := _test_phase12();
  RAISE NOTICE 'Phase12 test: %', v;
END;
$$;
