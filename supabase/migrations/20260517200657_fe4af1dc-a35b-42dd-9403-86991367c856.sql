-- Fix FK: operator_id is an hr_employees.id, not auth.users.id
ALTER TABLE public.mo_workorder_logs DROP CONSTRAINT IF EXISTS mo_workorder_logs_operator_id_fkey;
ALTER TABLE public.mo_workorder_logs
  ADD CONSTRAINT mo_workorder_logs_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.hr_employees(id) ON DELETE SET NULL;

-- Replace broken RLS policies that compared hr_employees.id with auth.uid()
DROP POLICY IF EXISTS "mowl_insert" ON public.mo_workorder_logs;
DROP POLICY IF EXISTS "mowl_update" ON public.mo_workorder_logs;
CREATE POLICY "mowl_insert" ON public.mo_workorder_logs
  FOR INSERT WITH CHECK (public.mfg_can_operate(auth.uid()));
CREATE POLICY "mowl_update" ON public.mo_workorder_logs
  FOR UPDATE USING (public.mfg_can_manage(auth.uid()))
  WITH CHECK (public.mfg_can_manage(auth.uid()));

-- Patch work_order_start: critical-component check must also block when component has no operation_id (MO-level critical)
CREATE OR REPLACE FUNCTION public.work_order_start(_work_order_id uuid, _employee_id uuid DEFAULT NULL, _machine_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE wo record; mch record; v_prev int; v_busy int;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id = _work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state NOT IN ('ready','paused') THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_READY: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  SELECT count(*) INTO v_prev FROM public.mo_operations
    WHERE mo_id = wo.mo_id AND sequence < wo.sequence
      AND state IN ('pending','ready','in_progress','paused','blocked');
  IF v_prev > 0 THEN RAISE EXCEPTION 'SEQUENCE_VIOLATION' USING ERRCODE='P0001'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.mo_components c
    WHERE c.mo_id = wo.mo_id
      AND (c.operation_id IS NULL OR c.operation_id = wo.operation_id)
      AND c.is_critical = true
      AND COALESCE(c.qty_reserved,0) < c.qty_required
  ) THEN
    UPDATE public.mo_operations SET state='blocked', block_reason='CRITICAL_COMPONENT_MISSING' WHERE id=_work_order_id;
    RAISE EXCEPTION 'CRITICAL_COMPONENT_MISSING' USING ERRCODE='P0001';
  END IF;
  IF _machine_id IS NOT NULL THEN
    SELECT * INTO mch FROM public.manufacturing_machines WHERE id=_machine_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MACHINE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF mch.status NOT IN ('available') THEN
      RAISE EXCEPTION 'MACHINE_UNAVAILABLE: status=%', mch.status USING ERRCODE='P0001';
    END IF;
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE machine_id=_machine_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'MACHINE_BUSY' USING ERRCODE='P0001'; END IF;
    UPDATE public.manufacturing_machines SET status='busy', updated_at=now() WHERE id=_machine_id;
  END IF;
  IF _employee_id IS NOT NULL THEN
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE assigned_employee_id=_employee_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'EMPLOYEE_BUSY' USING ERRCODE='P0001'; END IF;
  END IF;
  UPDATE public.mo_operations SET
    state = 'in_progress',
    actual_start_at = COALESCE(actual_start_at, now()),
    started_at = COALESCE(started_at, now()),
    assigned_employee_id = COALESCE(_employee_id, assigned_employee_id),
    machine_id = COALESCE(_machine_id, machine_id),
    block_reason = NULL
  WHERE id = _work_order_id;
  INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, qty_done, qty_scrap, notes)
  VALUES (_work_order_id, wo.mo_id, _employee_id, now(), 0, 0, 'start');
  IF (SELECT state FROM public.manufacturing_orders WHERE id = wo.mo_id) IN ('draft','ready','waiting_material') THEN
    UPDATE public.manufacturing_orders SET state='in_progress', actual_start=COALESCE(actual_start, now()), updated_at=now()
      WHERE id = wo.mo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'work_order_id', _work_order_id, 'state','in_progress');
END
$fn$;