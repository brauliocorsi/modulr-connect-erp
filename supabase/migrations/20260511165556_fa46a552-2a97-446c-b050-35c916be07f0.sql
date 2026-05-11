-- stock_pickings: drivers can view / update delivery-stage pickings
CREATE POLICY "drivers_view_delivery_pickings" ON public.stock_pickings
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

CREATE POLICY "drivers_update_delivery_pickings" ON public.stock_pickings
  FOR UPDATE TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'))
  WITH CHECK (has_group(auth.uid(), 'delivery_driver'));

-- stock_moves
CREATE POLICY "drivers_view_moves" ON public.stock_moves
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

CREATE POLICY "drivers_update_moves" ON public.stock_moves
  FOR UPDATE TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'))
  WITH CHECK (has_group(auth.uid(), 'delivery_driver'));

-- partners (customer info)
CREATE POLICY "drivers_view_partners" ON public.partners
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

-- sale_orders (to compute open balance)
CREATE POLICY "drivers_view_sale_orders" ON public.sale_orders
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

-- payment_methods
CREATE POLICY "drivers_view_methods" ON public.payment_methods
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

-- customer_payments (drivers receive in cash)
CREATE POLICY "drivers_view_payments" ON public.customer_payments
  FOR SELECT TO authenticated
  USING (has_group(auth.uid(), 'delivery_driver'));

CREATE POLICY "drivers_insert_payments" ON public.customer_payments
  FOR INSERT TO authenticated
  WITH CHECK (has_group(auth.uid(), 'delivery_driver'));