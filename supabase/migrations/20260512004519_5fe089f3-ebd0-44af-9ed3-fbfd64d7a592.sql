-- Wipe transactional data for fresh testing
TRUNCATE TABLE
  public.cash_movements,
  public.cash_sessions,
  public.customer_payments,
  public.supplier_payments,
  public.sale_payment_schedules,
  public.sale_order_lines,
  public.sale_orders,
  public.purchase_order_lines,
  public.purchase_order_origins,
  public.purchase_orders,
  public.supplier_bills,
  public.stock_moves,
  public.stock_pickings,
  public.stock_picking_batches,
  public.stock_picking_waves,
  public.stock_quants
RESTART IDENTITY CASCADE;