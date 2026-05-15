DO $$
DECLARE r record;
BEGIN
  DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM customer_payments WHERE name LIKE 'TESTE_E2E_%';
  DELETE FROM sale_payment_schedules WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE 'TESTE_E2E_%');
  DELETE FROM stock_pickings WHERE origin LIKE 'TESTE_E2E_%';
  DELETE FROM mo_workorder_logs WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%'));
  DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%'));
  DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%'));
  DELETE FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM sale_orders WHERE name LIKE 'TESTE_E2E_%';
  DELETE FROM bom_operations WHERE bom_id IN (SELECT id FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'TESTE_E2E_%'));
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'TESTE_E2E_%'));
  DELETE FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'TESTE_E2E_%');
  DELETE FROM partners WHERE name LIKE 'TESTE_E2E_%';
  DELETE FROM products WHERE name LIKE 'TESTE_E2E_%';
END $$;