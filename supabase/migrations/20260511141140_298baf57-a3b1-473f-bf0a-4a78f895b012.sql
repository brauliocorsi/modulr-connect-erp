
CREATE OR REPLACE FUNCTION public.release_orphan_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH active_res AS (
    SELECT sm.product_id, sm.variant_id, sm.source_location_id AS location_id,
           COALESCE(SUM(sm.reserved_quantity),0) AS reserved
    FROM public.stock_moves sm
    WHERE sm.state IN ('waiting','ready','draft')
      AND COALESCE(sm.reserved_quantity,0) > 0
    GROUP BY sm.product_id, sm.variant_id, sm.source_location_id
  ),
  upd AS (
    UPDATE public.stock_quants q
       SET reserved_quantity = src.new_reserved
      FROM (
        SELECT q2.id,
               COALESCE(ar.reserved, 0) AS new_reserved
        FROM public.stock_quants q2
        LEFT JOIN active_res ar
          ON ar.product_id = q2.product_id
         AND ar.location_id = q2.location_id
         AND COALESCE(ar.variant_id::text,'') = COALESCE(q2.variant_id::text,'')
        WHERE COALESCE(q2.reserved_quantity,0) <> COALESCE(ar.reserved,0)
      ) src
     WHERE q.id = src.id
    RETURNING 1
  )
  SELECT count(*) INTO updated_count FROM upd;
  RETURN updated_count;
END $$;

CREATE OR REPLACE FUNCTION public.trg_release_orphan_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.release_orphan_reservations();
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS sale_orders_release_orphans_upd ON public.sale_orders;
CREATE TRIGGER sale_orders_release_orphans_upd
AFTER UPDATE OF state ON public.sale_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_release_orphan_reservations();

DROP TRIGGER IF EXISTS sale_orders_release_orphans_del ON public.sale_orders;
CREATE TRIGGER sale_orders_release_orphans_del
AFTER DELETE ON public.sale_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_release_orphan_reservations();

DROP TRIGGER IF EXISTS stock_moves_release_orphans_del ON public.stock_moves;
CREATE TRIGGER stock_moves_release_orphans_del
AFTER DELETE ON public.stock_moves
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_release_orphan_reservations();

DROP TRIGGER IF EXISTS stock_moves_release_orphans_upd ON public.stock_moves;
CREATE TRIGGER stock_moves_release_orphans_upd
AFTER UPDATE OF state ON public.stock_moves
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_release_orphan_reservations();

SELECT public.release_orphan_reservations();
