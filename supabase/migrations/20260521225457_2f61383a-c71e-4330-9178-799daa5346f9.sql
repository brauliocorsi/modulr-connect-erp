
BEGIN;

-- 1) Transacionais (TRUNCATE CASCADE resolve FKs entre eles)
TRUNCATE TABLE
  public.sale_split_payment_allocations,
  public.sale_payment_schedules,
  public.sale_operational_plan_log,
  public.sale_order_timeline,
  public.sale_order_line_supply_links,
  public.sale_order_lines,
  public.sale_orders,
  public.supplier_payments,
  public.supplier_bill_lines,
  public.supplier_bills,
  public.purchase_needs,
  public.purchase_order_origins,
  public.purchase_order_lines,
  public.purchase_orders,
  public.inventory_adjustment_lines,
  public.inventory_adjustments,
  public.dock_transfers,
  public.stock_reservation_log,
  public.stock_package_movements,
  public.stock_packages,
  public.stock_lots,
  public.stock_quants,
  public.stock_moves,
  public.stock_picking_waves,
  public.stock_picking_batches,
  public.stock_pickings,
  public.package_damage_report,
  public.package_damage_reports,
  public.customer_pickups,
  public.vehicle_route_manifest,
  public.delivery_schedules,
  public.delivery_route_cash_closure,
  public.delivery_route_orders,
  public.delivery_routes,
  public.customer_credit_applications,
  public.customer_credits,
  public.bank_reconciliation_lines,
  public.bank_reconciliation_batches,
  public.cash_movements,
  public.cash_sessions,
  public.customer_payments,
  public.mo_issues,
  public.mo_workorder_logs,
  public.mo_quality_checks,
  public.mo_operations,
  public.mo_components,
  public.manufacturing_order_outputs,
  public.manufacturing_orders,
  public.customer_ticket_attachments,
  public.customer_ticket_messages,
  public.customer_tickets,
  public.service_tasks,
  public.service_requests,
  public.service_case_attachments,
  public.service_case_costs,
  public.service_case_charges,
  public.service_case_items,
  public.service_cases,
  public.woo_sync_log,
  public._test_regression_log,
  public._test_phase17_log,
  public._phase17_runs,
  public._p20_run_log,
  public._m3_test_result,
  public.erp_tasks,
  public.erp_remediation_log,
  public.erp_health_check_log,
  public.activity_events,
  public.module_events,
  public.allocation_hook_events,
  public.allocation_decisions,
  public.record_activities,
  public.record_messages,
  public.notifications,
  public.notification_delivery_log,
  public.conversation_attachments,
  public.conversation_messages,
  public.conversation_participants,
  public.conversation_threads,
  public.chat_messages
RESTART IDENTITY CASCADE;

-- 2) Dependências dos produtos (apenas das que vão sair)
DELETE FROM public.bom_lines WHERE component_product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.bom_lines WHERE bom_id IN (
  SELECT id FROM public.boms WHERE product_id NOT IN (
    '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
    '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e'));

DELETE FROM public.bom_operations WHERE bom_id IN (
  SELECT id FROM public.boms WHERE product_id NOT IN (
    '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
    '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e'));

DELETE FROM public.bom_variant_rules WHERE bom_id IN (
  SELECT id FROM public.boms WHERE product_id NOT IN (
    '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
    '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e'));

DELETE FROM public.boms WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_packages WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_suppliers WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.reordering_rules WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.putaway_rules WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.pricelist_items WHERE product_id IS NOT NULL AND product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_tag_rel WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_variants WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_template_attributes WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

DELETE FROM public.product_woo_categories WHERE product_id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

-- 3) Apagar produtos não-chave
DELETE FROM public.products WHERE id NOT IN (
  '218298a2-863c-4cde-b95c-7e949a3dbade','9be30b8e-a281-4cb3-ba7a-7732a1ef75f2',
  '84beca51-a6cd-4df0-b406-4807bc1538b2','6dbb954d-58e0-4dc7-83e4-ad8754d81b3e');

-- 4) Reiniciar sequências numéricas
UPDATE public.number_sequences SET next_number = 1;

COMMIT;
