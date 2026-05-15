
CREATE OR REPLACE FUNCTION public.notify_group(
  _group text,
  _module app_module,
  _type text,
  _title text,
  _body text DEFAULT NULL,
  _link text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _priority text DEFAULT 'normal',
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.notifications(user_id, module, type, title, body, link, payload,
                                   priority, entity_type, entity_id)
  SELECT ug.user_id, _module, _type, _title, _body, _link, COALESCE(_payload,'{}'::jsonb),
         COALESCE(_priority,'normal'), _entity_type, _entity_id
    FROM public.user_groups ug
    JOIN public.groups g ON g.id = ug.group_id
    JOIN auth.users  u ON u.id = ug.user_id
   WHERE g.name = _group;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
