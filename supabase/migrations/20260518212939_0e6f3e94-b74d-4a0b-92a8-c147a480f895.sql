CREATE OR REPLACE FUNCTION public._test_phase19_customer_portal_helpdesk()
RETURNS TABLE(check_name text, ok boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pfx text := 'F19B_'||substr(md5(random()::text),1,6)||'_';
  v_cust uuid; v_cust2 uuid; v_so uuid; v_so2 uuid; v_prod uuid;
  v_token text; v_token2 text;
  v_ticket uuid; v_ticket_general uuid; v_msg uuid; v_att uuid;
  v_case uuid; v_case2 uuid;
  v_portal_data jsonb;
BEGIN
  INSERT INTO public.partners(name, partner_kind) VALUES (v_pfx||'Cust A', 'individual'::partner_kind) RETURNING id INTO v_cust;
  INSERT INTO public.partners(name, partner_kind) VALUES (v_pfx||'Cust B', 'individual'::partner_kind) RETURNING id INTO v_cust2;
  INSERT INTO public.products(name, sku, type) VALUES (v_pfx||'Prod', v_pfx||'SKU', 'product') RETURNING id INTO v_prod;
  INSERT INTO public.sale_orders(name, partner_id, state) VALUES (v_pfx||'SO-A', v_cust, 'confirmed'::sale_state) RETURNING id INTO v_so;
  INSERT INTO public.sale_orders(name, partner_id, state) VALUES (v_pfx||'SO-B', v_cust2, 'confirmed'::sale_state) RETURNING id INTO v_so2;
  INSERT INTO public.sale_order_lines(order_id, product_id, description, quantity, line_kind)
    VALUES (v_so, v_prod, v_pfx||'L', 1, 'product');

  -- issue tokens
  SELECT (public.portal_issue_token(v_so))->>'token' INTO v_token;
  SELECT (public.portal_issue_token(v_so2))->>'token' INTO v_token2;

  check_name:='token_issued'; ok:= v_token IS NOT NULL AND length(v_token)>=32; detail:=coalesce(v_token,'null'); RETURN NEXT;

  -- portal can read its own SO
  v_portal_data := public.portal_get_sale_order(v_token);
  check_name:='portal_get_self'; ok:= (v_portal_data->>'id')::uuid = v_so; detail:= v_portal_data::text; RETURN NEXT;

  -- portal cannot read other SO with own token
  BEGIN
    PERFORM public.portal_get_sale_order_by_id(v_token, v_so2);
    check_name:='portal_cross_blocked'; ok:=false; detail:='should have raised'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_name:='portal_cross_blocked'; ok:=true; detail:=SQLERRM; RETURN NEXT;
  END;

  -- portal creates ticket (damaged_product)
  v_ticket := (public.portal_create_ticket(v_token, 'damaged_product', v_pfx||'broken arrived', 'Arrived broken'))::uuid;
  check_name:='ticket_created_damaged'; ok:= v_ticket IS NOT NULL; detail:= v_ticket::text; RETURN NEXT;

  -- portal creates ticket (general_question)
  v_ticket_general := (public.portal_create_ticket(v_token, 'general_question', v_pfx||'q', 'just a question'))::uuid;
  check_name:='ticket_created_general'; ok:= v_ticket_general IS NOT NULL; detail:= v_ticket_general::text; RETURN NEXT;

  -- portal posts message + attachment metadata
  v_msg := (public.portal_post_message(v_token, v_ticket, 'photo attached'))::uuid;
  check_name:='portal_message_posted'; ok:= v_msg IS NOT NULL; detail:=v_msg::text; RETURN NEXT;

  v_att := (public.portal_attach_metadata(v_token, v_msg, 'photo.jpg', 'image/jpeg', 12345))::uuid;
  check_name:='attachment_metadata'; ok:= v_att IS NOT NULL; detail:=v_att::text; RETURN NEXT;

  -- internal note added by agent must NOT appear in portal view
  PERFORM public.helpdesk_post_internal_note(v_ticket, 'SECRET internal');
  check_name:='internal_note_hidden'; ok:= NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.portal_get_ticket(v_token, v_ticket)->'messages') m
    WHERE m->>'body' ILIKE '%SECRET internal%'
  ); detail:='checked portal view'; RETURN NEXT;

  -- helpdesk agent replies
  PERFORM public.helpdesk_reply(v_ticket, 'we will handle this');
  check_name:='agent_reply'; ok:= EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.portal_get_ticket(v_token, v_ticket)->'messages') m
    WHERE m->>'body' ILIKE '%we will handle this%'
  ); detail:='checked portal view'; RETURN NEXT;

  -- convert damaged_product ticket to service_case
  v_case := (public.helpdesk_convert_to_service_case(v_ticket))::uuid;
  check_name:='convert_damaged_to_case'; ok:= v_case IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.service_cases WHERE id=v_case AND customer_id=v_cust AND sale_order_id=v_so);
  detail:= v_case::text; RETURN NEXT;

  -- idempotency: second conversion returns same case
  v_case2 := (public.helpdesk_convert_to_service_case(v_ticket))::uuid;
  check_name:='convert_idempotent'; ok:= v_case2 = v_case; detail:= v_case2::text; RETURN NEXT;

  -- general_question does NOT auto-convert
  BEGIN
    PERFORM public.helpdesk_convert_to_service_case(v_ticket_general);
    check_name:='general_not_converted'; ok:=false; detail:='should refuse'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    check_name:='general_not_converted'; ok:=true; detail:=SQLERRM; RETURN NEXT;
  END;

  -- health checks
  check_name:='health_portal'; ok:= (public.health_check_portal()->>'ok')::bool; detail:=public.health_check_portal()::text; RETURN NEXT;
  check_name:='health_helpdesk'; ok:= (public.health_check_helpdesk()->>'ok')::bool; detail:=public.health_check_helpdesk()::text; RETURN NEXT;
END;
$fn$;