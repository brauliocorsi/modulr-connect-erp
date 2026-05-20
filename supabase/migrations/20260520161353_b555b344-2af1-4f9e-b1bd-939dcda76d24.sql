CREATE OR REPLACE FUNCTION public.discuss_bridge_channel_to_conversation(_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ch record;
  v_thread_id uuid;
  v_title text;
BEGIN
  SELECT * INTO v_ch
  FROM public.chat_channels
  WHERE id = _channel_id;

  IF v_ch IS NULL THEN
    RAISE EXCEPTION 'channel not found';
  END IF;

  SELECT id INTO v_thread_id
  FROM public.conversation_threads
  WHERE channel_id = _channel_id
  ORDER BY created_at ASC
  LIMIT 1;

  v_title := CASE
    WHEN v_ch.kind = 'dm' THEN 'Mensagem direta'
    ELSE v_ch.name
  END;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.conversation_threads(thread_type, title, status, visibility, created_by, channel_id)
    VALUES (
      CASE WHEN v_ch.kind = 'dm' THEN 'dm' ELSE 'channel' END,
      COALESCE(v_title, 'Conversa'),
      'open',
      'internal',
      v_ch.created_by,
      _channel_id
    )
    RETURNING id INTO v_thread_id;
  ELSE
    UPDATE public.conversation_threads
    SET thread_type = CASE WHEN v_ch.kind = 'dm' THEN 'dm' ELSE 'channel' END,
        title = CASE WHEN v_ch.kind = 'dm' THEN conversation_threads.title ELSE COALESCE(v_ch.name, conversation_threads.title) END,
        is_archived = false
    WHERE id = v_thread_id;
  END IF;

  INSERT INTO public.conversation_participants(thread_id, user_id, participant_type, role, joined_at, last_read_at)
  SELECT v_thread_id, m.user_id, 'internal_user', 'member', COALESCE(m.joined_at, now()), m.last_read_at
  FROM public.chat_channel_members m
  WHERE m.channel_id = _channel_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants p
      WHERE p.thread_id = v_thread_id
        AND p.user_id = m.user_id
        AND p.left_at IS NULL
    );

  RETURN v_thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.discuss_bridge_message_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id uuid;
  v_message text;
BEGIN
  v_thread_id := public.discuss_bridge_channel_to_conversation(NEW.channel_id);
  v_message := COALESCE(NULLIF(trim(NEW.body), ''), CASE WHEN NEW.image_url IS NOT NULL THEN '[imagem]' ELSE '[mensagem]' END);

  INSERT INTO public.conversation_messages(thread_id, sender_user_id, sender_type, message, visibility, metadata, created_at)
  SELECT
    v_thread_id,
    NEW.author_id,
    'user',
    v_message,
    'internal',
    jsonb_build_object(
      'legacy_chat_message_id', NEW.id,
      'legacy_channel_id', NEW.channel_id,
      'image_url', NEW.image_url,
      'attachments', COALESCE(NEW.attachments, '[]'::jsonb),
      'mentions', COALESCE(to_jsonb(NEW.mentions), '[]'::jsonb)
    ),
    NEW.created_at
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.conversation_messages cm
    WHERE cm.metadata->>'legacy_chat_message_id' = NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discuss_bridge_message_to_conversation ON public.chat_messages;
CREATE TRIGGER trg_discuss_bridge_message_to_conversation
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.discuss_bridge_message_to_conversation();

CREATE INDEX IF NOT EXISTS idx_conv_messages_legacy_chat_message
ON public.conversation_messages ((metadata->>'legacy_chat_message_id'))
WHERE metadata ? 'legacy_chat_message_id';

WITH bridged_channels AS (
  SELECT public.discuss_bridge_channel_to_conversation(id) AS thread_id
  FROM public.chat_channels
), legacy_messages AS (
  SELECT
    m.*,
    t.id AS thread_id,
    COALESCE(NULLIF(trim(m.body), ''), CASE WHEN m.image_url IS NOT NULL THEN '[imagem]' ELSE '[mensagem]' END) AS bridged_body
  FROM public.chat_messages m
  JOIN public.conversation_threads t ON t.channel_id = m.channel_id
)
INSERT INTO public.conversation_messages(thread_id, sender_user_id, sender_type, message, visibility, metadata, created_at)
SELECT
  lm.thread_id,
  lm.author_id,
  'user',
  lm.bridged_body,
  'internal',
  jsonb_build_object(
    'legacy_chat_message_id', lm.id,
    'legacy_channel_id', lm.channel_id,
    'image_url', lm.image_url,
    'attachments', COALESCE(lm.attachments, '[]'::jsonb),
    'mentions', COALESCE(to_jsonb(lm.mentions), '[]'::jsonb)
  ),
  lm.created_at
FROM legacy_messages lm
WHERE NOT EXISTS (
  SELECT 1
  FROM public.conversation_messages cm
  WHERE cm.metadata->>'legacy_chat_message_id' = lm.id::text
);

UPDATE public.conversation_threads t
SET last_message_at = sub.last_message_at
FROM (
  SELECT thread_id, max(created_at) AS last_message_at
  FROM public.conversation_messages
  GROUP BY thread_id
) sub
WHERE sub.thread_id = t.id;

UPDATE public.conversation_participants p
SET unread_count = COALESCE((
      SELECT count(*)::int
      FROM public.conversation_messages cm
      WHERE cm.thread_id = p.thread_id
        AND cm.sender_user_id IS DISTINCT FROM p.user_id
        AND cm.created_at > COALESCE(m.last_read_at, p.last_read_at, '-infinity'::timestamptz)
    ), 0),
    last_read_at = COALESCE(p.last_read_at, m.last_read_at)
FROM public.conversation_threads t,
     public.chat_channel_members m
WHERE p.thread_id = t.id
  AND t.channel_id IS NOT NULL
  AND m.channel_id = t.channel_id
  AND m.user_id = p.user_id;

CREATE OR REPLACE FUNCTION public._test_f24_chat_dock_discuss_bridge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel uuid;
  v_thread uuid;
  v_msg uuid;
  u1 uuid;
  u2 uuid;
  v_count int;
  v_unread int;
BEGIN
  SELECT id INTO u1 FROM public.profiles ORDER BY id LIMIT 1;
  SELECT id INTO u2 FROM public.profiles WHERE id <> u1 ORDER BY id LIMIT 1;

  IF u1 IS NULL OR u2 IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'need 2 profiles');
  END IF;

  INSERT INTO public.chat_channels(name, kind, is_private, created_by)
  VALUES ('f24-test-bridge', 'dm', true, u1)
  RETURNING id INTO v_channel;

  INSERT INTO public.chat_channel_members(channel_id, user_id, last_read_at)
  VALUES (v_channel, u1, now()), (v_channel, u2, now() - interval '1 hour');

  INSERT INTO public.chat_messages(channel_id, author_id, body)
  VALUES (v_channel, u1, 'bridge test')
  RETURNING id INTO v_msg;

  SELECT id INTO v_thread
  FROM public.conversation_threads
  WHERE channel_id = v_channel;

  SELECT count(*) INTO v_count
  FROM public.conversation_messages
  WHERE thread_id = v_thread
    AND metadata->>'legacy_chat_message_id' = v_msg::text;

  SELECT unread_count INTO v_unread
  FROM public.conversation_participants
  WHERE thread_id = v_thread
    AND user_id = u2;

  DELETE FROM public.conversation_messages WHERE thread_id = v_thread;
  DELETE FROM public.conversation_participants WHERE thread_id = v_thread;
  DELETE FROM public.conversation_threads WHERE id = v_thread;
  DELETE FROM public.chat_messages WHERE channel_id = v_channel;
  DELETE FROM public.chat_channel_members WHERE channel_id = v_channel;
  DELETE FROM public.chat_channels WHERE id = v_channel;

  RETURN jsonb_build_object(
    'passes', CASE WHEN v_thread IS NOT NULL AND v_count = 1 AND v_unread >= 1 THEN 3 ELSE 0 END,
    'thread_created', v_thread IS NOT NULL,
    'message_bridged', v_count = 1,
    'recipient_unread', v_unread >= 1
  );
END;
$$;