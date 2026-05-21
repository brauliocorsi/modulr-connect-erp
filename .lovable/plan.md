## Objetivo

Resetar dados transacionais e produtos gerados por testes para começar uma nova bateria de testes manuais.

## Produtos a manter (4)

- Cama Armani
- Cadeira Baltic
- Cama Gomos Alongada
- Casco Cama Simples

Todos os outros ~60 produtos (a maioria `F16B04_…_*` gerados por scripts de teste) serão eliminados.

## Domínios a apagar (TRUNCATE)

**Vendas**
- `sale_orders`, `sale_order_lines`, `sale_order_fulfillment`, `sale_order_line_supply_links`, `sale_order_timeline`, `sale_operational_plan_log`, `sale_payment_schedules`, `sale_split_payment_allocations`

**Compras**
- `purchase_orders`, `purchase_order_lines`, `purchase_order_origins`, `purchase_needs`, `supplier_bills`, `supplier_bill_lines`, `supplier_payments`

**Inventário / movimentos**
- `stock_moves`, `stock_pickings`, `stock_picking_batches`, `stock_picking_waves`, `stock_quants`, `stock_lots`, `stock_packages`, `stock_package_movements`, `stock_reservation_log`, `inventory_adjustments`, `inventory_adjustment_lines`, `dock_transfers`

**Rotas e entregas**
- `delivery_routes`, `delivery_route_orders`, `delivery_route_cash_closure`, `delivery_schedules`, `vehicle_route_manifest`, `customer_pickups`, `package_damage_reports`, `package_damage_report`

**Financeiro / caixa**
- `customer_payments`, `cash_movements`, `cash_sessions`, `bank_reconciliation_batches`, `bank_reconciliation_lines`, `customer_credits`, `customer_credit_applications`

**Manufatura (movimentos)**
- `manufacturing_orders`, `manufacturing_order_outputs`, `mo_components`, `mo_operations`, `mo_quality_checks`, `mo_workorder_logs`, `mo_issues`

**Serviços/helpdesk (opcional — confirmar)**
- `service_cases`, `service_case_items`, `service_case_charges`, `service_case_costs`, `service_case_attachments`, `service_requests`, `service_tasks`, `customer_tickets`, `customer_ticket_messages`, `customer_ticket_attachments`

**Logs/auditoria de teste**
- `allocation_decisions`, `allocation_hook_events`, `module_events`, `activity_events`, `erp_health_check_log`, `erp_remediation_log`, `erp_tasks`, `_m3_test_result`, `_p20_run_log`, `_phase17_runs`, `_test_phase17_log`, `_test_regression_log`, `woo_sync_log`

**Produtos**
- `DELETE FROM products WHERE name NOT IN (...4 nomes...)`
- Cascade nas dependências: `product_packages`, `product_suppliers`, `product_variants`, `product_template_attributes`, `product_variant_values`, `bom_lines`, `boms`, `reordering_rules`, `putaway_rules`, `pricelist_items`, `product_tag_rel`, `product_stock_forecast`

## Domínios a MANTER

- Estrutura: `warehouses`, `stock_locations`, `loading_docks`, `loading_dock_lanes`, `warehouse_bins`, `warehouse_pallets`
- Cadastros: `partners`, `vehicles`, `delivery_carriers`, `delivery_zones`, `delivery_zip_rules`, `delivery_region_rules`, `delivery_route_templates`
- Maestros: `product_categories`, `product_uom`, `product_tags`, `product_attributes`, `product_attribute_values`, `pricelists` (cabeçalhos)
- HR: `hr_employees`, `hr_departments`, `work_centers`, `manufacturing_machines`
- Configuração: `companies`, `stores`, `groups`, `payment_methods`, `account_journals`, `cash_registers`, `service_states`, `service_sla_policies`, `installed_modules`, `app_settings`, `number_sequences`
- Utilizadores: `profiles`, `user_groups`, `user_list_views`, `saved_searches`, `notification_preferences`
- Conversas/notificações: limpar `chat_messages`, `conversation_messages`, `notifications`, `record_messages`, `record_activities` (são ruído de teste)

## Execução

Uma única migration em transação, com `TRUNCATE ... RESTART IDENTITY CASCADE` para os transacionais (mais rápido e resolve FKs automaticamente), seguido de `DELETE FROM products WHERE id NOT IN (...)`.

## Confirmações que preciso de ti antes de executar

1. **Partners (clientes/fornecedores)**: manter ou apagar? (assumo **manter**)
2. **Service cases / helpdesk tickets**: apagar também? (assumo **sim**)
3. **Chat/notificações/atividades**: apagar histórico? (assumo **sim**)
4. **Sequências numéricas** (`number_sequences`): resetar para 1 para os próximos docs começarem em SO001 etc? (assumo **sim**)
5. **BOMs dos 4 produtos mantidos**: manter? (assumo **sim**)

Responde com confirmação ou ajustes e eu corro a migration.