
INSERT INTO public.group_permissions (group_id, module, entity, action)
SELECT g.id, 'finance'::app_module, 'bills', a::permission_action
FROM public.groups g, (VALUES ('view'),('create')) v(a)
WHERE g.name = 'Compras / Gerente'
ON CONFLICT DO NOTHING;
