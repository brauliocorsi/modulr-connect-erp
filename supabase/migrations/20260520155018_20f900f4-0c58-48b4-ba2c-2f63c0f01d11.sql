
CREATE OR REPLACE FUNCTION public._test_phase24_chat_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u1 uuid; u2 uuid;
  thr uuid; msg uuid; v_unread int;
  ch_id uuid; ch_thr uuid;
  passes int := 0; fails int := 0; errs jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO u1 FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO u2 FROM auth.users WHERE id <> u1 ORDER BY created_at LIMIT 1;
  IF u1 IS NULL OR u2 IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'need 2+ users');
  END IF;

  INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by)
    VALUES ('dm','test-dm','open','internal',u1) RETURNING id INTO thr;
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    VALUES (thr,u1,'internal_user','owner'),(thr,u2,'internal_user','member');

  INSERT INTO public.conversation_messages(thread_id,sender_user_id,sender_type,message,visibility)
    VALUES (thr,u1,'user','hi','internal') RETURNING id INTO msg;
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 1 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','unread_incr','got',v_unread); END IF;

  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u1;
  IF v_unread = 0 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','sender_zero','got',v_unread); END IF;

  INSERT INTO public.conversation_messages(thread_id,sender_user_id,sender_type,message,visibility)
    VALUES (thr,u1,'user','hi2','internal');
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 2 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','unread_incr2','got',v_unread); END IF;

  IF EXISTS (SELECT 1 FROM public.conversation_threads WHERE id=thr AND last_message_at IS NOT NULL) THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','last_msg_at'); END IF;

  UPDATE public.conversation_participants SET unread_count=0, last_read_at=now()
    WHERE thread_id=thr AND user_id=u2;
  SELECT unread_count INTO v_unread FROM public.conversation_participants WHERE thread_id=thr AND user_id=u2;
  IF v_unread = 0 THEN passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','mark_read'); END IF;

  INSERT INTO public.chat_channels(name,kind,is_private,created_by) VALUES ('t-bridge','channel',false,u1) RETURNING id INTO ch_id;
  INSERT INTO public.chat_channel_members(channel_id,user_id) VALUES (ch_id,u1),(ch_id,u2);
  INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by,channel_id)
    VALUES ('channel','t-bridge','open','internal',u1,ch_id) RETURNING id INTO ch_thr;
  INSERT INTO public.conversation_participants(thread_id,user_id,participant_type,role)
    SELECT ch_thr, mem.user_id, 'internal_user','member'
    FROM public.chat_channel_members mem WHERE mem.channel_id = ch_id;
  IF EXISTS (SELECT 1 FROM public.conversation_threads WHERE id=ch_thr AND thread_type='channel' AND channel_id=ch_id) THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','channel_bridge'); END IF;

  IF (SELECT count(*) FROM public.conversation_participants WHERE thread_id=ch_thr) = 2 THEN
    passes := passes+1; ELSE fails:=fails+1; errs := errs||jsonb_build_object('t','channel_participants'); END IF;

  BEGIN
    INSERT INTO public.conversation_threads(thread_type,title,status,visibility,created_by)
      VALUES ('bogus','x','open','internal',u1);
    fails:=fails+1; errs := errs||jsonb_build_object('t','type_constraint_missing');
  EXCEPTION WHEN check_violation THEN passes := passes+1;
  END;

  INSERT INTO public.record_messages(record_type,record_id,author_id,kind,body,payload)
    VALUES ('test', gen_random_uuid(), u1,'comment','from rpc test','{}'::jsonb);
  passes := passes+1;

  DELETE FROM public.conversation_threads WHERE id IN (thr, ch_thr);
  DELETE FROM public.chat_channels WHERE id = ch_id;

  RETURN jsonb_build_object('passes', passes, 'fails', fails, 'errors', errs);
END $$;
