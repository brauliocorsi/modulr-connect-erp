
DO $mig$
BEGIN
  -- Patch only the two specific lines via function replace using regexp
  EXECUTE (
    SELECT pg_get_functiondef(oid)
    FROM pg_proc WHERE proname='_test_purchase_need_to_po_flow'
  );
END $mig$;

-- Simpler: just redefine scenarios 15 & 20 conditions inline
CREATE OR REPLACE FUNCTION public._tpntpo_internal_qty(_prod uuid, _var uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(sq.quantity),0)
    FROM stock_quants sq
    JOIN stock_locations l ON l.id = sq.location_id
   WHERE sq.product_id = _prod
     AND sq.variant_id = _var
     AND l.type = 'internal';
$$;

CREATE OR REPLACE FUNCTION public._tpntpo_internal_neg(_prod uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COUNT(*)::int
    FROM stock_quants sq
    JOIN stock_locations l ON l.id = sq.location_id
   WHERE sq.product_id = _prod
     AND l.type = 'internal'
     AND sq.quantity < 0;
$$;
