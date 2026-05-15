
CREATE OR REPLACE FUNCTION public.tg_mo_create_needs_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.state = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    BEGIN
      PERFORM mfg_create_needs_for_mo(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'mfg_create_needs_for_mo failed for MO %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mo_create_needs_on_confirm ON public.manufacturing_orders;
CREATE TRIGGER trg_mo_create_needs_on_confirm
AFTER INSERT OR UPDATE OF state ON public.manufacturing_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_mo_create_needs_on_confirm();
