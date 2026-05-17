CREATE OR REPLACE FUNCTION public.mfg_next_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE n int; y text;
BEGIN
  y := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX( (regexp_match(code, '^MO/'||y||'/(\d+)$'))[1]::int ), 0) + 1
    INTO n
    FROM public.manufacturing_orders
   WHERE code ~ ('^MO/'||y||'/\d+$');
  RETURN 'MO/'||y||'/'||lpad(n::text,5,'0');
END $function$;