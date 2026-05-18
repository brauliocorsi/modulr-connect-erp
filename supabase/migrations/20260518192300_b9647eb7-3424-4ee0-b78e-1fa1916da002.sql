-- F19-B (retry with extensions.* qualified)
CREATE SEQUENCE IF NOT EXISTS public.customer_ticket_seq START 1;

CREATE OR REPLACE FUNCTION public.next_ticket_number()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public AS $$
  SELECT 'TCK-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.customer_ticket_seq')::text, 6, '0')
$$;

CREATE TABLE IF NOT EXISTS public.customer_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL,
  scope text NOT NULL DEFAULT 'order_status',
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpt_scope_chk CHECK (scope IN ('order_status','service_case','ticket','delivery_schedule','general')),
  CONSTRAINT cpt_status_chk CHECK (status IN ('active','used','expired','revoked'))
);
CREATE INDEX IF NOT EXISTS idx_cpt_customer ON public.customer_portal_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_cpt_sale_order ON public.customer_portal_tokens(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_cpt_service_case ON public.customer_portal_tokens(service_case_id);

CREATE TABLE IF NOT EXISTS public.customer_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id) ON DELETE SET NULL,
  service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL,
  delivery_schedule_id uuid REFERENCES public.delivery_schedules(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'portal',
  category text NOT NULL DEFAULT 'general_question',
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'new',
  subject text NOT NULL,
  description text,
  assigned_to uuid,
  created_by_customer boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT ct_source_chk CHECK (source IN ('portal','helpdesk','delivery','inventory','internal')),
  CONSTRAINT ct_category_chk CHECK (category IN ('order_status','delivery_schedule','payment_question','damaged_product','missing_part','warranty_claim','return_request','complaint','general_question','other')),
  CONSTRAINT ct_priority_chk CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT ct_status_chk CHECK (status IN ('new','waiting_agent','waiting_customer','linked_to_service_case','resolved','closed','cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_ct_customer ON public.customer_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_ct_status ON public.customer_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ct_category ON public.customer_tickets(category);
CREATE INDEX IF NOT EXISTS idx_ct_service_case ON public.customer_tickets(service_case_id) WHERE service_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ct_sale_order ON public.customer_tickets(sale_order_id) WHERE sale_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.customer_tickets(id) ON DELETE CASCADE,
  sender_type text NOT NULL,
  sender_user_id uuid,
  customer_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  message text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ctm_sender_chk CHECK (sender_type IN ('customer','agent','system')),
  CONSTRAINT ctm_internal_chk CHECK (NOT (sender_type='customer' AND internal=true))
);
CREATE INDEX IF NOT EXISTS idx_ctm_ticket ON public.customer_ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.customer_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.customer_tickets(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.customer_ticket_messages(id) ON DELETE SET NULL,
  file_url text,
  file_name text NOT NULL,
  file_type text,
  attachment_type text NOT NULL DEFAULT 'other',
  uploaded_by_user_id uuid,
  uploaded_by_customer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cta_type_chk CHECK (attachment_type IN ('customer_photo','delivery_photo','document','evidence','other'))
);
CREATE INDEX IF NOT EXISTS idx_cta_ticket ON public.customer_ticket_attachments(ticket_id);

ALTER TABLE public.customer_portal_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tickets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ticket_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._portal_is_agent(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_groups ug
    JOIN public.groups g ON g.id=ug.group_id
    WHERE ug.user_id=_uid AND g.code IN ('system_admin','helpdesk_agent','sales_manager')
  );
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_portal_tokens' AND policyname='cpt_agent_read') THEN
    CREATE POLICY cpt_agent_read ON public.customer_portal_tokens FOR SELECT TO authenticated USING (public._portal_is_agent(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_tickets' AND policyname='ct_agent_read') THEN
    CREATE POLICY ct_agent_read ON public.customer_tickets FOR SELECT TO authenticated USING (public._portal_is_agent(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_ticket_messages' AND policyname='ctm_agent_read') THEN
    CREATE POLICY ctm_agent_read ON public.customer_ticket_messages FOR SELECT TO authenticated USING (public._portal_is_agent(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_ticket_attachments' AND policyname='cta_agent_read') THEN
    CREATE POLICY cta_agent_read ON public.customer_ticket_attachments FOR SELECT TO authenticated USING (public._portal_is_agent(auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._portal_hash_token(_token text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT encode(extensions.digest(_token, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public._portal_generate_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path=public AS $$
  SELECT encode(extensions.gen_random_bytes(24), 'hex');
$$;

CREATE OR REPLACE FUNCTION public._portal_resolve_token(_token text, _required_scope text DEFAULT NULL)
RETURNS public.customer_portal_tokens
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.customer_portal_tokens%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 16 THEN RAISE EXCEPTION 'portal: invalid_token'; END IF;
  SELECT * INTO v_row FROM public.customer_portal_tokens WHERE token_hash = public._portal_hash_token(_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'portal: invalid_token'; END IF;
  IF v_row.status = 'revoked' THEN RAISE EXCEPTION 'portal: token_revoked'; END IF;
  IF v_row.expires_at <= now() THEN RAISE EXCEPTION 'portal: token_expired'; END IF;
  IF _required_scope IS NOT NULL AND v_row.scope <> _required_scope AND v_row.scope <> 'general' THEN
    RAISE EXCEPTION 'portal: scope_mismatch (have=% need=%)', v_row.scope, _required_scope;
  END IF;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.customer_portal_validate_token(_token text, _scope text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.customer_portal_tokens%ROWTYPE;
BEGIN
  BEGIN v_row := public._portal_resolve_token(_token, _scope);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',SQLERRM); END;
  RETURN jsonb_build_object('ok',true,'customer_id',v_row.customer_id,'sale_order_id',v_row.sale_order_id,'service_case_id',v_row.service_case_id,'scope',v_row.scope,'expires_at',v_row.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public._portal_public_order_status(_state text, _op_status text, _fulfillment text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE
    WHEN _state IN ('cancel','cancelled') THEN 'Cancelada'
    WHEN _state = 'done' OR _fulfillment = 'delivered' THEN 'Entregue'
    WHEN _op_status = 'out_for_delivery' THEN 'Saiu para entrega'
    WHEN _op_status = 'scheduled' THEN 'Entrega agendada'
    WHEN _op_status = 'ready_delivery' THEN 'Pronta para agendamento'
    WHEN _op_status IN ('in_production','waiting_manufacturing') THEN 'Em produção'
    WHEN _op_status IN ('waiting_components','waiting_purchase') THEN 'Aguardando materiais'
    WHEN _state IN ('draft','sent','sale','confirmed') THEN 'Encomenda confirmada'
    ELSE 'Em processamento'
  END;
$$;

CREATE OR REPLACE FUNCTION public._portal_public_case_status(_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE _status
    WHEN 'new' THEN 'Pedido recebido'
    WHEN 'triage' THEN 'Em análise'
    WHEN 'waiting_photos' THEN 'Aguardando fotos/informação'
    WHEN 'waiting_supplier' THEN 'Aguardando peça'
    WHEN 'waiting_parts' THEN 'Aguardando peça'
    WHEN 'waiting_manufacturing' THEN 'Peça em produção'
    WHEN 'waiting_schedule' THEN 'Aguardando agendamento'
    WHEN 'scheduled' THEN 'Assistência agendada'
    WHEN 'in_route' THEN 'Técnico/entrega em rota'
    WHEN 'done' THEN 'Resolvido'
    WHEN 'cancelled' THEN 'Encerrado'
    WHEN 'rejected' THEN 'Encerrado'
    ELSE 'Em processamento'
  END;
$$;

CREATE OR REPLACE FUNCTION public.customer_portal_token_create(
  _customer_id uuid, _sale_order_id uuid DEFAULT NULL, _service_case_id uuid DEFAULT NULL,
  _scope text DEFAULT 'order_status', _expires_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token text; v_id uuid;
BEGIN
  IF _customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.partners WHERE id=_customer_id) THEN
    RAISE EXCEPTION 'portal_token_create: customer_not_found'; END IF;
  IF _sale_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sale_orders WHERE id=_sale_order_id AND partner_id=_customer_id) THEN
    RAISE EXCEPTION 'portal_token_create: sale_order_mismatch'; END IF;
  IF _service_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_cases WHERE id=_service_case_id AND customer_id=_customer_id) THEN
    RAISE EXCEPTION 'portal_token_create: service_case_mismatch'; END IF;
  v_token := public._portal_generate_token();
  INSERT INTO public.customer_portal_tokens(token_hash, customer_id, sale_order_id, service_case_id, scope, expires_at, created_by)
  VALUES (public._portal_hash_token(v_token), _customer_id, _sale_order_id, _service_case_id, _scope,
          COALESCE(_expires_at, now() + interval '30 days'), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id,'token',v_token,'scope',_scope);
END $$;

CREATE OR REPLACE FUNCTION public.customer_portal_order_status(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_so public.sale_orders%ROWTYPE;
        v_lines jsonb; v_cases jsonb; v_delivery text; v_payment text; v_customer text;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  IF v_tok.sale_order_id IS NULL THEN RAISE EXCEPTION 'portal: token_has_no_sale_order'; END IF;
  SELECT * INTO v_so FROM public.sale_orders WHERE id=v_tok.sale_order_id;
  IF v_so.partner_id <> v_tok.customer_id THEN RAISE EXCEPTION 'portal: token_customer_mismatch'; END IF;
  SELECT name INTO v_customer FROM public.partners WHERE id=v_so.partner_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity)),'[]'::jsonb)
    INTO v_lines FROM public.sale_order_lines l WHERE l.order_id=v_so.id AND COALESCE(l.line_kind,'product')='product';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('case_number',sc.case_number,'status',public._portal_public_case_status(sc.status::text))),'[]'::jsonb)
    INTO v_cases FROM public.service_cases sc WHERE sc.sale_order_id=v_so.id;
  SELECT CASE WHEN COUNT(*) FILTER (WHERE status='delivered')>0 THEN 'Entregue'
              WHEN COUNT(*) FILTER (WHERE status IN ('out_for_delivery','in_route'))>0 THEN 'Em rota'
              WHEN COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed'))>0 THEN 'Agendada'
              ELSE NULL END
    INTO v_delivery FROM public.delivery_schedules WHERE sale_order_id=v_so.id;
  v_payment := CASE v_so.payment_status
    WHEN 'paid' THEN 'Pago' WHEN 'partial' THEN 'Pago parcialmente'
    WHEN 'pending' THEN 'Pagamento pendente' WHEN 'overdue' THEN 'Pagamento em atraso'
    ELSE 'A confirmar' END;
  UPDATE public.customer_portal_tokens SET used_at=COALESCE(used_at, now()) WHERE id=v_tok.id;
  RETURN jsonb_build_object('ok',true,'order_number',v_so.name,'customer_name',v_customer,
    'products',v_lines,
    'public_status', public._portal_public_order_status(v_so.state::text, v_so.operational_status, v_so.fulfillment_status),
    'estimated_ready_date', v_so.expected_ready_date,
    'delivery_status', v_delivery, 'payment_status', v_payment, 'service_cases', v_cases);
END $$;

CREATE OR REPLACE FUNCTION public.customer_service_case_status(_token text, _service_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_sc public.service_cases%ROWTYPE;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  SELECT * INTO v_sc FROM public.service_cases WHERE id=_service_case_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal: case_not_found'; END IF;
  IF v_sc.customer_id <> v_tok.customer_id THEN RAISE EXCEPTION 'portal: case_customer_mismatch'; END IF;
  RETURN jsonb_build_object('ok',true,'case_number',v_sc.case_number,
    'status',public._portal_public_case_status(v_sc.status::text), 'opened_at',v_sc.created_at);
END $$;

CREATE OR REPLACE FUNCTION public.customer_ticket_create(_token text, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_id uuid; v_cat text;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  v_cat := COALESCE(_payload->>'category','general_question');
  INSERT INTO public.customer_tickets(
    ticket_number, customer_id, sale_order_id, sale_order_line_id, service_case_id, delivery_schedule_id,
    source, category, priority, status, subject, description, created_by_customer
  ) VALUES (
    public.next_ticket_number(), v_tok.customer_id,
    COALESCE(NULLIF(_payload->>'sale_order_id','')::uuid, v_tok.sale_order_id),
    NULLIF(_payload->>'sale_order_line_id','')::uuid,
    COALESCE(NULLIF(_payload->>'service_case_id','')::uuid, v_tok.service_case_id),
    NULLIF(_payload->>'delivery_schedule_id','')::uuid,
    'portal', v_cat, COALESCE(_payload->>'priority','normal'), 'new',
    COALESCE(_payload->>'subject','(sem assunto)'), _payload->>'description', true
  ) RETURNING id INTO v_id;
  IF _payload->>'description' IS NOT NULL THEN
    INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, customer_id, message, internal)
    VALUES (v_id, 'customer', v_tok.customer_id, _payload->>'description', false);
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.customer_ticket_add_message(_token text, _ticket_id uuid, _message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_t public.customer_tickets%ROWTYPE; v_id uuid;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id;
  IF NOT FOUND OR v_t.customer_id <> v_tok.customer_id THEN RAISE EXCEPTION 'portal: ticket_access_denied'; END IF;
  IF v_t.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'portal: ticket_closed'; END IF;
  INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, customer_id, message, internal)
  VALUES (_ticket_id,'customer',v_tok.customer_id,_message,false) RETURNING id INTO v_id;
  UPDATE public.customer_tickets SET status='waiting_agent', updated_at=now() WHERE id=_ticket_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.customer_ticket_add_attachment_metadata(_token text, _ticket_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_t public.customer_tickets%ROWTYPE; v_id uuid;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id;
  IF NOT FOUND OR v_t.customer_id <> v_tok.customer_id THEN RAISE EXCEPTION 'portal: ticket_access_denied'; END IF;
  INSERT INTO public.customer_ticket_attachments(ticket_id, message_id, file_url, file_name, file_type, attachment_type, uploaded_by_customer)
  VALUES (_ticket_id, NULLIF(_payload->>'message_id','')::uuid, _payload->>'file_url',
          COALESCE(_payload->>'file_name','file'), _payload->>'file_type',
          COALESCE(_payload->>'attachment_type','customer_photo'), true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.customer_ticket_close(_token text, _ticket_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_t public.customer_tickets%ROWTYPE;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id;
  IF NOT FOUND OR v_t.customer_id <> v_tok.customer_id THEN RAISE EXCEPTION 'portal: ticket_access_denied'; END IF;
  IF v_t.status = 'linked_to_service_case' THEN RAISE EXCEPTION 'portal: cannot_close_when_linked_to_service_case'; END IF;
  UPDATE public.customer_tickets SET status='cancelled', closed_at=now(), updated_at=now() WHERE id=_ticket_id;
  IF _reason IS NOT NULL THEN
    INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, customer_id, message, internal)
    VALUES (_ticket_id,'system',v_tok.customer_id,'Encerrado pelo cliente: '||_reason,false);
  END IF;
  RETURN jsonb_build_object('ok',true,'ticket_id',_ticket_id,'status','cancelled');
END $$;

CREATE OR REPLACE FUNCTION public.customer_delivery_request_schedule(
  _token text, _sale_order_id uuid, _preferred_date date, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_id uuid;
BEGIN
  v_tok := public._portal_resolve_token(_token, NULL);
  IF NOT EXISTS(SELECT 1 FROM public.sale_orders WHERE id=_sale_order_id AND partner_id=v_tok.customer_id) THEN
    RAISE EXCEPTION 'portal: sale_order_access_denied'; END IF;
  INSERT INTO public.customer_tickets(
    ticket_number, customer_id, sale_order_id, source, category, status, subject, description, created_by_customer
  ) VALUES (
    public.next_ticket_number(), v_tok.customer_id, _sale_order_id, 'portal', 'delivery_schedule', 'new',
    'Pedido de agendamento de entrega',
    format('Data preferida: %s%s', _preferred_date, COALESCE(' — '||_notes,'')), true
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_add_message(_ticket_id uuid, _message text, _internal boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_t public.customer_tickets%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'helpdesk: ticket_not_found'; END IF;
  INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, sender_user_id, customer_id, message, internal)
  VALUES (_ticket_id,'agent',auth.uid(),v_t.customer_id,_message,_internal) RETURNING id INTO v_id;
  IF NOT _internal THEN
    UPDATE public.customer_tickets SET status='waiting_customer', updated_at=now() WHERE id=_ticket_id;
  ELSE
    UPDATE public.customer_tickets SET updated_at=now() WHERE id=_ticket_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_assign(_ticket_id uuid, _assigned_to uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.customer_tickets WHERE id=_ticket_id) THEN
    RAISE EXCEPTION 'helpdesk: ticket_not_found'; END IF;
  UPDATE public.customer_tickets SET assigned_to=_assigned_to, updated_at=now() WHERE id=_ticket_id;
  RETURN jsonb_build_object('ok',true,'ticket_id',_ticket_id,'assigned_to',_assigned_to);
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_close(_ticket_id uuid, _resolution text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_t public.customer_tickets%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.customer_tickets WHERE id=_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'helpdesk: ticket_not_found'; END IF;
  UPDATE public.customer_tickets SET status='closed', closed_at=now(), updated_at=now() WHERE id=_ticket_id;
  INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, sender_user_id, customer_id, message, internal)
  VALUES (_ticket_id,'agent',auth.uid(),v_t.customer_id, COALESCE(_resolution,'Encerrado'), false);
  RETURN jsonb_build_object('ok',true,'ticket_id',_ticket_id,'status','closed');
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_convert_to_service_case(_ticket_id uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
    WHEN 'damaged_product' THEN 'damage'
    WHEN 'missing_part' THEN 'missing_part'
    WHEN 'warranty_claim' THEN 'warranty'
    WHEN 'return_request' THEN 'return'
    ELSE 'other' END;
  v_p := jsonb_build_object(
    'customer_id', v_t.customer_id, 'sale_order_id', v_t.sale_order_id,
    'sale_order_line_id', v_t.sale_order_line_id, 'delivery_schedule_id', v_t.delivery_schedule_id,
    'case_type', v_case_type, 'source', 'customer_portal', 'priority', v_t.priority,
    'description', v_t.subject, 'customer_notes', v_t.description
  ) || COALESCE(_payload,'{}'::jsonb);
  v_case := public.service_case_create(v_p);
  UPDATE public.customer_tickets SET service_case_id=v_case, status='linked_to_service_case', updated_at=now() WHERE id=_ticket_id;
  INSERT INTO public.customer_ticket_messages(ticket_id, sender_type, sender_user_id, customer_id, message, internal)
  VALUES (_ticket_id,'system',auth.uid(),v_t.customer_id,'Convertido em service case', true);
  RETURN v_case;
END $$;

CREATE OR REPLACE FUNCTION public.erp_customer_portal_health_check(_threshold_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_findings jsonb := '[]'::jsonb; v_p0 int:=0; v_p1 int:=0; v_p2 int:=0; r record;
BEGIN
  FOR r IN SELECT t.id FROM public.customer_portal_tokens t LEFT JOIN public.partners p ON p.id=t.customer_id
           WHERE t.status='active' AND p.id IS NULL LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','active_token_for_deleted_customer','token_id',r.id); v_p0:=v_p0+1; END LOOP;
  FOR r IN SELECT id, scope FROM public.customer_portal_tokens
           WHERE scope NOT IN ('order_status','service_case','ticket','delivery_schedule','general') LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','portal_token_scope_mismatch','token_id',r.id); v_p0:=v_p0+1; END LOOP;
  FOR r IN SELECT t.id FROM public.customer_tickets t LEFT JOIN public.sale_orders s ON s.id=t.sale_order_id
           WHERE t.sale_order_id IS NOT NULL AND s.id IS NULL LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','ticket_linked_to_missing_order','ticket_id',r.id); v_p0:=v_p0+1; END LOOP;
  FOR r IN SELECT id FROM public.customer_tickets WHERE status='linked_to_service_case' AND service_case_id IS NULL LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','ticket_converted_missing_service_case','ticket_id',r.id); v_p0:=v_p0+1; END LOOP;
  FOR r IN SELECT id FROM public.customer_tickets
           WHERE status IN ('new','waiting_agent') AND created_at < now() - (_threshold_days||' days')::interval LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P1','code','customer_ticket_open_too_long','ticket_id',r.id); v_p1:=v_p1+1; END LOOP;
  FOR r IN SELECT id FROM public.customer_tickets WHERE status='waiting_customer' AND updated_at < now() - (_threshold_days||' days')::interval LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P1','code','ticket_waiting_customer_too_long','ticket_id',r.id); v_p1:=v_p1+1; END LOOP;
  FOR r IN SELECT id, category FROM public.customer_tickets
           WHERE category IN ('damaged_product','missing_part','warranty_claim','return_request')
             AND service_case_id IS NULL AND status NOT IN ('cancelled','closed') LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P1','code','service_category_ticket_not_converted','ticket_id',r.id,'category',r.category); v_p1:=v_p1+1; END LOOP;
  FOR r IN SELECT a.id FROM public.customer_ticket_attachments a LEFT JOIN public.customer_tickets t ON t.id=a.ticket_id
           WHERE t.id IS NULL LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P1','code','portal_attachment_without_ticket','attachment_id',r.id); v_p1:=v_p1+1; END LOOP;
  FOR r IN SELECT id FROM public.customer_portal_tokens WHERE status='active' AND expires_at <= now() LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P2','code','expired_tokens_not_revoked','token_id',r.id); v_p2:=v_p2+1; END LOOP;
  FOR r IN SELECT id FROM public.customer_tickets WHERE assigned_to IS NULL AND status IN ('new','waiting_agent') AND created_at < now() - interval '1 day' LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P2','code','tickets_without_assignment','ticket_id',r.id); v_p2:=v_p2+1; END LOOP;
  FOR r IN SELECT t.id FROM public.customer_tickets t
           WHERE t.status='new' AND NOT EXISTS(SELECT 1 FROM public.customer_ticket_messages m WHERE m.ticket_id=t.id AND m.sender_type='agent')
             AND t.created_at < now() - interval '2 days' LIMIT 50 LOOP
    v_findings := v_findings || jsonb_build_object('severity','P2','code','customer_ticket_without_response','ticket_id',r.id); v_p2:=v_p2+1; END LOOP;
  RETURN jsonb_build_object('ok',true,'summary',jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'total',v_p0+v_p1+v_p2),'findings',v_findings);
END $$;

CREATE OR REPLACE FUNCTION public.erp_health_check_run(_threshold_days integer DEFAULT 7)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_result jsonb; v_shopfloor jsonb; v_service jsonb; v_portal jsonb;
  v_findings jsonb; v_summary jsonb;
  v_p0 int; v_p1 int; v_p2 int; v_p3 int;
  v_log_id uuid; v_admin record; v_critical int;
BEGIN
  v_result    := public.erp_health_check(_threshold_days);
  v_shopfloor := public.erp_health_check_shopfloor(_threshold_days);
  v_service   := public.erp_service_health_check(_threshold_days);
  v_portal    := public.erp_customer_portal_health_check(_threshold_days);
  v_findings := COALESCE(v_result->'findings','[]'::jsonb)
              || COALESCE(v_shopfloor->'findings','[]'::jsonb)
              || COALESCE(v_service->'findings','[]'::jsonb)
              || COALESCE(v_portal->'findings','[]'::jsonb);
  v_p0 := COALESCE((v_result->'summary'->>'p0')::int,0)+COALESCE((v_shopfloor->>'p0')::int,0)+COALESCE((v_service->'summary'->>'p0')::int,0)+COALESCE((v_portal->'summary'->>'p0')::int,0);
  v_p1 := COALESCE((v_result->'summary'->>'p1')::int,0)+COALESCE((v_shopfloor->>'p1')::int,0)+COALESCE((v_service->'summary'->>'p1')::int,0)+COALESCE((v_portal->'summary'->>'p1')::int,0);
  v_p2 := COALESCE((v_result->'summary'->>'p2')::int,0)+COALESCE((v_shopfloor->>'p2')::int,0)+COALESCE((v_service->'summary'->>'p2')::int,0)+COALESCE((v_portal->'summary'->>'p2')::int,0);
  v_p3 := COALESCE((v_result->'summary'->>'p3')::int,0);
  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', COALESCE((v_result->'summary'->>'duration_ms')::int,0),
    'portal_p0', COALESCE((v_portal->'summary'->>'p0')::int,0),
    'portal_p1', COALESCE((v_portal->'summary'->>'p1')::int,0),
    'portal_p2', COALESCE((v_portal->'summary'->>'p2')::int,0));
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