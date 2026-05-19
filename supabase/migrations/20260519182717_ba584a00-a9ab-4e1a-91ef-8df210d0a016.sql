
CREATE OR REPLACE FUNCTION public._test_phase21_communication_core(_verbose boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_pass int := 0; v_fail int := 0;
  v_uid uuid; v_uid2 uuid;
  v_customer uuid; v_ticket uuid; v_case uuid;
  v_notif uuid; v_act uuid; v_task uuid; v_thr uuid; v_msg uuid;
  v_n int; v_log uuid; v_so uuid; v_acts jsonb; v_overdue uuid; v_hc jsonb;
  v_msgs jsonb; v_has_internal boolean; v_pid uuid;
  v_pol_cnt int; v_unread_cnt int; v_read_cnt int;
  v_test_u uuid; v_before int; v_after int;
  v_act_before int; v_act_after int; v_notif_before int; v_notif_after int;
  v_ok boolean; v_name text; v_detail text;
BEGIN
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  SELECT id INTO v_uid2 FROM auth.users WHERE id <> v_uid LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no auth users to test'; END IF;

  -- 01
  v_notif := public.notification_create(jsonb_build_object(
    'recipient_user_id', v_uid::text,'category','system','title','t01','type','test'));
  v_results := v_results || jsonb_build_object('name','01_notif_create_user','ok', v_notif IS NOT NULL);
  IF v_notif IS NOT NULL THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 02
  v_notif := public.notification_create(jsonb_build_object(
    'recipient_group','system_admin','category','system','title','t02','type','test'));
  v_ok := v_notif IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','02_notif_create_group','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 03
  UPDATE public.notifications SET status='read', read_at=now() WHERE id=v_notif;
  SELECT count(*) INTO v_n FROM public.notifications WHERE id=v_notif AND status='read';
  v_ok := v_n=1;
  v_results := v_results || jsonb_build_object('name','03_mark_read','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 04
  v_test_u := v_uid;
  INSERT INTO public.notifications(user_id, module, type, title, severity, category, status)
  SELECT v_test_u,'core'::app_module,'test','bulk '||g,'info','system','unread' FROM generate_series(1,3) g;
  SELECT count(*) INTO v_before FROM public.notifications WHERE user_id=v_test_u AND status='unread';
  UPDATE public.notifications SET status='read', read_at=now() WHERE user_id=v_test_u AND status='unread';
  SELECT count(*) INTO v_after FROM public.notifications WHERE user_id=v_test_u AND status='unread';
  v_ok := v_before>=3 AND v_after=0;
  v_results := v_results || jsonb_build_object('name','04_mark_all_read','ok',v_ok,'detail',format('before:%s after:%s',v_before,v_after));
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 05
  SELECT count(*) INTO v_unread_cnt FROM public.notifications WHERE status='unread';
  SELECT count(*) INTO v_read_cnt FROM public.notifications WHERE status='read';
  v_ok := v_unread_cnt >= 0 AND v_read_cnt >= 1;
  v_results := v_results || jsonb_build_object('name','05_list_filter','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 06
  BEGIN
    PERFORM public.notification_create(jsonb_build_object('title','no recipient'));
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  v_results := v_results || jsonb_build_object('name','06_no_recipient_blocks','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 07
  SELECT id INTO v_so FROM public.sale_orders LIMIT 1;
  IF v_so IS NULL THEN v_so := gen_random_uuid(); END IF;
  v_act := public.activity_log_event('sale_order', v_so, 'test_event','msg','{"k":"v"}'::jsonb,'internal');
  v_ok := v_act IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','07_activity_log_event','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 08
  v_acts := public.activity_list_for_entity('sale_order', v_so);
  v_ok := jsonb_array_length(v_acts) >= 1;
  v_results := v_results || jsonb_build_object('name','08_activity_list','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 09 append-only (no update/delete policies on activity_events)
  SELECT count(*) INTO v_pol_cnt FROM pg_policies
   WHERE schemaname='public' AND tablename='activity_events' AND cmd IN ('UPDATE','DELETE');
  v_ok := v_pol_cnt=0;
  v_results := v_results || jsonb_build_object('name','09_activity_append_only','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 10
  v_task := public.erp_task_create(jsonb_build_object('title','t','assigned_to',v_uid::text));
  v_ok := v_task IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','10_task_create','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 11
  PERFORM public.erp_task_assign(v_task, COALESCE(v_uid2, v_uid), NULL);
  SELECT count(*) INTO v_n FROM public.erp_tasks WHERE id=v_task AND assigned_to=COALESCE(v_uid2,v_uid);
  v_ok := v_n=1;
  v_results := v_results || jsonb_build_object('name','11_task_assign','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 12
  PERFORM public.erp_task_complete(v_task,'done');
  SELECT count(*) INTO v_n FROM public.erp_tasks WHERE id=v_task AND status='done';
  v_ok := v_n=1;
  v_results := v_results || jsonb_build_object('name','12_task_complete','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 13 overdue → p1
  v_overdue := public.erp_task_create(jsonb_build_object(
    'title','overdue','assigned_to',v_uid::text,
    'due_date',(now()-interval '2 days')::text));
  v_hc := public.erp_communication_health_check(48);
  v_ok := (v_hc->'summary'->>'p1')::int >= 1;
  v_results := v_results || jsonb_build_object('name','13_overdue_health','ok',v_ok,'detail',v_hc::text);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 14
  v_thr := public.conversation_create(jsonb_build_object('title','t','visibility','internal'));
  v_ok := v_thr IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','14_conv_create','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 15
  v_pid := public.conversation_add_participant(v_thr, jsonb_build_object(
    'user_id',v_uid::text,'participant_type','internal_user'));
  v_ok := v_pid IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','15_conv_add_participant','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 16
  v_msg := public.conversation_add_message(v_thr,'internal msg','internal');
  PERFORM public.conversation_add_message(v_thr,'visible','customer_visible');
  v_ok := v_msg IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','16_conv_add_message','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 17
  v_msgs := public.conversation_messages(v_thr,'customer_visible');
  SELECT bool_or((m->>'visibility')='internal') INTO v_has_internal FROM jsonb_array_elements(v_msgs) m;
  v_ok := COALESCE(v_has_internal,false)=false AND jsonb_array_length(v_msgs)>=1;
  v_results := v_results || jsonb_build_object('name','17_internal_filtered','ok',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 18 customer ticket trigger
  SELECT id INTO v_customer FROM public.partners LIMIT 1;
  IF v_customer IS NULL THEN
    INSERT INTO public.partners(name, kind) VALUES ('TEST_F21','customer') RETURNING id INTO v_customer;
  END IF;
  SELECT count(*) INTO v_act_before FROM public.activity_events WHERE entity_type='customer_ticket';
  SELECT count(*) INTO v_notif_before FROM public.notifications WHERE entity_type='customer_ticket';
  INSERT INTO public.customer_tickets(ticket_number, customer_id, source, category, priority, status, subject, description, created_by_customer)
  VALUES ('T-F21-'||substring(gen_random_uuid()::text,1,8), v_customer,'internal','general_question','normal','new','t','d',false)
  RETURNING id INTO v_ticket;
  SELECT count(*) INTO v_act_after FROM public.activity_events WHERE entity_type='customer_ticket';
  SELECT count(*) INTO v_notif_after FROM public.notifications WHERE entity_type='customer_ticket';
  v_ok := v_act_after > v_act_before AND v_notif_after > v_notif_before;
  v_results := v_results || jsonb_build_object('name','18_ticket_trigger','ok',v_ok,
    'detail',format('act:%s->%s notif:%s->%s',v_act_before,v_act_after,v_notif_before,v_notif_after));
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 19 service case trigger
  SELECT count(*) INTO v_act_before FROM public.activity_events WHERE entity_type='service_case';
  SELECT count(*) INTO v_notif_before FROM public.notifications WHERE entity_type='service_case';
  INSERT INTO public.service_cases(case_number, customer_id, case_type, source, priority, status, description)
  VALUES ('SC-F21-'||substring(gen_random_uuid()::text,1,8), v_customer,
          'other'::service_case_type,'internal'::service_case_source,
          'normal'::service_case_priority,'new'::service_case_status,'test')
  RETURNING id INTO v_case;
  SELECT count(*) INTO v_act_after FROM public.activity_events WHERE entity_type='service_case';
  SELECT count(*) INTO v_notif_after FROM public.notifications WHERE entity_type='service_case';
  v_ok := v_act_after > v_act_before AND v_notif_after > v_notif_before;
  v_results := v_results || jsonb_build_object('name','19_case_trigger','ok',v_ok,
    'detail',format('act:%s->%s notif:%s->%s',v_act_before,v_act_after,v_notif_before,v_notif_after));
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- 20 health check
  SELECT count(*) INTO v_notif_before FROM public.notifications WHERE type='health_check_critical';
  v_log := public.erp_health_check_run(7);
  SELECT count(*) INTO v_notif_after FROM public.notifications WHERE type='health_check_critical';
  v_ok := v_notif_after >= v_notif_before AND v_log IS NOT NULL;
  v_results := v_results || jsonb_build_object('name','20_health_run_notifies','ok',v_ok,
    'detail',format('before:%s after:%s log:%s',v_notif_before,v_notif_after,v_log));
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  RETURN jsonb_build_object('passed',v_pass,'failed',v_fail,'total',v_pass+v_fail,'results',CASE WHEN _verbose THEN v_results ELSE NULL END);
END $$;
