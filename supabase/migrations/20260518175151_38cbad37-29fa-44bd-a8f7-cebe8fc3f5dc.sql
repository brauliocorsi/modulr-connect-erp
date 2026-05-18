
CREATE OR REPLACE FUNCTION public.release_orphan_reservations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH move_res AS (
    SELECT sm.product_id, sm.variant_id, sm.source_location_id AS location_id,
           COALESCE(SUM(sm.reserved_quantity),0) AS reserved
    FROM public.stock_moves sm
    WHERE sm.state IN ('waiting','ready','draft')
      AND COALESCE(sm.reserved_quantity,0) > 0
    GROUP BY sm.product_id, sm.variant_id, sm.source_location_id
  ),
  service_res AS (
    SELECT l.product_id, l.variant_id, l.location_id,
           GREATEST(
             COALESCE(SUM(CASE WHEN l.action = 'reserve' THEN l.qty ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN l.action IN ('release','consume') THEN l.qty ELSE 0 END), 0),
             0
           ) AS reserved
    FROM public.stock_reservation_log l
    JOIN public.service_case_items sci ON sci.id = l.to_service_case_item_id
    JOIN public.service_cases sc ON sc.id = sci.service_case_id
    WHERE l.to_service_case_item_id IS NOT NULL
      AND sci.status NOT IN ('done','cancelled')
      AND sc.status NOT IN ('done','cancelled','rejected')
    GROUP BY l.product_id, l.variant_id, l.location_id
  ),
  active_res AS (
    SELECT product_id, variant_id, location_id, SUM(reserved) AS reserved
    FROM (
      SELECT product_id, variant_id, location_id, reserved FROM move_res
      UNION ALL
      SELECT product_id, variant_id, location_id, reserved FROM service_res
    ) u
    GROUP BY product_id, variant_id, location_id
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
END $function$;
