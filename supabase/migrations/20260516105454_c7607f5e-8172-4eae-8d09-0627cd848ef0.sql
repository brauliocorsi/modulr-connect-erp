
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_packages_ref_unique
  ON public.stock_packages (package_ref)
  WHERE package_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public._m25_backfill_real_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products uuid[] := ARRAY[
    'be4df28e-b077-4e61-8cc5-69c7f18f1dea'::uuid,
    '9be30b8e-a281-4cb3-ba7a-7732a1ef75f2'::uuid
  ];
  v_prod uuid;
  v_quant record;
  v_tpl record;
  v_unit int;
  v_status package_status;
  v_pkg_total int;
  v_created int := 0;
  v_skipped int := 0;
  v_result jsonb := '[]'::jsonb;
  v_prod_created int;
  v_expected int;
  v_actual int;
  v_ref text;
BEGIN
  FOREACH v_prod IN ARRAY v_products LOOP
    v_prod_created := 0;

    SELECT COUNT(*) INTO v_pkg_total
      FROM product_package_templates WHERE product_id = v_prod AND active;
    IF v_pkg_total = 0 THEN
      RAISE EXCEPTION 'Produto % sem template activo', v_prod;
    END IF;

    BEGIN
      FOR v_quant IN
        SELECT q.id AS quant_id, q.product_id, q.location_id, q.quantity,
               l.type AS loc_type, l.name AS loc_name, l.return_kind
        FROM stock_quants q
        JOIN stock_locations l ON l.id = q.location_id
        JOIN products p ON p.id = q.product_id
        WHERE q.product_id = v_prod AND q.quantity > 0 AND p.active
      LOOP
        v_status := CASE
          WHEN v_quant.return_kind::text IN ('damaged','quarantine') THEN 'returned'::package_status
          WHEN v_quant.loc_type = 'customer' THEN 'delivered'::package_status
          WHEN v_quant.loc_type = 'transit' OR v_quant.loc_name ILIKE '%entrega%' OR v_quant.loc_name ILIKE '%vehicle%' THEN 'loaded'::package_status
          ELSE 'available'::package_status
        END;

        FOR v_unit IN 1..CEIL(v_quant.quantity)::int LOOP
          FOR v_tpl IN
            SELECT id, package_sequence, package_total, package_group
            FROM product_package_templates
            WHERE product_id = v_prod AND active
            ORDER BY package_sequence
          LOOP
            v_ref := 'BF-' || SUBSTR(v_quant.quant_id::text,1,8)
                     || '-U' || v_unit
                     || '-C' || v_tpl.package_sequence || '_' || v_tpl.package_total;

            IF NOT EXISTS (SELECT 1 FROM stock_packages WHERE package_ref = v_ref) THEN
              INSERT INTO stock_packages (
                product_id, package_template_id,
                package_ref, package_sequence, package_total, package_group,
                qty, current_location_id,
                condition, status, is_virtual, generated_virtual_package
              ) VALUES (
                v_prod, v_tpl.id,
                v_ref, v_tpl.package_sequence, v_tpl.package_total, v_tpl.package_group,
                1, v_quant.location_id,
                'good'::package_condition, v_status, false, false
              );
              v_prod_created := v_prod_created + 1;
            ELSE
              v_skipped := v_skipped + 1;
            END IF;
          END LOOP;
        END LOOP;
      END LOOP;

      SELECT COALESCE(SUM(CEIL(q.quantity))::int,0) * v_pkg_total
        INTO v_expected
        FROM stock_quants q JOIN products p ON p.id=q.product_id
       WHERE q.product_id = v_prod AND q.quantity>0 AND p.active;

      SELECT COUNT(*) INTO v_actual
        FROM stock_packages WHERE product_id = v_prod;

      IF v_actual <> v_expected THEN
        RAISE EXCEPTION 'Invariante falhou produto=%: expected=%, actual=%', v_prod, v_expected, v_actual;
      END IF;

      v_created := v_created + v_prod_created;
      v_result := v_result || jsonb_build_object(
        'product_id', v_prod, 'created', v_prod_created,
        'expected', v_expected, 'actual', v_actual,
        'pkg_total', v_pkg_total, 'ok', true
      );
    EXCEPTION WHEN OTHERS THEN
      DELETE FROM stock_packages
       WHERE product_id = v_prod AND package_ref LIKE 'BF-%';
      v_result := v_result || jsonb_build_object(
        'product_id', v_prod, 'ok', false, 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'created_total', v_created,
    'skipped_existing', v_skipped,
    'per_product', v_result
  );
END $$;

COMMENT ON FUNCTION public._m25_backfill_real_packages() IS
'M2.5 Migration 4 — backfill controlado Mesa Aurora + Cadeira Baltic. Idempotente.';

-- Executar
DO $exec$
DECLARE r jsonb;
BEGIN
  r := public._m25_backfill_real_packages();
  RAISE NOTICE 'Backfill report: %', r;
END $exec$;
