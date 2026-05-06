
-- Limpa permissões existentes para reseed
DELETE FROM public.group_permissions
 WHERE group_id IN (SELECT id FROM public.groups WHERE code <> 'system_admin');

-- Helper inline via DO block
DO $$
DECLARE
  g record;
  ent text;
  act text;
  module_name app_module;
  entities text[];
  user_actions text[] := ARRAY['view','create','edit'];
  manager_actions text[] := ARRAY['view','create','edit','delete','export'];
  acts text[];
BEGIN
  FOR g IN SELECT id, code, module FROM public.groups WHERE code <> 'system_admin' LOOP
    module_name := g.module;
    -- entidades por módulo
    IF module_name = 'sales' THEN
      entities := ARRAY['orders','pricelists'];
    ELSIF module_name = 'purchase' THEN
      entities := ARRAY['orders'];
    ELSIF module_name = 'inventory' THEN
      entities := ARRAY['transfers','locations','adjustments','rules'];
    ELSIF module_name = 'products' THEN
      entities := ARRAY['products','categories','attributes','uom','bom'];
    ELSE
      entities := ARRAY[]::text[];
    END IF;

    IF g.code LIKE '%_manager' THEN
      acts := manager_actions;
    ELSE
      acts := user_actions;
    END IF;

    FOREACH ent IN ARRAY entities LOOP
      FOREACH act IN ARRAY acts LOOP
        INSERT INTO public.group_permissions(group_id, module, entity, action)
        VALUES (g.id, module_name, ent, act::permission_action)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;

    -- todos veem partners (core)
    FOREACH act IN ARRAY user_actions LOOP
      INSERT INTO public.group_permissions(group_id, module, entity, action)
      VALUES (g.id, 'core'::app_module, 'partners', act::permission_action)
      ON CONFLICT DO NOTHING;
    END LOOP;
    IF g.code LIKE '%_manager' THEN
      INSERT INTO public.group_permissions(group_id, module, entity, action)
      VALUES (g.id, 'core'::app_module, 'partners', 'delete'::permission_action),
             (g.id, 'core'::app_module, 'partners', 'export'::permission_action)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
