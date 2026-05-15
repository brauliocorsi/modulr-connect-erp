CREATE OR REPLACE FUNCTION public.tg_picking_notify_assigned()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_title text; v_link text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF NEW.state <> 'ready'::picking_state THEN RETURN NEW; END IF;
  v_title := 'Transferência ' || COALESCE(NEW.name, NEW.id::text) || ' pronta a separar';
  v_link  := '/inventory/transfers/' || NEW.id::text;
  FOR r IN
    SELECT ug.user_id
      FROM public.user_groups ug
      JOIN public.groups g ON g.id = ug.group_id
     WHERE g.code IN ('inventory_manager','system_admin')
  LOOP
    PERFORM public.notify_user(r.user_id, 'inventory'::app_module, 'picking_ready', v_title, NULL, v_link);
  END LOOP;
  RETURN NEW;
END;
$$;