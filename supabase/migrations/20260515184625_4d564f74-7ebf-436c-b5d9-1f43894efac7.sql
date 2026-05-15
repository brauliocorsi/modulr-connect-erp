
-- 1) Block cash_movements when session closed
CREATE OR REPLACE FUNCTION public.tg_cash_movement_block_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_state text; v_session uuid;
BEGIN
  v_session := COALESCE(NEW.session_id, OLD.session_id);
  IF v_session IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT state INTO v_state FROM cash_sessions WHERE id = v_session;
  IF v_state = 'closed' THEN
    RAISE EXCEPTION 'A sessão de caixa está fechada — não é possível movimentar valores.'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_movement_block_closed ON public.cash_movements;
CREATE TRIGGER trg_cash_movement_block_closed
BEFORE INSERT OR UPDATE OR DELETE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_cash_movement_block_closed();

-- 2) MO state notifications
CREATE OR REPLACE FUNCTION public.tg_mo_notify_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_title text; v_link text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF NEW.state NOT IN ('confirmed','in_progress','done','cancelled') THEN RETURN NEW; END IF;
  v_title := 'Ordem de Fabricação ' || COALESCE(NEW.name, NEW.id::text) || ' → ' || NEW.state;
  v_link  := '/manufacturing/orders/' || NEW.id::text;
  FOR r IN
    SELECT ug.user_id
      FROM user_groups ug
      JOIN groups g ON g.id = ug.group_id
     WHERE g.code IN ('manufacturing_manager','system_admin')
  LOOP
    PERFORM notify_user(r.user_id, 'manufacturing'::app_module, 'mo_state', v_title, NULL, v_link);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mo_notify_state_change ON public.manufacturing_orders;
CREATE TRIGGER trg_mo_notify_state_change
AFTER INSERT OR UPDATE OF state ON public.manufacturing_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_mo_notify_state_change();

-- 3) Picking ready notifications (state -> assigned)
CREATE OR REPLACE FUNCTION public.tg_picking_notify_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_title text; v_link text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NEW; END IF;
  IF NEW.state <> 'assigned' THEN RETURN NEW; END IF;
  v_title := 'Transferência ' || COALESCE(NEW.name, NEW.id::text) || ' pronta a separar';
  v_link  := '/inventory/transfers/' || NEW.id::text;
  FOR r IN
    SELECT ug.user_id
      FROM user_groups ug
      JOIN groups g ON g.id = ug.group_id
     WHERE g.code IN ('inventory_manager','system_admin')
  LOOP
    PERFORM notify_user(r.user_id, 'inventory'::app_module, 'picking_ready', v_title, NULL, v_link);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_picking_notify_assigned ON public.stock_pickings;
CREATE TRIGGER trg_picking_notify_assigned
AFTER INSERT OR UPDATE OF state ON public.stock_pickings
FOR EACH ROW EXECUTE FUNCTION public.tg_picking_notify_assigned();
