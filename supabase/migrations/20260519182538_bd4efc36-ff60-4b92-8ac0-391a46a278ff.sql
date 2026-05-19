
-- =========================================================================
-- F21-B — Comunicação / Notificações / Timeline Backend
-- =========================================================================

-- 1) Augment notifications (additive only)
ALTER TABLE public.notifications
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_group text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notif_recipient_chk') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notif_recipient_chk
      CHECK (user_id IS NOT NULL OR recipient_group IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notif_severity_chk') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notif_severity_chk
      CHECK (severity IN ('info','warning','critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notif_status_chk') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notif_status_chk
      CHECK (status IN ('unread','read','dismissed'));
  END IF;
END $$;

-- 2) notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app','email_future','whatsapp_future','push_future')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, channel)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY np_own ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_group(auth.uid(),'system_admin'));

-- 3) notification_delivery_log
CREATE TABLE IF NOT EXISTS public.notification_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL,
  status text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  error_message text
);
ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ndl_admin ON public.notification_delivery_log FOR ALL TO authenticated
  USING (public.has_group(auth.uid(),'system_admin')) WITH CHECK (public.has_group(auth.uid(),'system_admin'));

-- 4) activity_events
CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  actor_type text NOT NULL DEFAULT 'user',
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer_visible','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_events_entity ON public.activity_events(entity_type, entity_id, created_at DESC);
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ae_select ON public.activity_events FOR SELECT TO authenticated USING (true);
CREATE POLICY ae_insert ON public.activity_events FOR INSERT TO authenticated WITH CHECK (true);
-- append-only: no update/delete policies

-- 5) erp_tasks
CREATE TABLE IF NOT EXISTS public.erp_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  assigned_to uuid,
  assigned_group text,
  created_by uuid,
  entity_type text,
  entity_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT et_assignee_chk CHECK (assigned_to IS NOT NULL OR assigned_group IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_erp_tasks_assignee ON public.erp_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_erp_tasks_entity ON public.erp_tasks(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_erp_tasks_due ON public.erp_tasks(due_date) WHERE status IN ('open','in_progress','blocked');
ALTER TABLE public.erp_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY et_select ON public.erp_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY et_modify ON public.erp_tasks FOR ALL TO authenticated
  USING (assigned_to = auth.uid() OR created_by = auth.uid() OR public.has_group(auth.uid(),'system_admin'))
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tg_erp_tasks_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_erp_tasks_touch ON public.erp_tasks;
CREATE TRIGGER trg_erp_tasks_touch BEFORE UPDATE ON public.erp_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_erp_tasks_touch();

-- 6) conversation_threads
CREATE TABLE IF NOT EXISTS public.conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,
  entity_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer_visible','mixed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text
);
CREATE INDEX IF NOT EXISTS idx_conv_threads_entity ON public.conversation_threads(entity_type, entity_id);
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_all ON public.conversation_threads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7) conversation_participants
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  user_id uuid,
  partner_id uuid,
  participant_type text NOT NULL CHECK (participant_type IN ('internal_user','customer','supplier','system')),
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT cp_who_chk CHECK (user_id IS NOT NULL OR partner_id IS NOT NULL OR participant_type='system')
);
CREATE INDEX IF NOT EXISTS idx_cp_thread ON public.conversation_participants(thread_id);
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_all ON public.conversation_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8) conversation_messages
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  sender_user_id uuid,
  sender_partner_id uuid,
  sender_type text NOT NULL CHECK (sender_type IN ('user','customer','supplier','system')),
  message text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer_visible','supplier_visible')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cm_thread ON public.conversation_messages(thread_id, created_at);
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY cm_select ON public.conversation_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY cm_insert ON public.conversation_messages FOR INSERT TO authenticated WITH CHECK (true);
-- append-only: no update/delete

-- 9) conversation_attachments
CREATE TABLE IF NOT EXISTS public.conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  file_url text,
  file_name text,
  file_type text,
  attachment_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_all ON public.conversation_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================================
-- RPCs
-- =========================================================================

-- Notifications -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_create(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid := NULLIF(_payload->>'recipient_user_id','')::uuid;
  v_group text := NULLIF(_payload->>'recipient_group','');
  v_id uuid;
  v_cat text := COALESCE(_payload->>'category','system');
  v_mod public.app_module;
BEGIN
  IF v_user IS NULL AND v_group IS NULL THEN
    RAISE EXCEPTION 'notification requires recipient_user_id or recipient_group';
  END IF;
  -- map category -> module enum (fallback core)
  BEGIN v_mod := v_cat::public.app_module; EXCEPTION WHEN OTHERS THEN v_mod := 'core'::public.app_module; END;

  IF v_group IS NOT NULL AND v_user IS NULL THEN
    -- expand group -> per-user notifications
    INSERT INTO public.notifications
      (user_id, recipient_group, module, type, title, body, severity, category, status, action_url, metadata, priority, entity_type, entity_id)
    SELECT ug.user_id, v_group, v_mod,
      COALESCE(_payload->>'type','generic'),
      COALESCE(_payload->>'title','(sem título)'),
      _payload->>'body',
      COALESCE(_payload->>'severity','info'),
      v_cat, 'unread',
      _payload->>'action_url',
      COALESCE(_payload->'metadata','{}'::jsonb),
      COALESCE(_payload->>'severity','normal'),
      _payload->>'entity_type',
      NULLIF(_payload->>'entity_id','')::uuid
    FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id
    WHERE g.code = v_group
    RETURNING id INTO v_id;
    -- if no group members, still create a placeholder for the group
    IF v_id IS NULL THEN
      INSERT INTO public.notifications
        (user_id, recipient_group, module, type, title, body, severity, category, status, action_url, metadata, priority, entity_type, entity_id)
      VALUES (NULL, v_group, v_mod,
        COALESCE(_payload->>'type','generic'),
        COALESCE(_payload->>'title','(sem título)'),
        _payload->>'body',
        COALESCE(_payload->>'severity','info'),
        v_cat, 'unread',
        _payload->>'action_url',
        COALESCE(_payload->'metadata','{}'::jsonb),
        COALESCE(_payload->>'severity','normal'),
        _payload->>'entity_type',
        NULLIF(_payload->>'entity_id','')::uuid)
      RETURNING id INTO v_id;
    END IF;
  ELSE
    INSERT INTO public.notifications
      (user_id, recipient_group, module, type, title, body, severity, category, status, action_url, metadata, priority, entity_type, entity_id)
    VALUES (v_user, v_group, v_mod,
      COALESCE(_payload->>'type','generic'),
      COALESCE(_payload->>'title','(sem título)'),
      _payload->>'body',
      COALESCE(_payload->>'severity','info'),
      v_cat, 'unread',
      _payload->>'action_url',
      COALESCE(_payload->'metadata','{}'::jsonb),
      COALESCE(_payload->>'severity','normal'),
      _payload->>'entity_type',
      NULLIF(_payload->>'entity_id','')::uuid)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.notification_mark_read(_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  UPDATE public.notifications
     SET status='read', read_at=COALESCE(read_at, now())
   WHERE id=_notification_id
     AND (user_id=v_uid OR public.has_group(v_uid,'system_admin'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification not found or not allowed';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', _notification_id);
END $$;

CREATE OR REPLACE FUNCTION public.notification_mark_all_read(_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  UPDATE public.notifications
     SET status='read', read_at=COALESCE(read_at, now())
   WHERE user_id=v_uid AND status='unread'
     AND (_category IS NULL OR category=_category);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.notification_list_for_user(_category text DEFAULT NULL, _status text DEFAULT NULL, _limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO v
  FROM (
    SELECT * FROM public.notifications
     WHERE (user_id = v_uid
            OR recipient_group IN (SELECT g.code FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id WHERE ug.user_id=v_uid))
       AND (_category IS NULL OR category=_category)
       AND (_status IS NULL OR status=_status)
     ORDER BY created_at DESC LIMIT _limit
  ) n;
  RETURN v;
END $$;

-- Activity ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activity_log_event(
  _entity_type text, _entity_id uuid, _event_type text, _message text,
  _metadata jsonb DEFAULT '{}'::jsonb, _visibility text DEFAULT 'internal')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF _entity_type IS NULL OR _entity_id IS NULL THEN
    RAISE EXCEPTION 'activity requires entity_type and entity_id';
  END IF;
  INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
  VALUES (_entity_type, _entity_id, _event_type, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
          _message, COALESCE(_metadata,'{}'::jsonb), COALESCE(_visibility,'internal'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.activity_list_for_entity(
  _entity_type text, _entity_id uuid, _include_customer_visible boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM public.activity_events
     WHERE entity_type=_entity_type AND entity_id=_entity_id
       AND (_include_customer_visible OR visibility <> 'customer_visible' OR visibility='customer_visible')
     ORDER BY created_at DESC
  ) a;
  RETURN v;
END $$;

-- Tasks ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_task_create(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.erp_tasks(
    title, description, assigned_to, assigned_group, created_by,
    entity_type, entity_id, status, priority, due_date, metadata)
  VALUES (
    COALESCE(_payload->>'title','(sem título)'),
    _payload->>'description',
    NULLIF(_payload->>'assigned_to','')::uuid,
    NULLIF(_payload->>'assigned_group',''),
    auth.uid(),
    _payload->>'entity_type',
    NULLIF(_payload->>'entity_id','')::uuid,
    COALESCE(_payload->>'status','open'),
    COALESCE(_payload->>'priority','normal'),
    NULLIF(_payload->>'due_date','')::timestamptz,
    COALESCE(_payload->'metadata','{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.erp_task_assign(_task_id uuid, _assigned_to uuid, _assigned_group text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.erp_tasks SET assigned_to=_assigned_to, assigned_group=_assigned_group WHERE id=_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  RETURN jsonb_build_object('ok',true,'id',_task_id);
END $$;

CREATE OR REPLACE FUNCTION public.erp_task_start(_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.erp_tasks SET status='in_progress'
   WHERE id=_task_id AND status IN ('open','blocked');
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot start task'; END IF;
  RETURN jsonb_build_object('ok',true,'id',_task_id);
END $$;

CREATE OR REPLACE FUNCTION public.erp_task_complete(_task_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.erp_tasks WHERE id=_task_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;
  IF v_status='cancelled' THEN RAISE EXCEPTION 'cannot complete cancelled task'; END IF;
  UPDATE public.erp_tasks
     SET status='done', completed_at=now(),
         metadata = metadata || jsonb_build_object('completion_notes', _notes)
   WHERE id=_task_id;
  RETURN jsonb_build_object('ok',true,'id',_task_id);
END $$;

CREATE OR REPLACE FUNCTION public.erp_task_cancel(_task_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _reason IS NULL OR length(trim(_reason))=0 THEN RAISE EXCEPTION 'cancel reason required'; END IF;
  UPDATE public.erp_tasks SET status='cancelled', cancelled_at=now(), cancel_reason=_reason
   WHERE id=_task_id AND status <> 'done';
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot cancel task'; END IF;
  RETURN jsonb_build_object('ok',true,'id',_task_id);
END $$;

CREATE OR REPLACE FUNCTION public.erp_task_list_for_user(_status text DEFAULT NULL, _limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb) INTO v
  FROM (
    SELECT * FROM public.erp_tasks
     WHERE (assigned_to=v_uid
            OR assigned_group IN (SELECT g.code FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id WHERE ug.user_id=v_uid))
       AND (_status IS NULL OR status=_status)
     ORDER BY created_at DESC LIMIT _limit
  ) t;
  RETURN v;
END $$;

-- Conversations ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversation_create(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.conversation_threads(entity_type, entity_id, title, status, visibility, created_by)
  VALUES (
    _payload->>'entity_type',
    NULLIF(_payload->>'entity_id','')::uuid,
    COALESCE(_payload->>'title','(sem título)'),
    COALESCE(_payload->>'status','open'),
    COALESCE(_payload->>'visibility','internal'),
    auth.uid()
  ) RETURNING id INTO v_id;
  -- creator becomes participant
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.conversation_participants(thread_id, user_id, participant_type, role)
    VALUES (v_id, auth.uid(), 'internal_user', 'owner');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_add_participant(_thread_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.conversation_participants(thread_id, user_id, partner_id, participant_type, role)
  VALUES (
    _thread_id,
    NULLIF(_payload->>'user_id','')::uuid,
    NULLIF(_payload->>'partner_id','')::uuid,
    COALESCE(_payload->>'participant_type','internal_user'),
    COALESCE(_payload->>'role','member')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_add_message(
  _thread_id uuid, _message text, _visibility text DEFAULT 'internal', _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF _message IS NULL OR length(trim(_message))=0 THEN RAISE EXCEPTION 'message required'; END IF;
  INSERT INTO public.conversation_messages(thread_id, sender_user_id, sender_type, message, visibility, metadata)
  VALUES (_thread_id, v_uid, CASE WHEN v_uid IS NULL THEN 'system' ELSE 'user' END,
          _message, COALESCE(_visibility,'internal'), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_list_for_entity(_entity_type text, _entity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb) INTO v
  FROM (SELECT * FROM public.conversation_threads WHERE entity_type=_entity_type AND entity_id=_entity_id ORDER BY created_at DESC) t;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_messages(_thread_id uuid, _visibility_filter text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM public.conversation_messages
     WHERE thread_id=_thread_id
       AND (_visibility_filter IS NULL OR visibility=_visibility_filter)
     ORDER BY created_at
  ) m;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.conversation_close(_thread_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.conversation_threads SET status='closed', closed_at=now(), close_reason=_reason WHERE id=_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread not found'; END IF;
  RETURN jsonb_build_object('ok',true,'id',_thread_id);
END $$;

-- =========================================================================
-- Integration triggers (auto activity + notification)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tg_customer_ticket_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
  VALUES ('customer_ticket', NEW.id, 'ticket_created', NEW.created_by,
          CASE WHEN NEW.created_by_customer THEN 'customer' ELSE 'user' END,
          format('Ticket %s criado: %s', NEW.ticket_number, NEW.subject),
          jsonb_build_object('category', NEW.category, 'priority', NEW.priority), 'internal');
  -- notify service_support group
  PERFORM public.notification_create(jsonb_build_object(
    'recipient_group','service_support',
    'category','service',
    'severity', CASE WHEN NEW.priority IN ('high','urgent') THEN 'warning' ELSE 'info' END,
    'title', format('Novo ticket %s', NEW.ticket_number),
    'body', NEW.subject,
    'entity_type','customer_ticket','entity_id', NEW.id::text,
    'type','ticket_created'
  ));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_customer_ticket_activity ON public.customer_tickets;
CREATE TRIGGER trg_customer_ticket_activity AFTER INSERT ON public.customer_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ticket_activity();

CREATE OR REPLACE FUNCTION public.tg_customer_ticket_msg_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
  VALUES ('customer_ticket', NEW.ticket_id,
          CASE NEW.sender_type WHEN 'customer' THEN 'customer_replied' WHEN 'agent' THEN 'agent_replied' ELSE 'system_message' END,
          NEW.sender_user_id, NEW.sender_type,
          left(NEW.message, 200),
          jsonb_build_object('internal', NEW.internal),
          CASE WHEN NEW.internal THEN 'internal' ELSE 'customer_visible' END);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_customer_ticket_msg_activity ON public.customer_ticket_messages;
CREATE TRIGGER trg_customer_ticket_msg_activity AFTER INSERT ON public.customer_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ticket_msg_activity();

CREATE OR REPLACE FUNCTION public.tg_service_case_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
    VALUES ('service_case', NEW.id, 'case_created', NEW.reported_by, 'user',
            format('Service case %s criado', NEW.case_number),
            jsonb_build_object('case_type', NEW.case_type, 'source', NEW.source, 'status', NEW.status), 'internal');
    PERFORM public.notification_create(jsonb_build_object(
      'recipient_group','service_support', 'category','service',
      'severity', CASE WHEN NEW.priority::text IN ('high','urgent') THEN 'warning' ELSE 'info' END,
      'title', format('Novo service case %s', NEW.case_number),
      'body', NEW.description,
      'entity_type','service_case','entity_id', NEW.id::text, 'type','service_case_created'));
  ELSIF TG_OP='UPDATE' AND OLD.status <> NEW.status THEN
    INSERT INTO public.activity_events(entity_type, entity_id, event_type, actor_user_id, actor_type, message, metadata, visibility)
    VALUES ('service_case', NEW.id, 'status_changed', auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
            format('Status: %s → %s', OLD.status, NEW.status),
            jsonb_build_object('old', OLD.status, 'new', NEW.status), 'internal');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_service_case_activity ON public.service_cases;
CREATE TRIGGER trg_service_case_activity AFTER INSERT OR UPDATE OF status ON public.service_cases
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_case_activity();

-- =========================================================================
-- Health check
-- =========================================================================
CREATE OR REPLACE FUNCTION public.erp_communication_health_check(_threshold_hours int DEFAULT 48)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_cnt int;
BEGIN
  -- P0: notification_without_recipient (defensive; constraint should prevent)
  SELECT count(*) INTO v_cnt FROM public.notifications WHERE user_id IS NULL AND recipient_group IS NULL;
  IF v_cnt > 0 THEN v_p0 := v_p0+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','notification_without_recipient','priority','p0','count',v_cnt); END IF;

  -- P0: task_assigned_to_missing_user
  SELECT count(*) INTO v_cnt FROM public.erp_tasks t
   WHERE t.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=t.assigned_to);
  IF v_cnt > 0 THEN v_p0 := v_p0+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','task_assigned_to_missing_user','priority','p0','count',v_cnt); END IF;

  -- P0: activity_event_missing_entity (entity_type null already prevented)
  SELECT count(*) INTO v_cnt FROM public.activity_events WHERE entity_type IS NULL OR entity_id IS NULL;
  IF v_cnt > 0 THEN v_p0 := v_p0+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','activity_event_missing_entity','priority','p0','count',v_cnt); END IF;

  -- P0: conversation_message_without_thread
  SELECT count(*) INTO v_cnt FROM public.conversation_messages m
   WHERE NOT EXISTS (SELECT 1 FROM public.conversation_threads t WHERE t.id=m.thread_id);
  IF v_cnt > 0 THEN v_p0 := v_p0+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','conversation_message_without_thread','priority','p0','count',v_cnt); END IF;

  -- P1: overdue_open_task
  SELECT count(*) INTO v_cnt FROM public.erp_tasks
   WHERE status IN ('open','in_progress','blocked') AND due_date IS NOT NULL AND due_date < now();
  IF v_cnt > 0 THEN v_p1 := v_p1+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','overdue_open_task','priority','p1','count',v_cnt); END IF;

  -- P1: unread_critical_notification_too_old
  SELECT count(*) INTO v_cnt FROM public.notifications
   WHERE severity='critical' AND status='unread' AND created_at < now() - (_threshold_hours||' hours')::interval;
  IF v_cnt > 0 THEN v_p1 := v_p1+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','unread_critical_notification_too_old','priority','p1','count',v_cnt); END IF;

  -- P1: service_case_without_activity
  SELECT count(*) INTO v_cnt FROM public.service_cases sc
   WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a WHERE a.entity_type='service_case' AND a.entity_id=sc.id);
  IF v_cnt > 0 THEN v_p1 := v_p1+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','service_case_without_activity','priority','p1','count',v_cnt); END IF;

  -- P1: ticket_without_activity
  SELECT count(*) INTO v_cnt FROM public.customer_tickets ct
   WHERE NOT EXISTS (SELECT 1 FROM public.activity_events a WHERE a.entity_type='customer_ticket' AND a.entity_id=ct.id);
  IF v_cnt > 0 THEN v_p1 := v_p1+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','ticket_without_activity','priority','p1','count',v_cnt); END IF;

  -- P2: inactive_conversation_with_open_ticket
  SELECT count(*) INTO v_cnt FROM public.conversation_threads th
   WHERE th.status='open' AND th.entity_type='customer_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.conversation_messages m WHERE m.thread_id=th.id AND m.created_at > now() - (_threshold_hours||' hours')::interval);
  IF v_cnt > 0 THEN v_p2 := v_p2+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','inactive_conversation_with_open_ticket','priority','p2','count',v_cnt); END IF;

  -- P2: notification_delivery_failed
  SELECT count(*) INTO v_cnt FROM public.notification_delivery_log WHERE status='failed';
  IF v_cnt > 0 THEN v_p2 := v_p2+v_cnt;
    v_findings := v_findings || jsonb_build_object('code','notification_delivery_failed','priority','p2','count',v_cnt); END IF;

  RETURN jsonb_build_object('summary', jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'threshold_hours',_threshold_hours), 'findings', v_findings);
END $$;

-- Patch erp_health_check_run to include communication
CREATE OR REPLACE FUNCTION public.erp_health_check_run(_threshold_days integer DEFAULT 7)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_result jsonb; v_shopfloor jsonb; v_service jsonb; v_portal jsonb; v_fin jsonb; v_comm jsonb;
  v_findings jsonb; v_summary jsonb;
  v_p0 int; v_p1 int; v_p2 int; v_p3 int;
  v_log_id uuid; v_admin record; v_critical int;
BEGIN
  v_result    := public.erp_health_check(_threshold_days);
  v_shopfloor := public.erp_health_check_shopfloor(_threshold_days);
  v_service   := public.erp_service_health_check(_threshold_days);
  v_portal    := public.erp_customer_portal_health_check(_threshold_days);
  v_fin       := public.erp_financial_health_check();
  v_comm      := public.erp_communication_health_check();
  v_findings := COALESCE(v_result->'findings','[]'::jsonb)
              || COALESCE(v_shopfloor->'findings','[]'::jsonb)
              || COALESCE(v_service->'findings','[]'::jsonb)
              || COALESCE(v_portal->'findings','[]'::jsonb)
              || COALESCE(v_fin->'findings','[]'::jsonb)
              || COALESCE(v_comm->'findings','[]'::jsonb);
  v_p0 := COALESCE((v_result->'summary'->>'p0')::int,0)+COALESCE((v_shopfloor->>'p0')::int,0)+COALESCE((v_service->'summary'->>'p0')::int,0)+COALESCE((v_portal->'summary'->>'p0')::int,0)+COALESCE((v_fin->'summary'->>'p0')::int,0)+COALESCE((v_comm->'summary'->>'p0')::int,0);
  v_p1 := COALESCE((v_result->'summary'->>'p1')::int,0)+COALESCE((v_shopfloor->>'p1')::int,0)+COALESCE((v_service->'summary'->>'p1')::int,0)+COALESCE((v_portal->'summary'->>'p1')::int,0)+COALESCE((v_fin->'summary'->>'p1')::int,0)+COALESCE((v_comm->'summary'->>'p1')::int,0);
  v_p2 := COALESCE((v_result->'summary'->>'p2')::int,0)+COALESCE((v_shopfloor->>'p2')::int,0)+COALESCE((v_service->'summary'->>'p2')::int,0)+COALESCE((v_portal->'summary'->>'p2')::int,0)+COALESCE((v_fin->'summary'->>'p2')::int,0)+COALESCE((v_comm->'summary'->>'p2')::int,0);
  v_p3 := COALESCE((v_result->'summary'->>'p3')::int,0);
  v_summary := jsonb_build_object('run_at', now(), 'threshold_days', _threshold_days,
    'total', v_p0+v_p1+v_p2+v_p3, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2, 'p3', v_p3,
    'duration_ms', COALESCE((v_result->'summary'->>'duration_ms')::int,0),
    'portal_p0', COALESCE((v_portal->'summary'->>'p0')::int,0),
    'portal_p1', COALESCE((v_portal->'summary'->>'p1')::int,0),
    'portal_p2', COALESCE((v_portal->'summary'->>'p2')::int,0),
    'financial_p0', COALESCE((v_fin->'summary'->>'p0')::int,0),
    'financial_p1', COALESCE((v_fin->'summary'->>'p1')::int,0),
    'financial_p2', COALESCE((v_fin->'summary'->>'p2')::int,0),
    'communication_p0', COALESCE((v_comm->'summary'->>'p0')::int,0),
    'communication_p1', COALESCE((v_comm->'summary'->>'p1')::int,0),
    'communication_p2', COALESCE((v_comm->'summary'->>'p2')::int,0));
  INSERT INTO public.erp_health_check_log (summary, findings, p0_count, p1_count, p2_count, p3_count, duration_ms)
  VALUES (v_summary, v_findings, v_p0, v_p1, v_p2, v_p3, (v_summary->>'duration_ms')::int)
  RETURNING id INTO v_log_id;
  v_critical := v_p0 + v_p1;
  IF v_critical > 0 THEN
    FOR v_admin IN SELECT ug.user_id FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id WHERE g.code='system_admin' LOOP
      INSERT INTO public.notifications (user_id, module, type, title, body, link, payload, priority, entity_type, entity_id, severity, category, status)
      VALUES (v_admin.user_id, 'core'::public.app_module, 'health_check_critical',
        format('Health check: %s P0 / %s P1', v_p0, v_p1),
        format('Encontradas %s inconsistências críticas. Log %s.', v_critical, v_log_id),
        '/settings/health', v_summary, 'high', 'erp_health_check_log', v_log_id,
        CASE WHEN v_p0>0 THEN 'critical' ELSE 'warning' END, 'system', 'unread');
    END LOOP;
    UPDATE public.erp_health_check_log SET notified=true WHERE id=v_log_id;
  END IF;
  RETURN v_log_id;
END $$;
