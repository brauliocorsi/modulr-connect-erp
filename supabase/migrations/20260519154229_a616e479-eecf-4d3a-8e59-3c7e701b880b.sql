CREATE OR REPLACE FUNCTION public.helpdesk_ticket_convert_to_service_case(_ticket_id uuid, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t public.customer_tickets%ROWTYPE; v_case uuid; v_case_type text; v_p jsonb;
BEGIN
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'helpdesk: ticket_not_found'; END IF;
  IF v_t.service_case_id IS NOT NULL THEN RETURN v_t.service_case_id; END IF;
  IF v_t.category NOT IN ('damaged_product','missing_part','warranty_claim','return_request','complaint') THEN
    IF NOT COALESCE((_payload->>'force')::boolean,false) THEN
      RAISE EXCEPTION 'helpdesk: category_not_convertible (%) — pass force=true to override', v_t.category;
    END IF;
  END IF;
  v_case_type := CASE v_t.category
    WHEN 'damaged_product' THEN 'damaged_return'
    WHEN 'missing_part' THEN 'missing_part'
    WHEN 'warranty_claim' THEN 'warranty'
    WHEN 'return_request' THEN 'customer_claim'
    WHEN 'complaint' THEN 'customer_claim'
    ELSE 'other' END;
  v_p := jsonb_build_object(
    'customer_id', v_t.customer_id, 'sale_order_id', v_t.sale_order_id,
    'sale_order_line_id', v_t.sale_order_line_id, 'delivery_schedule_id', v_t.delivery_schedule_id,
    'case_type', v_case_type, 'source', 'customer', 'priority', v_t.priority,
    'description', v_t.subject, 'customer_notes', v_t.description
  ) || COALESCE(_payload,'{}'::jsonb);
  v_case := public.service_case_create(v_p);
  UPDATE public.customer_tickets SET service_case_id=v_case, status='linked_to_service_case', updated_at=now() WHERE id=_ticket_id;
  INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, sender_user_id, customer_id, message, internal)
  VALUES (_ticket_id,'system',auth.uid(),v_t.customer_id,'Convertido em service case', true);
  RETURN v_case;
END $function$;