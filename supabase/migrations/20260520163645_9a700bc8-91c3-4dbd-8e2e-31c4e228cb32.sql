
-- =====================================================================
-- F24-D — Security/RLS hardening (chat + messages)
-- =====================================================================

-- Helper: thread participant check (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_thread_participant(_thread uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants
    WHERE thread_id = _thread
      AND user_id = _user
  );
$$;

-- =====================================================================
-- conversation_threads
-- =====================================================================
DROP POLICY IF EXISTS ct_all ON public.conversation_threads;
DROP POLICY IF EXISTS ct_select ON public.conversation_threads;
DROP POLICY IF EXISTS ct_admin_write ON public.conversation_threads;

CREATE POLICY ct_select ON public.conversation_threads
  FOR SELECT TO authenticated
  USING (
    public.is_thread_participant(id, auth.uid())
    OR public.has_group(auth.uid(), 'system_admin')
  );

CREATE POLICY ct_admin_write ON public.conversation_threads
  FOR ALL TO authenticated
  USING (public.has_group(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_group(auth.uid(), 'system_admin'));

-- =====================================================================
-- conversation_messages
-- =====================================================================
DROP POLICY IF EXISTS cm_select ON public.conversation_messages;
DROP POLICY IF EXISTS cm_insert ON public.conversation_messages;
DROP POLICY IF EXISTS cm_update ON public.conversation_messages;
DROP POLICY IF EXISTS cm_delete ON public.conversation_messages;

CREATE POLICY cm_select ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    public.is_thread_participant(thread_id, auth.uid())
    OR public.has_group(auth.uid(), 'system_admin')
  );

CREATE POLICY cm_admin_write ON public.conversation_messages
  FOR ALL TO authenticated
  USING (public.has_group(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_group(auth.uid(), 'system_admin'));

-- =====================================================================
-- conversation_participants
-- =====================================================================
DROP POLICY IF EXISTS cp_all ON public.conversation_participants;
DROP POLICY IF EXISTS cp_select ON public.conversation_participants;
DROP POLICY IF EXISTS cp_admin_write ON public.conversation_participants;

CREATE POLICY cp_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_thread_participant(thread_id, auth.uid())
    OR public.has_group(auth.uid(), 'system_admin')
  );

CREATE POLICY cp_admin_write ON public.conversation_participants
  FOR ALL TO authenticated
  USING (public.has_group(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_group(auth.uid(), 'system_admin'));

-- =====================================================================
-- conversation_attachments
-- =====================================================================
DROP POLICY IF EXISTS ca_all ON public.conversation_attachments;
DROP POLICY IF EXISTS ca_select ON public.conversation_attachments;
DROP POLICY IF EXISTS ca_admin_write ON public.conversation_attachments;

CREATE POLICY ca_select ON public.conversation_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_messages m
      WHERE m.id = conversation_attachments.message_id
        AND (
          public.is_thread_participant(m.thread_id, auth.uid())
          OR public.has_group(auth.uid(), 'system_admin')
        )
    )
  );

CREATE POLICY ca_admin_write ON public.conversation_attachments
  FOR ALL TO authenticated
  USING (public.has_group(auth.uid(), 'system_admin'))
  WITH CHECK (public.has_group(auth.uid(), 'system_admin'));

-- =====================================================================
-- chat_messages — restrict SELECT to channel members
-- =====================================================================
DROP POLICY IF EXISTS cm_read ON public.chat_messages;
CREATE POLICY cm_read ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.has_group(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.chat_channel_members mb
      WHERE mb.channel_id = chat_messages.channel_id
        AND mb.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = chat_messages.channel_id
        AND c.is_private = false
    )
  );

-- =====================================================================
-- chat_channel_members — restrict SELECT to fellow members
-- =====================================================================
DROP POLICY IF EXISTS ccm_read ON public.chat_channel_members;
CREATE POLICY ccm_read ON public.chat_channel_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_group(auth.uid(), 'system_admin')
    OR EXISTS (
      SELECT 1 FROM public.chat_channel_members mb2
      WHERE mb2.channel_id = chat_channel_members.channel_id
        AND mb2.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = chat_channel_members.channel_id
        AND c.is_private = false
    )
  );

-- =====================================================================
-- record_messages — block direct INSERT (must go through record_message_post RPC)
-- =====================================================================
DROP POLICY IF EXISTS rm_insert ON public.record_messages;
CREATE POLICY rm_insert ON public.record_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_group(auth.uid(), 'system_admin'));

-- =====================================================================
-- Self-test
-- =====================================================================
CREATE OR REPLACE FUNCTION public._test_phase24_security_rls_permissions()
RETURNS TABLE(scenario text, ok boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread uuid;
  v_msg uuid;
  v_participant uuid;
  v_outsider uuid;
  v_count int;
BEGIN
  -- pick two real users from profiles to simulate roles (no creation)
  SELECT id INTO v_participant FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_outsider FROM public.profiles WHERE id <> v_participant ORDER BY created_at ASC LIMIT 1;

  IF v_participant IS NULL OR v_outsider IS NULL THEN
    scenario := 'precondition_two_profiles'; ok := false; detail := 'Need at least 2 profiles to run the test'; RETURN NEXT;
    RETURN;
  END IF;

  -- 1) Helper exists
  scenario := 'helper_is_thread_participant_exists';
  ok := to_regprocedure('public.is_thread_participant(uuid,uuid)') IS NOT NULL;
  detail := 'is_thread_participant helper present';
  RETURN NEXT;

  -- 2) RLS enabled on critical chat tables
  SELECT count(*) INTO v_count FROM pg_tables
   WHERE schemaname='public'
     AND tablename IN ('conversation_threads','conversation_messages','conversation_participants','conversation_attachments','chat_messages','chat_channel_members','record_messages')
     AND rowsecurity = true;
  scenario := 'rls_enabled_critical_chat_tables';
  ok := (v_count = 7);
  detail := format('%s/7 tables with RLS', v_count);
  RETURN NEXT;

  -- 3) No more USING(true)/WITH CHECK(true) on conversation_* tables
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('conversation_threads','conversation_messages','conversation_participants','conversation_attachments')
     AND (qual = 'true' OR with_check = 'true');
  scenario := 'no_permissive_policies_on_conversation_tables';
  ok := (v_count = 0);
  detail := format('%s permissive policies remaining', v_count);
  RETURN NEXT;

  -- 4) Direct write policy on conversation_messages requires admin
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND tablename='conversation_messages'
     AND policyname='cm_admin_write';
  scenario := 'conversation_messages_admin_only_direct_write';
  ok := (v_count = 1);
  detail := 'cm_admin_write present';
  RETURN NEXT;

  -- 5) record_message_post RPC still exists (SECURITY DEFINER bypass for normal users)
  scenario := 'record_message_post_rpc_exists';
  ok := to_regprocedure('public.record_message_post(text,uuid,text,text,jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname='record_message_post');
  detail := 'record_message_post available';
  RETURN NEXT;

  -- 6) cash_sessions / customer_payments still locked with has_permission/has_group
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('cash_sessions','cash_movements','customer_payments','supplier_bills','supplier_payments','bank_reconciliation_lines','bank_reconciliation_batches')
     AND (qual = 'true' OR with_check = 'true');
  scenario := 'finance_tables_no_permissive_policies';
  ok := (v_count = 0);
  detail := format('%s permissive policies on finance tables', v_count);
  RETURN NEXT;

  RETURN;
END;
$$;
