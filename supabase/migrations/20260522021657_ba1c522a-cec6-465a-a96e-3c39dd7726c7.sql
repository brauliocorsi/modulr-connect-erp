-- Allow delivery drivers to see their own cashbox, sessions, and movements

-- cash_registers: driver can see own register
DROP POLICY IF EXISTS cash_registers_driver_view ON public.cash_registers;
CREATE POLICY cash_registers_driver_view ON public.cash_registers
FOR SELECT TO authenticated
USING (
  has_group(auth.uid(), 'delivery_driver') AND driver_id = auth.uid()
);

-- cash_sessions: driver can see sessions of own register
DROP POLICY IF EXISTS cash_sessions_driver_view ON public.cash_sessions;
CREATE POLICY cash_sessions_driver_view ON public.cash_sessions
FOR SELECT TO authenticated
USING (
  has_group(auth.uid(), 'delivery_driver')
  AND EXISTS (
    SELECT 1 FROM public.cash_registers cr
    WHERE cr.id = cash_sessions.register_id
      AND cr.driver_id = auth.uid()
  )
);

-- cash_sessions: driver can update its own session (handover via RPC also needs it; RPCs are SECURITY DEFINER, but for safety)
DROP POLICY IF EXISTS cash_sessions_driver_manage ON public.cash_sessions;
CREATE POLICY cash_sessions_driver_manage ON public.cash_sessions
FOR ALL TO authenticated
USING (
  has_group(auth.uid(), 'delivery_driver')
  AND EXISTS (
    SELECT 1 FROM public.cash_registers cr
    WHERE cr.id = cash_sessions.register_id
      AND cr.driver_id = auth.uid()
  )
)
WITH CHECK (
  has_group(auth.uid(), 'delivery_driver')
  AND EXISTS (
    SELECT 1 FROM public.cash_registers cr
    WHERE cr.id = cash_sessions.register_id
      AND cr.driver_id = auth.uid()
  )
);

-- cash_movements: driver can see movements of own sessions
DROP POLICY IF EXISTS cash_movements_driver_view ON public.cash_movements;
CREATE POLICY cash_movements_driver_view ON public.cash_movements
FOR SELECT TO authenticated
USING (
  has_group(auth.uid(), 'delivery_driver')
  AND EXISTS (
    SELECT 1 FROM public.cash_sessions cs
    JOIN public.cash_registers cr ON cr.id = cs.register_id
    WHERE cs.id = cash_movements.session_id
      AND cr.driver_id = auth.uid()
  )
);

-- payment_methods read for drivers (needed for join in DeliveryCashbox)
DROP POLICY IF EXISTS payment_methods_driver_view ON public.payment_methods;
CREATE POLICY payment_methods_driver_view ON public.payment_methods
FOR SELECT TO authenticated
USING ( has_group(auth.uid(), 'delivery_driver') );