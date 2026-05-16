
-- Patch T19 in the test function: stock_quants column is "quantity", not "qty".
-- Easiest: rebuild only the T19 logic via a tiny helper used by test; but
-- since the function is monolithic we replace it with the same body and the
-- one-line fix. Use plpgsql DO to swap source text via regexp.
DO $$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='_test_phase15_m5' AND pronamespace='public'::regnamespace;
  v_src := replace(v_src,
    'SELECT COALESCE(SUM(CASE WHEN qty < 0 THEN 1 ELSE 0 END),0) INTO v_neg FROM stock_quants;',
    'SELECT COALESCE(SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END),0)::int INTO v_neg FROM stock_quants;');
  EXECUTE v_src;
END $$;
