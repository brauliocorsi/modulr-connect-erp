
BEGIN;
DELETE FROM public.stock_locations WHERE is_bin = true;
COMMIT;
