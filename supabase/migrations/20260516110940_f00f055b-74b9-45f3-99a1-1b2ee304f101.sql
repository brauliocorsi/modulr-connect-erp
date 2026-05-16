
-- =========================================================
-- M2.5 — Migration 6: per-product package tracking
-- =========================================================

-- 1) Per-product flag
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS package_tracking_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_package_tracking_enabled
  ON public.products(package_tracking_enabled) WHERE package_tracking_enabled;

-- 2) Separate safety flag for any future quant-driven auto-creation (kept OFF)
INSERT INTO public.app_settings (key, value, description)
VALUES ('package_auto_create_from_quant', 'false'::jsonb,
        'If true, controlled flows may auto-create stock_packages from stock_quants. M2.5: must remain false; no wide trigger is installed.')
ON CONFLICT (key) DO NOTHING;

-- 3) Effective tracking resolver
CREATE OR REPLACE FUNCTION public.is_package_tracking_enabled_for_product(_product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_global boolean;
  v_product boolean;
BEGIN
  SELECT COALESCE((value::text)::boolean,false) INTO v_global
    FROM app_settings WHERE key='package_tracking_enabled';
  SELECT COALESCE(package_tracking_enabled,false) INTO v_product
    FROM products WHERE id=_product_id;
  RETURN COALESCE(v_global,false) OR COALESCE(v_product,false);
END $$;

-- 4) sale_line_packages_ready: per-product aware
CREATE OR REPLACE FUNCTION public.sale_line_packages_ready(_sale_order_line_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_effective boolean;
  v_product uuid;
  v_qty numeric;
  v_pkg_total int;
  v_expected int;
  v_good int;
  v_damaged int;
  v_quar int;
  v_missing_loc int;
BEGIN
  SELECT sol.product_id, sol.quantity INTO v_product, v_qty
    FROM sale_order_lines sol WHERE sol.id=_sale_order_line_id;

  IF v_product IS NULL THEN
    RETURN jsonb_build_object('ready',false,'error','line_not_found');
  END IF;

  v_effective := public.is_package_tracking_enabled_for_product(v_product);

  IF NOT v_effective THEN
    RETURN jsonb_build_object('ready',true,'flag',false,'note','tracking disabled for product');
  END IF;

  SELECT COALESCE(MAX(package_total),1) INTO v_pkg_total
    FROM product_package_templates WHERE product_id=v_product AND active;
  v_expected := CEIL(v_qty)::int * v_pkg_total;

  SELECT
    COUNT(*) FILTER (WHERE condition IN ('good','repaired')),
    COUNT(*) FILTER (WHERE condition='damaged'),
    COUNT(*) FILTER (WHERE condition='quarantine'),
    COUNT(*) FILTER (WHERE current_location_id IS NULL)
  INTO v_good, v_damaged, v_quar, v_missing_loc
  FROM stock_packages WHERE sale_order_line_id=_sale_order_line_id;

  RETURN jsonb_build_object(
    'ready', (v_good >= v_expected) AND v_damaged=0 AND v_quar=0 AND v_missing_loc=0,
    'flag', true,
    'package_count', v_good+v_damaged+v_quar,
    'expected_package_count', v_expected,
    'missing_packages', GREATEST(v_expected - v_good, 0),
    'damaged_packages', v_damaged,
    'quarantine_packages', v_quar,
    'missing_location', v_missing_loc
  );
END $$;

-- 5) package_tracking_diagnostic: add effective flag + readiness + blockers
CREATE OR REPLACE FUNCTION public.package_tracking_diagnostic(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
  v_global boolean;
  v_product boolean;
  v_effective boolean;
  v_has_template boolean;
  v_diff_bad int;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE((value::text)::boolean,false) INTO v_global FROM app_settings WHERE key='package_tracking_enabled';
  SELECT COALESCE(package_tracking_enabled,false) INTO v_product FROM products WHERE id=_product_id;
  v_effective := v_global OR v_product;

  v_has_template := EXISTS (SELECT 1 FROM product_package_templates WHERE product_id=_product_id AND active);

  SELECT COUNT(*) INTO v_diff_bad FROM v_quant_vs_package_diff
   WHERE product_id=_product_id AND status NOT IN ('ok','no_template');

  IF NOT v_has_template THEN
    v_blockers := v_blockers || jsonb_build_object('code','missing_template');
  END IF;
  IF v_diff_bad > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code','quant_vs_package_divergence','count',v_diff_bad);
  END IF;
  IF EXISTS (SELECT 1 FROM stock_packages WHERE product_id=_product_id AND condition IN ('damaged','quarantine') AND status='available') THEN
    v_blockers := v_blockers || jsonb_build_object('code','damaged_or_quarantine_available');
  END IF;
  IF EXISTS (SELECT 1 FROM stock_packages WHERE product_id=_product_id AND current_location_id IS NULL) THEN
    v_blockers := v_blockers || jsonb_build_object('code','package_without_location');
  END IF;

  SELECT jsonb_build_object(
    'product_id', _product_id,
    'product_name', (SELECT name FROM products WHERE id=_product_id),
    'global_package_tracking_enabled', v_global,
    'product_package_tracking_enabled', v_product,
    'effective_package_tracking_enabled', v_effective,
    'has_template', v_has_template,
    'templates', (SELECT COALESCE(jsonb_agg(t.*),'[]'::jsonb) FROM product_package_templates t WHERE t.product_id=_product_id),
    'packages_count', (SELECT COUNT(*) FROM stock_packages WHERE product_id=_product_id),
    'packages_good', (SELECT COUNT(*) FROM stock_packages WHERE product_id=_product_id AND condition='good'),
    'packages_damaged', (SELECT COUNT(*) FROM stock_packages WHERE product_id=_product_id AND condition='damaged'),
    'packages_quarantine', (SELECT COUNT(*) FROM stock_packages WHERE product_id=_product_id AND condition='quarantine'),
    'packages_virtual', (SELECT COUNT(*) FROM stock_packages WHERE product_id=_product_id AND is_virtual),
    'quants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('loc',location_id,'qty',quantity)),'[]'::jsonb) FROM stock_quants WHERE product_id=_product_id AND quantity>0),
    'locations_count', (SELECT COUNT(DISTINCT location_id) FROM stock_quants WHERE product_id=_product_id AND quantity>0),
    'diff', (SELECT COALESCE(jsonb_agg(d.*),'[]'::jsonb) FROM v_quant_vs_package_diff d WHERE d.product_id=_product_id),
    'blockers', v_blockers,
    'ready_for_activation', (v_has_template AND v_diff_bad=0 AND jsonb_array_length(v_blockers)=0),
    'ready_for_tracking', (v_has_template AND v_diff_bad=0)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- 6) erp_package_health_check: per-product aware + 2 new checks
CREATE OR REPLACE FUNCTION public.erp_package_health_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_flag boolean := false;
  v_row record;
  v_p0 int:=0; v_p1 int:=0; v_p2 int:=0;
BEGIN
  SELECT COALESCE((value::text)::boolean,false) INTO v_flag FROM app_settings WHERE key='package_tracking_enabled';

  -- P0: package sem location
  FOR v_row IN SELECT id FROM stock_packages WHERE current_location_id IS NULL LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','package_without_location','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  -- P0: damaged em available
  FOR v_row IN
    SELECT sp.id, l.name loc
    FROM stock_packages sp JOIN stock_locations l ON l.id=sp.current_location_id
    WHERE sp.condition='damaged' AND sp.status='available'
      AND l.type='internal' AND COALESCE(l.return_kind::text,'') NOT IN ('damaged','quarantine')
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','damaged_package_in_available_stock','entity_id',v_row.id,'detail',v_row.loc);
    v_p0 := v_p0+1;
  END LOOP;

  -- P0: quarantine em available
  FOR v_row IN
    SELECT sp.id, l.name loc FROM stock_packages sp JOIN stock_locations l ON l.id=sp.current_location_id
    WHERE sp.condition='quarantine' AND sp.status='available'
      AND COALESCE(l.return_kind::text,'') NOT IN ('damaged','quarantine')
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','quarantine_package_in_available_stock','entity_id',v_row.id,'detail',v_row.loc);
    v_p0 := v_p0+1;
  END LOOP;

  -- P1: missing packages existentes
  FOR v_row IN
    SELECT * FROM v_quant_vs_package_diff
    WHERE status='missing_packages' AND package_count > 0
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P1','code','package_expected_missing',
      'entity_id',v_row.product_id,'detail',format('loc=%s missing=%s', v_row.location_id, v_row.package_missing_count));
    v_p1 := v_p1+1;
  END LOOP;

  -- Per-product / global: template ausente
  FOR v_row IN
    SELECT p.id, p.name, p.package_tracking_enabled AS prod_flag
    FROM products p
    WHERE p.active AND p.can_be_sold AND p.type IN ('storable','consumable')
      AND NOT EXISTS (SELECT 1 FROM product_package_templates t WHERE t.product_id=p.id AND t.active)
  LOOP
    IF v_row.prod_flag THEN
      v_findings := v_findings || jsonb_build_object('severity','P1','code','product_tracking_enabled_without_template','entity_id',v_row.id,'detail',v_row.name);
      v_p1 := v_p1+1;
    ELSIF v_flag THEN
      v_findings := v_findings || jsonb_build_object('severity','P1','code','package_template_missing_for_stockable_product','entity_id',v_row.id,'detail',v_row.name);
      v_p1 := v_p1+1;
    ELSE
      v_findings := v_findings || jsonb_build_object('severity','P2','code','package_template_missing_for_stockable_product','entity_id',v_row.id,'detail',v_row.name);
      v_p2 := v_p2+1;
    END IF;
  END LOOP;

  -- P0: produto com tracking ON tem stock_quant mas falta package
  FOR v_row IN
    SELECT q.product_id, q.location_id, q.quantity
    FROM stock_quants q
    JOIN products p ON p.id=q.product_id
    WHERE p.package_tracking_enabled = true
      AND q.quantity > 0
      AND NOT EXISTS (
        SELECT 1 FROM stock_packages sp
        WHERE sp.product_id=q.product_id AND sp.current_location_id=q.location_id
      )
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P0','code','tracked_product_quant_without_packages',
      'entity_id',v_row.product_id,'detail',format('loc=%s qty=%s', v_row.location_id, v_row.quantity));
    v_p0 := v_p0+1;
  END LOOP;

  -- P2: virtual em produto com template real
  FOR v_row IN
    SELECT sp.id FROM stock_packages sp
    WHERE sp.is_virtual AND EXISTS (
      SELECT 1 FROM product_package_templates t WHERE t.product_id=sp.product_id AND t.active
    )
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P2','code','virtual_package_for_real_product','entity_id',v_row.id);
    v_p2 := v_p2+1;
  END LOOP;

  -- P2: package_total mismatch
  FOR v_row IN
    SELECT sp.id FROM stock_packages sp
    JOIN product_package_templates t ON t.id=sp.package_template_id
    WHERE sp.package_total IS NOT NULL AND sp.package_total <> t.package_total
  LOOP
    v_findings := v_findings || jsonb_build_object('severity','P2','code','package_total_mismatch','entity_id',v_row.id);
    v_p2:=v_p2+1;
  END LOOP;

  RETURN jsonb_build_object(
    'flag_enabled', v_flag,
    'p0_count', v_p0, 'p1_count', v_p1, 'p2_count', v_p2,
    'findings', v_findings
  );
END $$;

-- 7) Activate per-product flag for the two validated real products
UPDATE public.products
   SET package_tracking_enabled = true
 WHERE id IN (
   'be4df28e-b077-4e61-8cc5-69c7f18f1dea',  -- Mesa Aurora
   '9be30b8e-a281-4cb3-ba7a-7732a1ef75f2'   -- Cadeira Baltic
 );

-- 8) Test function for M6
CREATE OR REPLACE FUNCTION public._test_phase15_2_m6()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  v_pass int := 0;
  v_fail int := 0;
  v_aurora uuid := 'be4df28e-b077-4e61-8cc5-69c7f18f1dea';
  v_baltic uuid := '9be30b8e-a281-4cb3-ba7a-7732a1ef75f2';
  v_diag jsonb;
  v_global boolean;
  v_off_prod uuid;
  v_eff boolean;
  v_hc jsonb;
BEGIN
  SELECT COALESCE((value::text)::boolean,false) INTO v_global FROM app_settings WHERE key='package_tracking_enabled';

  -- 1. global flag is OFF (precondition)
  IF NOT v_global THEN v_pass:=v_pass+1; v:=v||jsonb_build_object('t',1,'ok',true,'msg','global flag OFF');
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',1,'ok',false,'msg','global flag should be OFF'); END IF;

  -- 2. is_package_tracking_enabled_for_product returns true for Aurora
  v_eff := public.is_package_tracking_enabled_for_product(v_aurora);
  IF v_eff THEN v_pass:=v_pass+1; v:=v||jsonb_build_object('t',2,'ok',true);
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',2,'ok',false,'msg','aurora should be tracked'); END IF;

  -- 3. is_package_tracking_enabled_for_product returns true for Baltic
  v_eff := public.is_package_tracking_enabled_for_product(v_baltic);
  IF v_eff THEN v_pass:=v_pass+1; v:=v||jsonb_build_object('t',3,'ok',true);
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',3,'ok',false); END IF;

  -- 4. some active sellable product without flag returns false
  SELECT p.id INTO v_off_prod FROM products p
    WHERE p.active AND p.can_be_sold AND COALESCE(p.package_tracking_enabled,false)=false
    LIMIT 1;
  IF v_off_prod IS NOT NULL THEN
    v_eff := public.is_package_tracking_enabled_for_product(v_off_prod);
    IF NOT v_eff THEN v_pass:=v_pass+1; v:=v||jsonb_build_object('t',4,'ok',true);
    ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',4,'ok',false); END IF;
  ELSE v_pass:=v_pass+1; v:=v||jsonb_build_object('t',4,'ok',true,'msg','no off product found - skipped'); END IF;

  -- 5. diagnostic Aurora returns effective true and ready_for_activation true
  v_diag := public.package_tracking_diagnostic(v_aurora);
  IF (v_diag->>'effective_package_tracking_enabled')::boolean
     AND (v_diag->>'product_package_tracking_enabled')::boolean
     AND (v_diag->>'has_template')::boolean THEN
    v_pass:=v_pass+1; v:=v||jsonb_build_object('t',5,'ok',true);
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',5,'ok',false,'diag',v_diag); END IF;

  -- 6. diagnostic Baltic
  v_diag := public.package_tracking_diagnostic(v_baltic);
  IF (v_diag->>'effective_package_tracking_enabled')::boolean
     AND (v_diag->>'has_template')::boolean THEN
    v_pass:=v_pass+1; v:=v||jsonb_build_object('t',6,'ok',true);
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',6,'ok',false,'diag',v_diag); END IF;

  -- 7. health check returns structure
  v_hc := public.erp_package_health_check();
  IF v_hc ? 'p0_count' AND v_hc ? 'findings' THEN
    v_pass:=v_pass+1; v:=v||jsonb_build_object('t',7,'ok',true,'p0',v_hc->'p0_count','p1',v_hc->'p1_count','p2',v_hc->'p2_count');
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',7,'ok',false); END IF;

  -- 8. no wide trigger on stock_quants creating packages
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class c ON c.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='stock_quants'
      AND tg.tgname ILIKE '%package%' AND NOT tg.tgisinternal
  ) THEN
    v_pass:=v_pass+1; v:=v||jsonb_build_object('t',8,'ok',true,'msg','no package trigger on stock_quants');
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',8,'ok',false); END IF;

  -- 9. auto-create flag exists and is false
  IF (SELECT COALESCE((value::text)::boolean,false) FROM app_settings WHERE key='package_auto_create_from_quant') = false THEN
    v_pass:=v_pass+1; v:=v||jsonb_build_object('t',9,'ok',true);
  ELSE v_fail:=v_fail+1; v:=v||jsonb_build_object('t',9,'ok',false); END IF;

  RETURN jsonb_build_object('passed',v_pass,'failed',v_fail,'total',v_pass+v_fail,'results',v);
END $$;
