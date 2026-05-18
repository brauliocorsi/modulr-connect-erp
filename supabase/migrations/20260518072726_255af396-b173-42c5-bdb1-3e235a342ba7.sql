
-- ============================================================
-- F18-B :: Health checks for service cases
-- ============================================================

CREATE OR REPLACE FUNCTION public.erp_service_health_check(_threshold_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_row record;
  v_threshold timestamptz := now() - make_interval(days => _threshold_days);
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
BEGIN
  -- P0: damaged_package_without_service_case
  FOR v_row IN
    SELECT pdr.id, pdr.stock_package_id
      FROM public.package_damage_reports pdr
     WHERE pdr.status NOT IN ('cancelled','rejected')
       AND NOT EXISTS (SELECT 1 FROM public.service_cases sc
                         WHERE sc.stock_package_id = pdr.stock_package_id
                           AND sc.status NOT IN ('cancelled','rejected'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','damaged_package_without_service_case','severity','P0','entity','package_damage_report','entity_id',v_row.id,
      'detail', format('Damage report %s (pkg=%s) sem service_case', v_row.id, v_row.stock_package_id));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0: service_case_done_with_open_tasks
  FOR v_row IN
    SELECT sc.id, sc.case_number,
           (SELECT count(*) FROM public.service_tasks st WHERE st.service_case_id=sc.id AND st.status IN ('open','in_progress')) AS open_tasks
      FROM public.service_cases sc WHERE sc.status='done'
  LOOP
    IF v_row.open_tasks > 0 THEN
      v_findings := v_findings || jsonb_build_object('category','service','code','service_case_done_with_open_tasks','severity','P0','entity','service_case','entity_id',v_row.id,
        'detail', format('Case %s done com %s tarefas abertas', v_row.case_number, v_row.open_tasks));
      v_p0 := v_p0+1;
    END IF;
  END LOOP;

  -- P0: service_case_scheduled_without_ready_parts
  FOR v_row IN
    SELECT sc.id, sc.case_number
      FROM public.service_cases sc
     WHERE sc.status IN ('scheduled','in_route')
       AND EXISTS (SELECT 1 FROM public.service_case_items sci
                    WHERE sci.service_case_id=sc.id
                      AND sci.required_action IN ('replace','send_part','buy_part','manufacture_part','repair')
                      AND sci.status NOT IN ('part_ready','done','cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_scheduled_without_ready_parts','severity','P0','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s scheduled mas itens sem peça pronta', v_row.case_number));
    v_p0 := v_p0+1;
  END LOOP;

  -- P0: service_case_closed_without_resolution
  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE status='done' AND (closed_resolution IS NULL OR length(trim(closed_resolution))=0)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_closed_without_resolution','severity','P0','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s done sem resolution', v_row.case_number));
    v_p0 := v_p0+1;
  END LOOP;

  -- P1: service_case_open_too_long
  FOR v_row IN
    SELECT id, case_number, status, reported_at FROM public.service_cases
     WHERE status NOT IN ('done','cancelled','rejected') AND reported_at < v_threshold
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_open_too_long','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s aberto há mais de %s dias (status=%s)', v_row.case_number, _threshold_days, v_row.status));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1: service_case_waiting_parts_without_purchase_need
  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.status='waiting_parts'
       AND NOT EXISTS (SELECT 1 FROM public.purchase_needs pn
                        WHERE pn.service_case_id=sc.id
                          AND pn.state NOT IN ('cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_waiting_parts_without_purchase_need','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s waiting_parts sem purchase_need ativa', v_row.case_number));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1: service_case_waiting_manufacturing_without_mo
  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.status='waiting_manufacturing'
       AND NOT EXISTS (SELECT 1 FROM public.manufacturing_orders mo
                        WHERE mo.service_case_id=sc.id
                          AND mo.state NOT IN ('cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_waiting_manufacturing_without_mo','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s waiting_manufacturing sem MO ativa', v_row.case_number));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1: assistance_schedule_without_service_case
  FOR v_row IN
    SELECT id FROM public.delivery_schedules
     WHERE fulfillment_type='assistance' AND service_case_id IS NULL
       AND status NOT IN ('cancelled','delivered')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','assistance_schedule_without_service_case','severity','P1','entity','delivery_schedule','entity_id',v_row.id,
      'detail', format('Schedule %s fulfillment=assistance sem service_case', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;

  -- P1: service_case_item_without_action
  FOR v_row IN
    SELECT sci.id, sci.service_case_id
      FROM public.service_case_items sci
      JOIN public.service_cases sc ON sc.id=sci.service_case_id
     WHERE sci.required_action IS NULL
       AND sc.status NOT IN ('new','triage','cancelled','rejected','done')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_item_without_action','severity','P1','entity','service_case_item','entity_id',v_row.id,
      'detail', format('Item %s sem required_action', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;

  -- P2: service_case_without_assignment
  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE assigned_to IS NULL AND status NOT IN ('new','cancelled','rejected','done')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_without_assignment','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s ativo sem assigned_to', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  -- P2: service_case_without_photos_when_required
  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE case_type IN ('delivery_issue','customer_claim','damaged_return','warranty')
       AND status NOT IN ('new','cancelled','rejected')
       AND NOT EXISTS (SELECT 1 FROM public.service_case_attachments sca
                        WHERE sca.service_case_id=service_cases.id
                          AND sca.attachment_type IN ('customer_photo','delivery_photo','warehouse_photo','supplier_evidence'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_without_photos_when_required','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s sem fotos exigidas', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  -- P2: supplier_defect_without_supplier_claim
  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.case_type='supplier_defect'
       AND sc.status NOT IN ('cancelled','rejected')
       AND NOT EXISTS (SELECT 1 FROM public.service_tasks st
                        WHERE st.service_case_id=sc.id AND st.task_type='supplier_claim')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','supplier_defect_without_supplier_claim','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s supplier_defect sem supplier_claim task', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'total',v_p0+v_p1+v_p2),
    'findings', v_findings);
END $$;

GRANT EXECUTE ON FUNCTION public.erp_service_health_check(integer) TO authenticated;

-- Integrate into erp_health_check_run (additive: extend without breaking format)
CREATE OR REPLACE FUNCTION public.erp_health_check_run(_threshold_days integer DEFAULT 7)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb; v_shopfloor jsonb; v_service jsonb;
  v_findings jsonb; v_summary jsonb;
  v_p0 int; v_p1 int; v_p2 int; v_p3 int;
  v_log_id uuid; v_admin record; v_critical int;
BEGIN
  v_result := public.erp_health_check(_threshold_days);
  v_shopfloor := public.erp_health_check_shopfloor(_threshold_days);
  v_service := public.erp_service_health_check(_threshold_days);

  v_findings := COALESCE(v_result->'findings','[]'::jsonb)
              || COALESCE(v_shopfloor->'findings','[]'::jsonb)
              || COALESCE(v_service->'findings','[]'::jsonb);

  v_p0 := COALESCE((v_result->'summary'->>'p0')::int,0)
        + COALESCE((v_shopfloor->>'p0')::int,0)
        + COALESCE((v_service->'summary'->>'p0')::int,0);
  v_p1 := COALESCE((v_result->'summary'->>'p1')::int,0)
        + COALESCE((v_shopfloor->>'p1')::int,0)
        + COALESCE((v_service->'summary'->>'p1')::int,0);
  v_p2 := COALESCE((v_result->'summary'->>'p2')::int,0)
        + COALESCE((v_shopfloor->>'p2')::int,0)
        + COALESCE((v_service->'summary'->>'p2')::int,0);
  v_p3 := COALESCE((v_result->'summary'->>'p3')::int,0);

  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', COALESCE((v_result->'summary'->>'duration_ms')::int,0),
    'shopfloor_p0', COALESCE((v_shopfloor->>'p0')::int,0),
    'shopfloor_p1', COALESCE((v_shopfloor->>'p1')::int,0),
    'shopfloor_p2', COALESCE((v_shopfloor->>'p2')::int,0),
    'service_p0', COALESCE((v_service->'summary'->>'p0')::int,0),
    'service_p1', COALESCE((v_service->'summary'->>'p1')::int,0),
    'service_p2', COALESCE((v_service->'summary'->>'p2')::int,0));

  INSERT INTO public.erp_health_check_log (summary, findings, p0_count, p1_count, p2_count, p3_count, duration_ms)
  VALUES (v_summary, v_findings, v_p0, v_p1, v_p2, v_p3, (v_summary->>'duration_ms')::int)
  RETURNING id INTO v_log_id;

  v_critical := v_p0 + v_p1;
  IF v_critical > 0 THEN
    FOR v_admin IN SELECT ug.user_id FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id WHERE g.code='system_admin' LOOP
      INSERT INTO public.notifications (user_id, module, type, title, body, link, payload, priority, entity_type, entity_id)
      VALUES (v_admin.user_id, 'core'::public.app_module, 'health_check_critical',
        format('Health check: %s P0 / %s P1', v_p0, v_p1),
        format('Encontradas %s inconsistências críticas. Log %s.', v_critical, v_log_id),
        '/settings/health', v_summary, 'high', 'erp_health_check_log', v_log_id);
    END LOOP;
    UPDATE public.erp_health_check_log SET notified=true WHERE id=v_log_id;
  END IF;
  RETURN v_log_id;
END $$;
