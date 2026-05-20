DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.chat_channels LOOP
    PERFORM public.discuss_bridge_channel_to_conversation(r.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.discuss_bridge_member_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.discuss_bridge_channel_to_conversation(NEW.channel_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discuss_bridge_member_to_conversation ON public.chat_channel_members;
CREATE TRIGGER trg_discuss_bridge_member_to_conversation
AFTER INSERT OR UPDATE ON public.chat_channel_members
FOR EACH ROW
EXECUTE FUNCTION public.discuss_bridge_member_to_conversation();

WITH legacy_messages AS (
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