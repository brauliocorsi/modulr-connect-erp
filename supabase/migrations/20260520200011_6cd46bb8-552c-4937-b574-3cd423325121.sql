
CREATE OR REPLACE FUNCTION public.discuss_send_message(
  _channel_id uuid,
  _body text DEFAULT NULL,
  _image_url text DEFAULT NULL,
  _mentions uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_channel public.chat_channels;
  v_is_member boolean;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF _channel_id IS NULL THEN
    RAISE EXCEPTION 'channel_id required';
  END IF;
  IF COALESCE(btrim(_body), '') = '' AND _image_url IS NULL THEN
    RAISE EXCEPTION 'message body or image required';
  END IF;
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = _channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel not found';
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = _channel_id AND user_id = v_user
  ) INTO v_is_member;
  IF NOT v_is_member AND v_channel.is_private THEN
    RAISE EXCEPTION 'not a member of this private channel';
  END IF;
  IF NOT v_is_member AND NOT v_channel.is_private THEN
    INSERT INTO public.chat_channel_members(channel_id, user_id)
    VALUES (_channel_id, v_user)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.chat_messages(channel_id, author_id, body, mentions, image_url)
  VALUES (
    _channel_id,
    v_user,
    NULLIF(btrim(_body), ''),
    COALESCE(_mentions, '{}'::uuid[]),
    _image_url
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.discuss_send_message(uuid, text, text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.picking_scan_reset_quantity_done(_picking uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT state INTO v_state FROM public.stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'picking not found';
  END IF;
  IF v_state IN ('done', 'cancelled') THEN
    RAISE EXCEPTION 'picking already %', v_state;
  END IF;
  UPDATE public.stock_moves
     SET quantity_done = 0
   WHERE picking_id = _picking
     AND state NOT IN ('done', 'cancelled');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.picking_scan_reset_quantity_done(uuid) TO authenticated;
