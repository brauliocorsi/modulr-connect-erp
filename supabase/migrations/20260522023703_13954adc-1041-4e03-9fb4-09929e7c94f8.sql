-- Helper without recursion
CREATE OR REPLACE FUNCTION public.chat_channel_is_public(_channel uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = _channel AND is_private = false);
$$;

CREATE OR REPLACE FUNCTION public.chat_channel_created_by(_channel uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT created_by FROM public.chat_channels WHERE id = _channel;
$$;

-- Replace recursive policies
DROP POLICY IF EXISTS ccm_read ON public.chat_channel_members;
CREATE POLICY ccm_read ON public.chat_channel_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR has_group(auth.uid(), 'system_admin'::text)
  OR is_chat_channel_member(channel_id, auth.uid())
  OR chat_channel_is_public(channel_id)
);

DROP POLICY IF EXISTS ccm_insert ON public.chat_channel_members;
CREATE POLICY ccm_insert ON public.chat_channel_members
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR has_group(auth.uid(), 'system_admin'::text)
  OR chat_channel_created_by(channel_id) = auth.uid()
);

DROP POLICY IF EXISTS cc_read ON public.chat_channels;
CREATE POLICY cc_read ON public.chat_channels
FOR SELECT TO authenticated
USING (
  (NOT is_private)
  OR is_chat_channel_member(id, auth.uid())
  OR has_group(auth.uid(), 'system_admin'::text)
);