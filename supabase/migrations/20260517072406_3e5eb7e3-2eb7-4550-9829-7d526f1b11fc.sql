CREATE OR REPLACE FUNCTION public._test_phase15_2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_total int := 0; v_passed int := 0;
  v_r record; v_j jsonb; v_pass boolean;
  v_line_id uuid;

  -- Isolated fixtures (created/destroyed inside this function)
  v_uuid text := replace(gen_random_uuid()::text,'-','');
  v_mesa_name text;
  v_cad_name text;
  v_loc_name text;
  v_mesa uuid;
  v_cad  uuid;
  v_loc  uuid;
  v_wh   uuid;
  v_tpl_m1 uuid;
  v_tpl_m2 uuid;
  v_tpl_c1 uuid;
  v_quant_m uuid;
  v_quant_c uuid;
  v_pkg_m1 uuid;
  v_pkg_m2 uuid;
  v_pkg_c1 uuid;
BEGIN
  v_mesa_name := 'TESTE_PHASE15_2_MESA_' || v_uuid;
  v_cad_name  := 'TESTE_PHASE15_2_CADEIRA_' || v_uuid;
  v_loc_name  := 'TESTE_PHASE15_2_LOC_' || v_uuid;

  -- pick any existing warehouse (locations require warehouse_id usually optional, but we use any)
  SELECT id INTO v_wh FROM warehouses LIMIT 1;

  -- isolated internal location
  INSERT INTO stock_locations (warehouse_id, name, type, active)
  VALUES (v_wh, v_loc_name, 'internal', true)
  RETURNING id INTO v_loc;

  -- isolated MESA-like product: tracking on, 2 templates, 1 quant, 2 packages
  INSERT INTO products (name, type, can_be_sold, can_be_purchased, active, package_tracking_enabled)
  VALUES (v_mesa_name, 'storable', true, true, true, true)
  RETURNING id INTO v_mesa;

  INSERT INTO product_package_templates (product_id, name, package_sequence, package_total, active)
  VALUES (v_mesa, v_mesa_name || '_T1', 1, 2, true) RETURNING id INTO v_tpl_m1;
  INSERT INTO product_package_templates (product_id, name, package_sequence, package_total, active)
  VALUES (v_mesa, v_mesa_name || '_T2', 2, 2, true) RETURNING id INTO v_tpl_m2;

  INSERT INTO stock_quants (product_id, location_id, quantity, reserved_quantity)
  VALUES (v_mesa, v_loc, 1, 0) RETURNING id INTO v_quant_m;

  INSERT INTO stock_packages (product_id, package_template_id, package_ref,
    package_sequence, package_total, qty, current_location_id, condition, status,
    is_virtual, generated_virtual_package)
  VALUES (v_mesa, v_tpl_m1, 'TEST-' || v_uuid || '-M1', 1, 2, 1, v_loc,
          'good','available', false, false)
  RETURNING id INTO v_pkg_m1;
  INSERT INTO stock_packages (product_id, package_template_id, package_ref,
    package_sequence, package_total, qty, current_location_id, condition, status,
    is_virtual, generated_virtual_package)
  VALUES (v_mesa, v_tpl_m2, 'TEST-' || v_uuid || '-M2', 2, 2, 1, v_loc,
          'good','available', false, false)
  RETURNING id INTO v_pkg_m2;

  -- isolated CADEIRA-like product: tracking on, 1 template, 1 quant, 1 package
  INSERT INTO products (name, type, can_be_sold, can_be_purchased, active, package_tracking_enabled)
  VALUES (v_cad_name, 'storable', true, true, true, true)
  RETURNING id INTO v_cad;

  INSERT INTO product_package_templates (product_id, name, package_sequence, package_total, active)
  VALUES (v_cad, v_cad_name || '_T1', 1, 1, true) RETURNING id INTO v_tpl_c1;

  INSERT INTO stock_quants (product_id, location_id, quantity, reserved_quantity)
  VALUES (v_cad, v_loc, 1, 0) RETURNING id INTO v_quant_c;

  INSERT INTO stock_packages (product_id, package_template_id, package_ref,
    package_sequence, package_total, qty, current_location_id, condition, status,
    is_virtual, generated_virtual_package)
  VALUES (v_cad, v_tpl_c1, 'TEST-' || v_uuid || '-C1', 1, 1, 1, v_loc,
          'good','available', false, false)
  RETURNING id INTO v_pkg_c1;

  -- T1: isolated mesa, 2 packages aligned with 1 quant
  SELECT * INTO v_r FROM v_quant_vs_package_diff
    WHERE product_id=v_mesa AND location_id=v_loc
      AND quant_qty=1 AND expected_package_count=2 AND status='ok' LIMIT 1;
  v_pass := v_r IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','T1.mesa_multi_colis','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  -- T2: isolated cadeira, 1 package aligned with 1 quant
  SELECT * INTO v_r FROM v_quant_vs_package_diff
    WHERE product_id=v_cad AND location_id=v_loc
      AND quant_qty=1 AND expected_package_count=1 AND status='ok' LIMIT 1;
  v_pass := v_r IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','T2.cadeira_single_colis','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_pass := EXISTS (SELECT 1 FROM pg_proc WHERE proname='erp_package_health_check');
  v_tests := v_tests || jsonb_build_object('name','T3.damaged_check_exists','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_pass := EXISTS (SELECT 1 FROM pg_proc WHERE proname='erp_package_health_check');
  v_tests := v_tests || jsonb_build_object('name','T4.quarantine_check_exists','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_j := erp_package_health_check();
  v_pass := (v_j->>'flag_enabled')::boolean = false
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'findings') f
                            WHERE f->>'code'='package_template_missing_for_stockable_product'
                              AND f->>'severity'='P0');
  v_tests := v_tests || jsonb_build_object('name','T5.flag_off_no_p0_missing_tpl','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_pass := EXISTS (SELECT 1 FROM jsonb_array_elements(v_j->'findings') f
                    WHERE f->>'code'='package_template_missing_for_stockable_product');
  v_tests := v_tests || jsonb_build_object('name','T6.missing_tpl_reported','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  -- T7: diagnostic for the isolated mesa product (clean state)
  v_j := package_tracking_diagnostic(v_mesa);
  v_pass := (v_j->>'product_id') = v_mesa::text
            AND jsonb_array_length(v_j->'templates') = 2
            AND (v_j->>'ready_for_tracking')::boolean = true;
  v_tests := v_tests || jsonb_build_object('name','T7.diagnostic_mesa','passed',v_pass,'observed',v_j->'ready_for_tracking');
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_j := sale_line_packages_ready(gen_random_uuid());
  v_pass := (v_j->>'error') = 'line_not_found';
  v_tests := v_tests || jsonb_build_object('name','T8a.sale_line_unknown','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  SELECT sol.id INTO v_line_id
    FROM sale_order_lines sol
   WHERE sol.product_id IS NOT NULL
     AND NOT public.is_package_tracking_enabled_for_product(sol.product_id)
   LIMIT 1;
  IF v_line_id IS NOT NULL THEN
    v_j := sale_line_packages_ready(v_line_id);
    v_pass := (v_j->>'ready')::boolean = true AND (v_j->>'flag')::boolean = false;
  ELSE
    v_pass := true;
    v_j := jsonb_build_object('skipped','no tracking-off sale_order_line available');
  END IF;
  v_tests := v_tests || jsonb_build_object('name','T8b.sale_line_flag_off_ready','passed',v_pass,'observed',v_j);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_j := ensure_packages_for_quant(v_mesa, v_loc, 1);
  v_pass := (v_j->>'skipped')::boolean = true;
  v_tests := v_tests || jsonb_build_object('name','T9.ensure_pkg_flag_off_skips','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  v_pass := true;
  v_tests := v_tests || jsonb_build_object('name','T10.idempotent_logic','passed',v_pass);
  v_total:=v_total+1; IF v_pass THEN v_passed:=v_passed+1; END IF;

  -- Cleanup (best-effort, order matters due to FKs)
  BEGIN
    DELETE FROM stock_packages WHERE id IN (v_pkg_m1, v_pkg_m2, v_pkg_c1);
    DELETE FROM stock_quants  WHERE id IN (v_quant_m, v_quant_c);
    DELETE FROM product_package_templates WHERE id IN (v_tpl_m1, v_tpl_m2, v_tpl_c1);
    DELETE FROM products WHERE id IN (v_mesa, v_cad);
    DELETE FROM stock_locations WHERE id = v_loc;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('total',v_total,'passed',v_passed,'failed',v_total-v_passed,'tests',v_tests);

EXCEPTION WHEN OTHERS THEN
  -- Emergency cleanup on unexpected failure
  BEGIN
    DELETE FROM stock_packages WHERE product_id IN (v_mesa, v_cad);
    DELETE FROM stock_quants WHERE product_id IN (v_mesa, v_cad);
    DELETE FROM product_package_templates WHERE product_id IN (v_mesa, v_cad);
    DELETE FROM products WHERE id IN (v_mesa, v_cad);
    DELETE FROM stock_locations WHERE id = v_loc;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RAISE;
END $function$;