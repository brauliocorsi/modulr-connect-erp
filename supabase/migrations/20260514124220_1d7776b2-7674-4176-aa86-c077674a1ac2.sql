CREATE OR REPLACE FUNCTION public.discuss_open_dm(_other uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _key text;
  _id uuid;
  _other_label text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _other = _me THEN
    RAISE EXCEPTION 'cannot DM yourself';
  END IF;

  _key := 'dm:' || array_to_string(ARRAY(SELECT unnest(ARRAY[_me::text, _other::text]) ORDER BY 1), '|');

  SELECT id INTO _id FROM chat_channels WHERE kind='dm' AND name=_key LIMIT 1;
  IF _id IS NOT NULL THEN
    INSERT INTO chat_channel_members(channel_id, user_id) VALUES (_id, _me)
      ON CONFLICT DO NOTHING;
    INSERT INTO chat_channel_members(channel_id, user_id) VALUES (_id, _other)
      ON CONFLICT DO NOTHING;
    RETURN _id;
  END IF;

  SELECT COALESCE(full_name, email, 'Utilizador') INTO _other_label FROM profiles WHERE id=_other;

  INSERT INTO chat_channels(name, kind, is_private, created_by, description)
  VALUES (_key, 'dm', true, _me, 'DM com ' || COALESCE(_other_label,'utilizador'))
  RETURNING id INTO _id;

  INSERT INTO chat_channel_members(channel_id, user_id) VALUES (_id, _me), (_id, _other);

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.discuss_open_dm(uuid) TO authenticated;

-- cleanup test rows
DELETE FROM chat_channels WHERE name IN ('test_simple','test_dm');