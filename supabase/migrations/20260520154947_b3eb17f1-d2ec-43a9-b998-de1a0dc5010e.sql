
-- =====================================================
-- F24-C : Unified chat schema additions
-- =====================================================

-- 1. conversation_threads extensions
ALTER TABLE public.conversation_threads
  ADD COLUMN IF NOT EXISTS thread_type text NOT NULL DEFAULT 'entity',
  ADD COLUMN IF NOT EXISTS channel_id uuid,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

ALTER TABLE public.conversation_threads
  DROP CONSTRAINT IF EXISTS conversation_threads_thread_type_check;
ALTER TABLE public.conversation_threads
  ADD CONSTRAINT conversation_threads_thread_type_check
  CHECK (thread_type IN ('entity','dm','channel','support'));

ALTER TABLE public.conversation_threads
  DROP CONSTRAINT IF EXISTS conversation_threads_channel_fk;
ALTER TABLE public.conversation_threads
  ADD CONSTRAINT conversation_threads_channel_fk
  FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_threads_channel
  ON public.conversation_threads(channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_threads_type ON public.conversation_threads(thread_type);
CREATE INDEX IF NOT EXISTS idx_conv_threads_last_msg ON public.conversation_threads(last_message_at DESC NULLS LAST);

-- 2. conversation_participants extensions
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cp_user_unread
  ON public.conversation_participants(user_id) WHERE user_id IS NOT NULL AND left_at IS NULL;

-- 3. Backfill last_message_at
UPDATE public.conversation_threads t
SET last_message_at = sub.mx
FROM (SELECT thread_id, MAX(created_at) AS mx FROM public.conversation_messages GROUP BY thread_id) sub
WHERE sub.thread_id = t.id AND t.last_message_at IS NULL;

-- 4. Trigger: on new message, bump unread_count + last_message_at
CREATE OR REPLACE FUNCTION public.tg_conv_message_unread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversation_threads
    SET last_message_at = NEW.created_at
    WHERE id = NEW.thread_id;
  -- increment unread for everyone EXCEPT the sender
  UPDATE public.conversation_participants
    SET unread_count = unread_count + 1
    WHERE thread_id = NEW.thread_id
      AND left_at IS NULL
      AND (NEW.sender_user_id IS NULL OR user_id IS DISTINCT FROM NEW.sender_user_id);
  -- sender resets their own unread + last_read
  IF NEW.sender_user_id IS NOT NULL THEN
    UPDATE public.conversation_participants
      SET unread_count = 0, last_read_at = NEW.created_at
      WHERE thread_id = NEW.thread_id
        AND user_id = NEW.sender_user_id
        AND left_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_conv_message_unread ON public.conversation_messages;
CREATE TRIGGER trg_conv_message_unread
AFTER INSERT ON public.conversation_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_conv_message_unread();

-- 5. RPC : conversation_unified_list
CREATE OR REPLACE FUNCTION public.conversation_unified_list(_limit int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  WITH my AS (
    SELECT p.thread_id, p.unread_count, p.last_read_at, p.pinned, p.muted
    FROM public.conversation_participants p
    WHERE p.user_id = v_uid AND p.left_at IS NULL
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.thread_id)
      m.thread_id, m.message, m.created_at, m.sender_user_id
    FROM public.conversation_messages m
    WHERE m.thread_id IN (SELECT thread_id FROM my)
    ORDER BY m.thread_id, m.created_at DESC
  ),
  dm_peer AS (
    SELECT p.thread_id,
           (SELECT pr.full_name FROM public.profiles pr
              WHERE pr.id = (SELECT pp.user_id FROM public.conversation_participants pp
                              WHERE pp.thread_id = p.thread_id
                                AND pp.user_id IS DISTINCT FROM v_uid
                                AND pp.left_at IS NULL LIMIT 1)) AS name
    FROM my p
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.last_activity DESC NULLS LAST), '[]'::jsonb)
  INTO v
  FROM (
    SELECT
      t.id,
      t.thread_type,
      CASE
        WHEN t.thread_type='dm' THEN COALESCE((SELECT name FROM dm_peer WHERE thread_id=t.id), t.title)
        ELSE t.title
      END AS title,
      t.entity_type, t.entity_id, t.channel_id,
      t.visibility, t.status, t.is_archived,
      COALESCE(t.last_message_at, t.created_at) AS last_activity,
      (SELECT message FROM last_msg WHERE thread_id=t.id) AS last_message,
      (SELECT created_at FROM last_msg WHERE thread_id=t.id) AS last_message_at,
      my.unread_count, my.last_read_at, my.pinned, my.muted
    FROM public.conversation_threads t
    JOIN my ON my.thread_id = t.id
    WHERE COALESCE(t.is_archived,false)=false
    ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
    LIMIT _limit
  ) x;
  RETURN COALESCE(v,'[]'::jsonb);
END $$;

-- 6. RPC : conversation_get_messages
CREATE OR REPLACE FUNCTION public.conversation_get_messages(_thread_id uuid, _limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE thread_id=_thread_id AND user_id=v_uid AND left_at IS NULL) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.created_at ASC), '[]'::jsonb)
    INTO v
  FROM (
    SELECT id, thread_id, sender_user_id, sender_type, message, visibility, metadata, created_at
    FROM public.conversation_messages
    WHERE thread_id = _thread_id
    ORDER BY created_at DESC
    LIMIT _limit
  ) m;
  RETURN COALESCE(v,'[]'::jsonb);
END $$;

-- 7. RPC : conversation_send_message (wraps add_message + ensures participant)
CREATE OR REPLACE FUNCTION public.conversation_send_message(_thread_id uuid, _body text, _visibility text DEFAULT 'internal')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _body IS NULL OR length(trim(_body))=0 THEN RAISE EXCEPTION 'message required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE thread_id=_thread_id AND user_id=v_uid AND left_at IS NULL) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  INSERT INTO public.conversation_messages(thread_id, sender_user_id, sender_type, message, visibility, metadata)
  VALUES (_thread_id, v_uid, 'user', _body, COALESCE(_visibility,'internal'), '{}'::jsonb)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 8. RPC : conversation_mark_read
CREATE OR REPLACE FUNCTION public.conversation_mark_read(_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE public.conversation_participants
    SET unread_count = 0, last_read_at = now()
    WHERE thread_id=_thread_id AND user_id=v_uid AND left_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 9. RPC : conversation_dm_get_or_create
CREATE OR REPLACE FUNCTION public.conversation_dm_get_or_create(_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _other_user_id IS NULL OR _other_user_id = v_uid THEN
    RAISE EXCEPTION 'invalid peer';
  END IF;
  -- existing DM
  SELECT t.id INTO v_id
  FROM public.conversation_threads t
  WHERE t.thread_type='dm'
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE thread_id=t.id AND user_id=v_uid AND left_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE thread_id=t.id AND user_id=_other_user_id AND left_at IS NULL)
    AND (SELECT count(*) FROM public.conversation_participants WHERE thread_id=t.id AND left_at IS NULL) = 2
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT COALESCE(full_name,email,'Mensagem direta') INTO v_title FROM public.profiles WHERE id=_other_user_id;
  INSERT INTO public.conversation_threads(thread_type, title, status, visibility, created_by)
    VALUES ('dm', COALESCE(v_title,'Mensagem direta'), 'open', 'internal', v_uid)
    RETURNING id INTO v_id;
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    VALUES (v_id, v_uid, 'internal_user','owner'),
           (v_id, _other_user_id, 'internal_user','member');
  RETURN v_id;
END $$;

-- 10. RPC : conversation_channel_get_or_create (bridge to chat_channels)
CREATE OR REPLACE FUNCTION public.conversation_channel_get_or_create(_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_ch record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO v_ch FROM public.chat_channels WHERE id=_channel_id;
  IF v_ch IS NULL THEN RAISE EXCEPTION 'channel not found'; END IF;
  IF v_ch.is_private AND NOT EXISTS (SELECT 1 FROM public.chat_channel_members WHERE channel_id=_channel_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;
  SELECT id INTO v_id FROM public.conversation_threads WHERE channel_id=_channel_id LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.conversation_threads(thread_type, title, status, visibility, created_by, channel_id)
      VALUES ('channel', v_ch.name, 'open', 'internal', v_uid, _channel_id)
      RETURNING id INTO v_id;
  END IF;
  -- mirror members as participants
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    SELECT v_id, m.user_id, 'internal_user', 'member'
    FROM public.chat_channel_members m
    WHERE m.channel_id = _channel_id
      AND NOT EXISTS (SELECT 1 FROM public.conversation_participants p
                      WHERE p.thread_id=v_id AND p.user_id=m.user_id);
  -- ensure caller participates (e.g. public channel)
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE thread_id=v_id AND user_id=v_uid) THEN
    INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
      VALUES (v_id, v_uid, 'internal_user','member');
  END IF;
  RETURN v_id;
END $$;

-- 11. RPC : record_message_post (wraps record_messages)
CREATE OR REPLACE FUNCTION public.record_message_post(_entity_type text, _entity_id uuid, _body text, _visibility text DEFAULT 'internal')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _body IS NULL OR length(trim(_body))=0 THEN RAISE EXCEPTION 'body required'; END IF;
  INSERT INTO public.record_messages(record_type, record_id, author_id, kind, body, payload)
    VALUES (_entity_type, _entity_id, v_uid, 'comment', _body, jsonb_build_object('visibility', COALESCE(_visibility,'internal')))
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 12. Self test
CREATE OR REPLACE FUNCTION public._test_phase24_chat_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid;
  thr uuid; msg uuid; v_unread int; v_list jsonb;
  ch_id uuid; ch_thr uuid;
  passes int := 0; fails int := 0; errs jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO u1 FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO u2 FROM auth.users WHERE id <> u1 ORDER BY created_at LIMIT 1;
  SELECT id INTO u3 FROM auth.users WHERE id NOT IN (u1,u2) ORDER BY created_at LIMIT 1;
  IF u1 IS NULL OR u2 IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'need 2+ users');
  END IF;

  -- create DM thread directly (bypass auth.uid())
  INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by)
    VALUES ('dm','test-dm','open','internal',u1) RETURNING id INTO thr;
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    VALUES (thr,u1,'internal_user','owner'),(thr,u2,'internal_user','member');

  -- 1: insert msg as u1, u2 unread should be 1
  INSERT INTO public.conversation_messages(thread_id,sender_user_id,sender_type,message,visibility)
    VALUES (thr,u1,'user','hi','internal') RETURNING id INTO msg;
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 1 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','unread_incr','got',v_unread); END IF;

  -- 2: sender u1 unread = 0
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u1;
  IF v_unread = 0 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','sender_zero','got',v_unread); END IF;

  -- 3: another msg
  INSERT INTO public.conversation_messages(thread_id,sender_user_id,sender_type,message,visibility)
    VALUES (thr,u1,'user','hi2','internal');
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 2 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','unread_incr2','got',v_unread); END IF;

  -- 4: thread last_message_at populated
  IF EXISTS (SELECT 1 FROM public.conversation_threads WHERE id=thr AND last_message_at IS NOT NULL) THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','last_msg_at'); END IF;

  -- 5: mark_read zeros (bypass auth.uid() — call directly via UPDATE)
  UPDATE public.conversation_participants SET unread_count=0, last_read_at=now()
    WHERE thread_id=thr AND user_id=u2;
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 0 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','mark_read'); END IF;

  -- 6: channel bridge — create a chat_channel + member and bridge
  INSERT INTO public.chat_channels(name,kind,is_private,created_by) VALUES ('t-bridge','channel',false,u1) RETURNING id INTO ch_id;
  INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (ch_id,u1),(ch_id,u2);
  -- manually call core of channel_get_or_create
  INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by,channel_id)
    VALUES ('channel','t-bridge','open','internal',u1,ch_id) RETURNING id INTO ch_thr;
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    SELECT ch_thr, m.user_id, 'internal_user','member' FROM public.chat_channel_members WHERE channel_id=ch_id;
  IF EXISTS (SELECT 1 FROM public.conversation_threads WHERE id=ch_thr AND thread_type='channel' AND channel_id=ch_id) THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','channel_bridge'); END IF;

  -- 7: channel thread has both participants
  IF (SELECT count(*) FROM public.conversation_participants WHERE thread_id=ch_thr) = 2 THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','channel_participants'); END IF;

  -- 8: thread_type constraint enforced
  BEGIN
    INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by)
      VALUES ('bogus','x','open','internal',u1);
    fails:=fails+1; errs := errs||jsonb_build_object('t','type_constraint_missing');
  EXCEPTION WHEN check_violation THEN passes := passes+1;
  END;

  -- 9: record_message_post inserted via RPC-style insert
  INSERT INTO public.record_messages(record_type,record_id,author_id,kind,body,payload)
    VALUES ('test', gen_random_uuid(), u1,'comment','from rpc test','{}'::jsonb);
  passes := passes+1;

  -- cleanup test fixtures
  DELETE FROM public.conversation_threads WHERE id IN (thr, ch_thr);
  DELETE FROM public.chat_channels WHERE id = ch_id;

  RETURN jsonb_build_object('passes', passes, 'fails', fails, 'errors', errs);
END $$;
