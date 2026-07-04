
-- Alterar overload longo: retirar DEFAULT NULL para desambiguar close_mo(_mo)
-- Estratégia: recriar sem DEFAULT, mantendo mesmo corpo
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname='close_mo'
      AND pg_get_function_arguments(oid) = '_mo uuid, _qty_produced numeric DEFAULT NULL::numeric';
  IF v_def IS NULL THEN RETURN; END IF;
  -- Drop e recria sem DEFAULT
  DROP FUNCTION IF EXISTS public.close_mo(uuid, numeric);
  EXECUTE replace(v_def,
    'FUNCTION public.close_mo(_mo uuid, _qty_produced numeric DEFAULT NULL::numeric)',
    'FUNCTION public.close_mo(_mo uuid, _qty_produced numeric)');
END $$;
