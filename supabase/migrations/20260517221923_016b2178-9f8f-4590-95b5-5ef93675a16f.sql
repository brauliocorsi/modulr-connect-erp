
-- Phase 17 — Etapa 0 — Fix cleanup + diagnostic helper

CREATE OR REPLACE FUNCTION public._cleanup_golden_upm()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_partner_ids uuid[];
  v_product_ids uuid[];
  v_so_ids uuid[];
  v_mo_ids uuid[];
  v_po_ids uuid[];
  v_pick_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id),'{}') INTO v_partner_ids FROM partners WHERE name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_product_ids FROM products WHERE name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_so_ids FROM sale_orders WHERE name LIKE v_pfx||'%' OR partner_id = ANY(v_partner_ids);
  SELECT COALESCE(array_agg(id),'{}') INTO v_mo_ids FROM manufacturing_orders WHERE product_id = ANY(v_product_ids) OR sale_order_id = ANY(v_so_ids);
  SELECT COALESCE(array_agg(id),'{}') INTO v_po_ids FROM purchase_orders WHERE partner_id = ANY(v_partner_ids) OR name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_pick_ids FROM stock_pickings WHERE partner_id = ANY(v_partner_ids) OR origin LIKE v_pfx||'%' OR origin IN (SELECT name FROM purchase_orders WHERE id = ANY(v_po_ids));

  BEGIN DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE name LIKE v_pfx||'%' OR partner_id = ANY(v_partner_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM customer_payments WHERE name LIKE v_pfx||'%' OR partner_id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM cash_sessions WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_route_orders WHERE schedule_id IN (SELECT id FROM delivery_schedules WHERE sale_order_id = ANY(v_so_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_schedules WHERE sale_order_id = ANY(v_so_ids) OR partner_id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_packages WHERE sale_order_id = ANY(v_so_ids) OR manufacturing_order_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_package_templates WHERE product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_workorder_logs WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_issues WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_quality_checks WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_components WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_operations WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_reservation_log WHERE to_manufacturing_order_id = ANY(v_mo_ids) OR origin_id = ANY(v_mo_ids) OR product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  -- break parent links before deleting
  BEGIN UPDATE manufacturing_orders SET parent_mo_id=NULL, root_mo_id=NULL, parent_mo_component_id=NULL WHERE id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_orders WHERE id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_needs WHERE product_id = ANY(v_product_ids) OR suggested_partner_id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_order_lines WHERE order_id = ANY(v_po_ids) OR product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_moves WHERE picking_id = ANY(v_pick_ids) OR product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_pickings WHERE id = ANY(v_pick_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_orders WHERE id = ANY(v_po_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_quants WHERE product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_payment_schedules WHERE order_id = ANY(v_so_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_lines WHERE order_id = ANY(v_so_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_orders WHERE id = ANY(v_so_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE v_pfx||'%' OR product_id = ANY(v_product_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM bom_operations WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE v_pfx||'%' OR product_id = ANY(v_product_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM boms WHERE code LIKE v_pfx||'%' OR product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_machines WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM work_centers WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_suppliers WHERE product_id = ANY(v_product_ids) OR partner_id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM products WHERE id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM partners WHERE id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
END
$function$;

-- Diagnostic helper: full state dump for Etapa 0
CREATE OR REPLACE FUNCTION public._phase17_diag_seed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_residuals jsonb;
  v_seed jsonb;
  v_after_seed jsonb;
BEGIN
  PERFORM public._cleanup_golden_upm();

  SELECT jsonb_build_object(
    'sale_orders',         (SELECT count(*) FROM sale_orders WHERE name LIKE v_pfx||'%'),
    'manufacturing_orders',(SELECT count(*) FROM manufacturing_orders mo JOIN products p ON p.id=mo.product_id WHERE p.name LIKE v_pfx||'%'),
    'mo_components',       (SELECT count(*) FROM mo_components mc JOIN manufacturing_orders mo ON mo.id=mc.mo_id JOIN products p ON p.id=mo.product_id WHERE p.name LIKE v_pfx||'%'),
    'mo_operations',       (SELECT count(*) FROM mo_operations mo2 JOIN manufacturing_orders mo ON mo.id=mo2.mo_id JOIN products p ON p.id=mo.product_id WHERE p.name LIKE v_pfx||'%'),
    'purchase_needs',      (SELECT count(*) FROM purchase_needs pn JOIN products p ON p.id=pn.product_id WHERE p.name LIKE v_pfx||'%'),
    'purchase_orders',     (SELECT count(*) FROM purchase_orders WHERE name LIKE v_pfx||'%' OR partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%')),
    'purchase_order_lines',(SELECT count(*) FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id WHERE p.name LIKE v_pfx||'%'),
    'stock_moves',         (SELECT count(*) FROM stock_moves sm JOIN products p ON p.id=sm.product_id WHERE p.name LIKE v_pfx||'%'),
    'stock_quants',        (SELECT count(*) FROM stock_quants sq JOIN products p ON p.id=sq.product_id WHERE p.name LIKE v_pfx||'%'),
    'stock_packages',      (SELECT count(*) FROM stock_packages sp LEFT JOIN sale_orders so ON so.id=sp.sale_order_id WHERE so.name LIKE v_pfx||'%'),
    'partners',            (SELECT count(*) FROM partners WHERE name LIKE v_pfx||'%'),
    'products',            (SELECT count(*) FROM products WHERE name LIKE v_pfx||'%'),
    'boms',                (SELECT count(*) FROM boms WHERE code LIKE v_pfx||'%'),
    'stock_pickings',      (SELECT count(*) FROM stock_pickings WHERE partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%'))
  ) INTO v_residuals;

  v_seed := public._seed_golden_upm();

  SELECT jsonb_build_object(
    'products',            (SELECT count(*) FROM products WHERE name LIKE v_pfx||'%'),
    'partners',            (SELECT count(*) FROM partners WHERE name LIKE v_pfx||'%'),
    'product_suppliers',   (SELECT count(*) FROM product_suppliers WHERE partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%')),
    'boms',                (SELECT count(*) FROM boms WHERE code LIKE v_pfx||'%'),
    'bom_lines',           (SELECT count(*) FROM bom_lines bl JOIN boms b ON b.id=bl.bom_id WHERE b.code LIKE v_pfx||'%'),
    'bom_operations',      (SELECT count(*) FROM bom_operations bo JOIN boms b ON b.id=bo.bom_id WHERE b.code LIKE v_pfx||'%'),
    'work_centers',        (SELECT count(*) FROM work_centers WHERE name LIKE v_pfx||'%'),
    'package_templates',   (SELECT count(*) FROM product_package_templates WHERE product_id = (v_seed->>'cama')::uuid),
    'sale_orders_PREEXIST',(SELECT count(*) FROM sale_orders WHERE name LIKE v_pfx||'%'),
    'manufacturing_orders_PREEXIST',(SELECT count(*) FROM manufacturing_orders mo JOIN products p ON p.id=mo.product_id WHERE p.name LIKE v_pfx||'%'),
    'purchase_needs_PREEXIST',(SELECT count(*) FROM purchase_needs pn JOIN products p ON p.id=pn.product_id WHERE p.name LIKE v_pfx||'%')
  ) INTO v_after_seed;

  RETURN jsonb_build_object(
    'residuals_after_cleanup', v_residuals,
    'state_after_seed', v_after_seed,
    'seed', v_seed
  );
END $function$;
