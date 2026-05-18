DROP FUNCTION IF EXISTS public._test_phase19_customer_portal_helpdesk();

CREATE OR REPLACE FUNCTION public._test_phase19_customer_portal_helpdesk(_cleanup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'P19_' || to_char(now(),'YYYYMMDDHH24MISSMS') || '_';
  v_cust uuid; v_cust2 uuid; v_so uuid; v_so2 uuid;
  v_tok_res jsonb; v_tok text; v_tok2 text; v_tok_exp_res jsonb; v_tok_exp text;
  v_ticket uuid; v_ticket2 uuid; v_ticket_q uuid; v_ticket_sched uuid;
  v_msg uuid; v_att uuid; v_case uuid; v_case2 uuid;
  v_report jsonb := '[]'::jsonb; v_pass boolean; v_ok int:=0; v_fail int:=0; v_detail text;
  v_status_res jsonb; v_case_res jsonb;
  v_health jsonb;
BEGIN
  INSERT INTO public.partners(name, kind, is_customer) VALUES (v_pfx||'CustA','individual'::partner_kind,true) RETURNING id INTO v_cust;
  INSERT INTO public.partners(name, kind, is_customer) VALUES (v_pfx||'CustB','individual'::partner_kind,true) RETURNING id INTO v_cust2;
  INSERT INTO public.sale_orders(name, partner_id, state) VALUES (v_pfx||'SO-A', v_cust, 'confirmed'::sale_state) RETURNING id INTO v_so;
  INSERT INTO public.sale_orders(name, partner_id, state) VALUES (v_pfx||'SO-B', v_cust2, 'confirmed'::sale_state) RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id, product_id, description, quantity, line_kind)
  VALUES (v_so, NULL, 'Cama Teste', 1, 'product');

  v_tok_res := public.customer_portal_token_create(v_cust, v_so, NULL, 'order_status', NULL);
  v_tok := v_tok_res->>'token';
  v_pass := v_tok IS NOT NULL AND length(v_tok)>=32;
  v_report := v_report || jsonb_build_object('id','01_token_created','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS(SELECT 1 FROM public.customer_portal_tokens WHERE token_hash = v_tok)
        AND EXISTS(SELECT 1 FROM public.customer_portal_tokens WHERE token_hash = public._portal_hash_token(v_tok));
  v_report := v_report || jsonb_build_object('id','02_token_hash_only','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_status_res := public.customer_portal_order_status(v_tok);
  v_pass := (v_status_res->>'ok')::boolean AND v_status_res->>'order_number' = v_pfx||'SO-A'
            AND v_status_res->>'public_status' IS NOT NULL
            AND v_status_res->>'public_status' NOT LIKE 'sale%';
  v_report := v_report || jsonb_build_object('id','03_order_status_public','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_status_res->>'public_status');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_tok_exp_res := public.customer_portal_token_create(v_cust, v_so, NULL, 'order_status', now() - interval '1 hour');
  v_tok_exp := v_tok_exp_res->>'token';
  BEGIN
    PERFORM public.customer_portal_order_status(v_tok_exp);
    v_pass := false; v_detail := 'no_exception';
  EXCEPTION WHEN OTHERS THEN v_pass := SQLERRM LIKE '%expired%'; v_detail := SQLERRM; END;
  v_report := v_report || jsonb_build_object('id','04_expired_token_rejected','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_detail);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_tok_res := public.customer_portal_token_create(v_cust2, v_so2, NULL, 'order_status', NULL);
  v_tok2 := v_tok_res->>'token';
  v_status_res := public.customer_portal_order_status(v_tok2);
  v_pass := v_status_res->>'order_number' = v_pfx||'SO-B';
  v_report := v_report || jsonb_build_object('id','05_token_isolation','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_ticket := public.customer_ticket_create(v_tok, jsonb_build_object(
    'category','damaged_product','subject','Cama riscada','description','Chegou riscada na lateral'));
  v_pass := EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket AND customer_id=v_cust AND created_by_customer=true AND source='portal');
  v_report := v_report || jsonb_build_object('id','06_ticket_created','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_msg := public.customer_ticket_add_message(v_tok, v_ticket, 'Posso enviar fotos');
  v_pass := EXISTS(SELECT 1 FROM public.customer_ticket_messages WHERE id=v_msg AND sender_type='customer' AND internal=false)
            AND EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket AND status='waiting_agent');
  v_report := v_report || jsonb_build_object('id','07_customer_message','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_att := public.customer_ticket_add_attachment_metadata(v_tok, v_ticket, jsonb_build_object(
    'file_name','foto.jpg','file_type','image/jpeg','attachment_type','customer_photo','file_url','/portal/foto.jpg'));
  v_pass := EXISTS(SELECT 1 FROM public.customer_ticket_attachments WHERE id=v_att AND uploaded_by_customer=true);
  v_report := v_report || jsonb_build_object('id','08_attachment_metadata','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.helpdesk_ticket_add_message(v_ticket, 'Recebemos as fotos, obrigado', false);
  v_pass := EXISTS(SELECT 1 FROM public.customer_ticket_messages WHERE ticket_id=v_ticket AND sender_type='agent' AND internal=false)
            AND EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket AND status='waiting_customer');
  v_report := v_report || jsonb_build_object('id','09_agent_public_message','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.helpdesk_ticket_add_message(v_ticket, 'Cliente VIP, prioridade', true);
  v_pass := EXISTS(SELECT 1 FROM public.customer_ticket_messages WHERE ticket_id=v_ticket AND sender_type='agent' AND internal=true);
  v_report := v_report || jsonb_build_object('id','10_internal_note_isolated','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_case := public.helpdesk_ticket_convert_to_service_case(v_ticket, '{}'::jsonb);
  v_pass := v_case IS NOT NULL
            AND EXISTS(SELECT 1 FROM public.service_cases WHERE id=v_case AND customer_id=v_cust AND sale_order_id=v_so)
            AND EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket AND service_case_id=v_case AND status='linked_to_service_case');
  v_report := v_report || jsonb_build_object('id','11_ticket_converted','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_case2 := public.helpdesk_ticket_convert_to_service_case(v_ticket, '{}'::jsonb);
  v_pass := v_case2 = v_case;
  v_report := v_report || jsonb_build_object('id','12_convert_idempotent','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := EXISTS(SELECT 1 FROM public.service_cases sc JOIN public.customer_tickets t ON t.service_case_id=sc.id WHERE t.id=v_ticket AND sc.case_number IS NOT NULL);
  v_report := v_report || jsonb_build_object('id','13_service_case_linked','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_case_res := public.customer_service_case_status(v_tok, v_case);
  v_pass := (v_case_res->>'ok')::boolean AND v_case_res->>'status' = 'Pedido recebido';
  v_report := v_report || jsonb_build_object('id','14_case_status_public','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_case_res->>'status');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_ticket_q := public.customer_ticket_create(v_tok, jsonb_build_object('category','general_question','subject','Dúvida horário','description','Qual o horário?'));
  BEGIN
    PERFORM public.helpdesk_ticket_convert_to_service_case(v_ticket_q, '{}'::jsonb);
    v_pass := false; v_detail := 'no_exception';
  EXCEPTION WHEN OTHERS THEN v_pass := SQLERRM LIKE '%category_not_convertible%'; v_detail := SQLERRM; END;
  v_report := v_report || jsonb_build_object('id','15_general_not_auto_converted','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_detail);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_ticket_sched := public.customer_delivery_request_schedule(v_tok, v_so, (CURRENT_DATE+10)::date, 'manhã');
  v_pass := EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket_sched AND category='delivery_schedule' AND status='new');
  v_report := v_report || jsonb_build_object('id','16_schedule_request_ticket','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.customer_ticket_close(v_tok, v_ticket_q, 'resolvido');
  v_pass := EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=v_ticket_q AND status='cancelled' AND closed_at IS NOT NULL)
            AND (SELECT count(*) FROM public.customer_ticket_messages WHERE ticket_id=v_ticket_q) >= 1;
  v_report := v_report || jsonb_build_object('id','17_close_preserves_history','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  INSERT INTO public.customer_tickets(ticket_number, customer_id, source, category, status, subject, created_at, updated_at, created_by_customer)
  VALUES (public.next_ticket_number(), v_cust, 'portal','general_question','new',v_pfx||'antigo', now() - interval '30 days', now() - interval '30 days', true);
  v_health := public.erp_customer_portal_health_check(7);
  v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f WHERE f->>'code'='customer_ticket_open_too_long');
  v_report := v_report || jsonb_build_object('id','18_health_open_too_long','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  INSERT INTO public.customer_tickets(ticket_number, customer_id, source, category, status, subject, created_by_customer)
  VALUES (public.next_ticket_number(), v_cust, 'portal','warranty_claim','new',v_pfx||'garantia',true);
  v_health := public.erp_customer_portal_health_check(7);
  v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f WHERE f->>'code'='service_category_ticket_not_converted');
  v_report := v_report || jsonb_build_object('id','19_health_unconverted_service_cat','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  IF _cleanup THEN
    DELETE FROM public.partners WHERE id IN (v_cust, v_cust2);
  END IF;

  RETURN jsonb_build_object('phase','19-customer-portal-helpdesk','total',v_ok+v_fail,'passed',v_ok,'failed',v_fail,'tests',v_report);
END $function$;