DROP POLICY IF EXISTS ccm_insert ON public.chat_channel_members;
CREATE POLICY ccm_insert ON public.chat_channel_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR has_group(auth.uid(), 'system_admin'::text)
    OR EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = channel_id AND c.created_by = auth.uid())
  );