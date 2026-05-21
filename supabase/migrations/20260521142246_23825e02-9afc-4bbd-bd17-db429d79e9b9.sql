
CREATE OR REPLACE FUNCTION public.is_chat_channel_member(_channel uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = _channel AND user_id = _user
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_channel_member(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS ccm_read ON public.chat_channel_members;

CREATE POLICY ccm_read ON public.chat_channel_members
FOR SELECT
USING (
  user_id = auth.uid()
  OR has_group(auth.uid(), 'system_admin')
  OR public.is_chat_channel_member(channel_id, auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.chat_channels c
    WHERE c.id = chat_channel_members.channel_id AND c.is_private = false
  )
);
