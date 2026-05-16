
CREATE OR REPLACE FUNCTION public.package_backfill_dryrun()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  internal_ref text,
  location_id uuid,
  location_name text,
  lot_id uuid,
  qty_in_stock numeric,
  has_real_template boolean,
  template_total int,
  packages_previstos int,
  is_multi_location boolean,
  source text,
  existing_packages int,
  divergence boolean,
  risco text,
  note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH ml AS (
  SELECT q.product_id, COUNT(DISTINCT q.location_id) AS n_loc
  FROM stock_quants q
  WHERE q.quantity > 0
  GROUP BY q.product_id
),
tpl AS (
  SELECT t.product_id, COUNT(*) FILTER (WHERE t.active) AS n_tpl,
         MAX(t.package_total) AS pkg_total
  FROM product_package_templates t
  GROUP BY t.product_id
),
existing AS (
  SELECT sp.product_id, sp.current_location_id AS location_id, COUNT(*) AS n
  FROM stock_packages sp
  GROUP BY sp.product_id, sp.current_location_id
)
SELECT
  q.product_id,
  p.name,
  p.internal_ref,
  q.location_id,
  l.name,
  q.lot_id,
  q.quantity,
  COALESCE(tpl.n_tpl,0) > 0,
  COALESCE(tpl.pkg_total, 1),
  CASE
    WHEN COALESCE(tpl.n_tpl,0) > 0 THEN CEIL(q.quantity)::int * COALESCE(tpl.pkg_total,1)
    ELSE CEIL(q.quantity)::int
  END,
  COALESCE(ml.n_loc,1) > 1,
  CASE WHEN COALESCE(tpl.n_tpl,0) > 0 THEN 'template_real' ELSE 'virtual' END,
  COALESCE(e.n, 0),
  COALESCE(e.n, 0) <> 0
    AND COALESCE(e.n, 0) <> (
      CASE
        WHEN COALESCE(tpl.n_tpl,0) > 0 THEN CEIL(q.quantity)::int * COALESCE(tpl.pkg_total,1)
        ELSE CEIL(q.quantity)::int
      END),
  CASE
    WHEN p.name LIKE 'TESTE_E2E_%' OR NOT p.active THEN 'P3'
    WHEN COALESCE(l.return_kind::text,'none') IN ('damaged','quarantine') THEN 'P0'
    WHEN COALESCE(ml.n_loc,1) > 1 AND COALESCE(tpl.n_tpl,0) = 0 THEN 'P1'
    WHEN COALESCE(tpl.n_tpl,0) > 0 THEN 'P2'
    ELSE 'P2'
  END,
  CASE
    WHEN NOT p.active THEN 'produto inactivo — excluir do backfill'
    WHEN p.name LIKE 'TESTE_E2E_%' THEN 'dado de teste — excluir'
    WHEN COALESCE(tpl.n_tpl,0) = 0 AND COALESCE(ml.n_loc,1) > 1 THEN 'multi-location sem template — revisão humana'
    WHEN COALESCE(tpl.n_tpl,0) = 0 THEN 'package virtual 1:1'
    ELSE 'template real ' || tpl.pkg_total || ' colis/unidade'
  END
FROM stock_quants q
JOIN products p ON p.id = q.product_id
JOIN stock_locations l ON l.id = q.location_id
LEFT JOIN ml ON ml.product_id = q.product_id
LEFT JOIN tpl ON tpl.product_id = q.product_id
LEFT JOIN existing e ON e.product_id = q.product_id AND e.location_id = q.location_id
WHERE q.quantity > 0
ORDER BY p.name, l.name;
$$;

GRANT EXECUTE ON FUNCTION public.package_backfill_dryrun() TO authenticated, anon;

CREATE OR REPLACE VIEW public.v_package_backfill_preview
WITH (security_invoker = true)
AS SELECT * FROM public.package_backfill_dryrun();

GRANT SELECT ON public.v_package_backfill_preview TO authenticated, anon;

COMMENT ON FUNCTION public.package_backfill_dryrun() IS
'M2.5 Migration 3 — read-only dry-run. Não cria stock_packages. Apenas projecta o que o backfill faria.';
