-- 1) Realtime for chat
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_threads REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_threads;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 2) Internal helpdesk ticket creation RPC (staff/agent)
CREATE OR REPLACE FUNCTION public.helpdesk_ticket_create(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_customer uuid;
  v_subject text;
  v_description text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'helpdesk: not_authenticated';
  END IF;
  IF NOT public._portal_is_agent(v_uid) THEN
    RAISE EXCEPTION 'helpdesk: not_authorized';
  END IF;

  v_customer := NULLIF(_payload->>'customer_id','')::uuid;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'helpdesk: customer_id_required';
  END IF;

  v_subject := COALESCE(NULLIF(_payload->>'subject',''), '(sem assunto)');
  v_description := _payload->>'description';

  INSERT INTO public.customer_tickets(
    ticket_number, customer_id, sale_order_id, sale_order_line_id, service_case_id, delivery_schedule_id,
    source, category, priority, status, subject, description, created_by_customer, created_by, assigned_to
  ) VALUES (
    public.next_ticket_number(),
    v_customer,
    NULLIF(_payload->>'sale_order_id','')::uuid,
    NULLIF(_payload->>'sale_order_line_id','')::uuid,
    NULLIF(_payload->>'service_case_id','')::uuid,
    NULLIF(_payload->>'delivery_schedule_id','')::uuid,
    COALESCE(NULLIF(_payload->>'source',''), 'agent'),
    COALESCE(NULLIF(_payload->>'category',''), 'general_question'),
    COALESCE(NULLIF(_payload->>'priority',''), 'normal'),
    'new',
    v_subject,
    v_description,
    false,
    v_uid,
    COALESCE(NULLIF(_payload->>'assigned_to','')::uuid, v_uid)
  ) RETURNING id INTO v_id;

  IF v_description IS NOT NULL AND length(trim(v_description)) > 0 THEN
    INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, sender_user_id, message, internal)
    VALUES (v_id, 'agent', v_uid, v_description, COALESCE((_payload->>'internal')::boolean, false));
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.helpdesk_ticket_create(jsonb) TO authenticated;