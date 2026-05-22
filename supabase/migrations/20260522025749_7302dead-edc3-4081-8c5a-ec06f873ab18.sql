
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_user_upload" ON storage.objects;
CREATE POLICY "avatars_user_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "avatars_user_update" ON storage.objects;
CREATE POLICY "avatars_user_update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "avatars_user_delete" ON storage.objects;
CREATE POLICY "avatars_user_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "chat_attachments_auth_upload" ON storage.objects;
CREATE POLICY "chat_attachments_auth_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "chat_attachments_public_read" ON storage.objects;
CREATE POLICY "chat_attachments_public_read" ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments');

CREATE OR REPLACE FUNCTION public.discuss_create_channel(
  _name text, _is_private boolean DEFAULT false, _description text DEFAULT NULL, _members uuid[] DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _me uuid := auth.uid(); _id uuid; _m uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'name required'; END IF;
  INSERT INTO public.chat_channels (name, kind, is_private, description, created_by)
  VALUES (trim(_name), 'channel', COALESCE(_is_private,false), _description, _me)
  RETURNING id INTO _id;
  INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (_id, _me)
  ON CONFLICT DO NOTHING;
  IF _members IS NOT NULL THEN
    FOREACH _m IN ARRAY _members LOOP
      IF _m IS NOT NULL AND _m <> _me THEN
        INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (_id, _m)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.discuss_create_channel(text,boolean,text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.discuss_add_member(_channel uuid, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_chat_channel_member(_channel, _me) OR public.chat_channel_created_by(_channel) = _me OR public.has_group(_me,'system_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (_channel, _user)
  ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.discuss_add_member(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.discuss_remove_member(_channel uuid, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.chat_channel_created_by(_channel) = _me OR public.has_group(_me,'system_admin') OR _user = _me) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.chat_channel_members WHERE channel_id = _channel AND user_id = _user;
END $$;
GRANT EXECUTE ON FUNCTION public.discuss_remove_member(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.discuss_send_message(
  _channel_id uuid, _body text DEFAULT NULL, _image_url text DEFAULT NULL,
  _mentions uuid[] DEFAULT '{}', _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.is_chat_channel_member(_channel_id, _me) OR public.chat_channel_is_public(_channel_id) OR public.has_group(_me,'system_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF (_body IS NULL OR length(trim(_body)) = 0) AND _image_url IS NULL AND (_attachments IS NULL OR jsonb_array_length(_attachments) = 0) THEN
    RAISE EXCEPTION 'empty message';
  END IF;
  INSERT INTO public.chat_messages (channel_id, author_id, body, image_url, mentions, attachments)
  VALUES (_channel_id, _me, _body, _image_url, COALESCE(_mentions,'{}'::uuid[]), COALESCE(_attachments,'[]'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.discuss_send_message(uuid,text,text,uuid[],jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.conversation_send_message(
  _thread_id uuid, _body text, _visibility text DEFAULT 'internal', _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF (_body IS NULL OR length(trim(_body)) = 0) AND (_attachments IS NULL OR jsonb_array_length(_attachments) = 0) THEN
    RAISE EXCEPTION 'message required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE thread_id=_thread_id AND user_id=v_uid AND left_at IS NULL) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;
  INSERT INTO public.conversation_messages(thread_id, sender_user_id, sender_type, message, visibility, metadata)
  VALUES (_thread_id, v_uid, 'user', COALESCE(_body,''), COALESCE(_visibility,'internal'),
          jsonb_build_object('attachments', COALESCE(_attachments,'[]'::jsonb)))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.conversation_send_message(uuid,text,text,jsonb) TO authenticated;
