CREATE OR REPLACE FUNCTION public._cleanup_golden_upm()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_partner_ids uuid[]; v_product_ids uuid[]; v_so_ids uuid[];
  v_mo_ids uuid[]; v_po_ids uuid[]; v_pick_ids uuid[];
  v_route_ids uuid[]; v_schedule_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id),'{}') INTO v_partner_ids FROM partners WHERE name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_product_ids FROM products WHERE name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_so_ids FROM sale_orders WHERE name LIKE v_pfx||'%' OR partner_id = ANY(v_partner_ids);
  SELECT COALESCE(array_agg(id),'{}') INTO v_mo_ids FROM manufacturing_orders WHERE product_id = ANY(v_product_ids) OR sale_order_id = ANY(v_so_ids);
  SELECT COALESCE(array_agg(id),'{}') INTO v_po_ids FROM purchase_orders WHERE partner_id = ANY(v_partner_ids) OR name LIKE v_pfx||'%';
  SELECT COALESCE(array_agg(id),'{}') INTO v_pick_ids FROM stock_pickings WHERE partner_id = ANY(v_partner_ids) OR origin LIKE v_pfx||'%' OR origin IN (SELECT name FROM purchase_orders WHERE id = ANY(v_po_ids));
  SELECT COALESCE(array_agg(id),'{}') INTO v_schedule_ids FROM delivery_schedules WHERE sale_order_id = ANY(v_so_ids) OR partner_id = ANY(v_partner_ids);
  SELECT COALESCE(array_agg(DISTINCT id),'{}') INTO v_route_ids FROM delivery_routes
    WHERE name LIKE v_pfx||'%'
       OR id IN (SELECT DISTINCT route_id FROM delivery_route_orders WHERE schedule_id = ANY(v_schedule_ids));

  BEGIN DELETE FROM delivery_route_cash_closure WHERE route_id = ANY(v_route_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM vehicle_route_manifest WHERE route_id = ANY(v_route_ids) OR schedule_id = ANY(v_schedule_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM dock_transfers WHERE route_id = ANY(v_route_ids) OR schedule_id = ANY(v_schedule_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE order_id = ANY(v_so_ids) OR partner_id = ANY(v_partner_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM cash_movements WHERE route_id = ANY(v_route_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM customer_payments WHERE order_id = ANY(v_so_ids) OR partner_id = ANY(v_partner_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_route_orders WHERE schedule_id = ANY(v_schedule_ids) OR route_id = ANY(v_route_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_schedules WHERE id = ANY(v_schedule_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_routes WHERE id = ANY(v_route_ids); EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM stock_package_movements WHERE stock_package_id IN (SELECT id FROM stock_packages WHERE sale_order_id = ANY(v_so_ids) OR manufacturing_order_id = ANY(v_mo_ids)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_packages WHERE sale_order_id = ANY(v_so_ids) OR manufacturing_order_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_package_templates WHERE product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_workorder_logs WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_issues WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_quality_checks WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_order_outputs WHERE manufacturing_order_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_components WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_operations WHERE mo_id = ANY(v_mo_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_reservation_log WHERE to_manufacturing_order_id = ANY(v_mo_ids) OR origin_id = ANY(v_mo_ids) OR product_id = ANY(v_product_ids); EXCEPTION WHEN OTHERS THEN NULL; END;
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