
CREATE OR REPLACE FUNCTION public.tg_mo_create_needs_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.state = 'ready'::mo_state AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    BEGIN
      PERFORM mfg_create_needs_for_mo(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'mfg_create_needs_for_mo failed for MO %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_mo_notify_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_title text; v_link text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF NEW.state NOT IN ('ready'::mo_state,'in_progress'::mo_state,'done'::mo_state,'cancelled'::mo_state) THEN RETURN NEW; END IF;
  v_title := 'Ordem de Fabricação ' || COALESCE(NEW.code, NEW.id::text) || ' → ' || NEW.state::text;
  v_link  := '/manufacturing/orders/' || NEW.id::text;
  FOR r IN
    SELECT ug.user_id
      FROM user_groups ug
      JOIN groups g ON g.id = ug.group_id
     WHERE g.code IN ('production_manager','system_admin')
  LOOP
    PERFORM notify_user(r.user_id, 'manufacturing'::app_module, 'mo_state', v_title, NULL, v_link);
  END LOOP;
  RETURN NEW;
END;
$function$;
