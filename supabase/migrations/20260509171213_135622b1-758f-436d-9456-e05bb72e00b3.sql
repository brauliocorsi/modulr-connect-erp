CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  license_plate text,
  driver_id uuid,
  cash_register_id uuid REFERENCES public.cash_registers(id) ON DELETE SET NULL,
  barcode text UNIQUE,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "Vehicles readable by authenticated"
  ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Vehicles managed by admin or inv mgr"
  ON public.vehicles FOR ALL TO authenticated
  USING (public.has_group(auth.uid(),'system_admin') OR public.has_group(auth.uid(),'inventory_manager'))
  WITH CHECK (public.has_group(auth.uid(),'system_admin') OR public.has_group(auth.uid(),'inventory_manager'));

ALTER TABLE public.stock_picking_batches
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_date date;
CREATE INDEX IF NOT EXISTS idx_batches_vehicle ON public.stock_picking_batches(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_batches_driver ON public.stock_picking_batches(driver_id);

ALTER TABLE public.cash_registers
  ADD COLUMN IF NOT EXISTS driver_id uuid;
CREATE INDEX IF NOT EXISTS idx_cash_registers_driver ON public.cash_registers(driver_id);

INSERT INTO public.groups(code, name, module, description) VALUES
 ('delivery_driver','Entregador','delivery'::app_module,'Acesso restrito ao módulo de Entregas')
ON CONFLICT (code) DO NOTHING;

DROP POLICY IF EXISTS "Drivers read own batches" ON public.stock_picking_batches;
CREATE POLICY "Drivers read own batches"
  ON public.stock_picking_batches FOR SELECT TO authenticated
  USING (driver_id = auth.uid()
         OR public.has_group(auth.uid(),'system_admin')
         OR public.has_group(auth.uid(),'inventory_user')
         OR public.has_group(auth.uid(),'inventory_manager'));

CREATE OR REPLACE FUNCTION public.driver_assign_batch(_batch uuid, _vehicle uuid, _driver uuid, _date date DEFAULT current_date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM stock_pickings WHERE batch_id = _batch AND kind <> 'outgoing') THEN
    RAISE EXCEPTION 'Batch contém pickings que não são de saída';
  END IF;
  UPDATE stock_picking_batches
     SET vehicle_id=_vehicle, driver_id=_driver, delivery_date=_date,
         state = CASE WHEN state='draft' THEN 'in_progress' ELSE state END,
         updated_at=now()
   WHERE id=_batch;
END $$;

CREATE OR REPLACE FUNCTION public.driver_deliver_picking(
  _picking uuid,
  _payment_amount numeric DEFAULT 0,
  _method_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pk record; bt record; so_id uuid; pay_id uuid;
  v_register uuid; v_session uuid; v_journal uuid;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id=_picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado'; END IF;
  IF pk.kind <> 'outgoing' THEN RAISE EXCEPTION 'Apenas pickings de saída'; END IF;

  SELECT * INTO bt FROM stock_picking_batches WHERE id = pk.batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não pertence a um batch atribuído'; END IF;
  IF bt.driver_id IS DISTINCT FROM auth.uid() AND NOT public.has_group(auth.uid(),'system_admin') THEN
    RAISE EXCEPTION 'Este batch não está atribuído ao motorista atual';
  END IF;

  UPDATE stock_moves SET quantity_done = quantity
   WHERE picking_id = _picking AND coalesce(quantity_done,0) = 0 AND state NOT IN ('done','cancelled');

  PERFORM public.validate_picking(_picking);

  SELECT id INTO so_id FROM sale_orders WHERE name = pk.origin;

  IF _payment_amount > 0 AND so_id IS NOT NULL THEN
    SELECT cash_register_id INTO v_register FROM vehicles WHERE id = bt.vehicle_id;
    IF v_register IS NULL THEN
      SELECT id INTO v_register FROM cash_registers WHERE driver_id = auth.uid() AND active LIMIT 1;
    END IF;
    SELECT default_journal_id INTO v_journal FROM payment_methods WHERE id = _method_id;

    INSERT INTO customer_payments(name, partner_id, order_id, payment_date, amount, method_id, journal_id, reference, state, created_by)
      VALUES ('PAY-DRV-'||substr(gen_random_uuid()::text,1,8),
              pk.partner_id, so_id, current_date, _payment_amount, _method_id, v_journal,
              'Entrega '||pk.name, 'posted', auth.uid())
      RETURNING id INTO pay_id;

    IF v_register IS NOT NULL THEN
      SELECT id INTO v_session FROM cash_sessions WHERE register_id = v_register AND state='open' ORDER BY opened_at DESC LIMIT 1;
      IF v_session IS NOT NULL THEN
        INSERT INTO cash_movements(session_id, kind, amount, reference, partner_id, user_id, payment_id, created_by)
          VALUES (v_session, 'cash_in', _payment_amount, 'Entrega '||pk.name, pk.partner_id, auth.uid(), pay_id, auth.uid());
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('picking', _picking, 'payment_id', pay_id, 'sale_order', so_id);
END $$;