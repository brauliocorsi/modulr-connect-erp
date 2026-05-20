
-- F23-D2: Finance bypass cleanup RPCs

-- 1) sale_payment_schedule_upsert
CREATE OR REPLACE FUNCTION public.sale_payment_schedule_upsert(
  _schedule_id uuid,
  _sale_order_id uuid,
  _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_amount numeric := COALESCE((_payload->>'amount')::numeric, 0);
  v_percent numeric := COALESCE((_payload->>'percent')::numeric, 0);
  v_sequence integer := COALESCE((_payload->>'sequence')::integer, 10);
  v_label text := COALESCE(_payload->>'label', 'Parcela');
  v_due_kind text := COALESCE(_payload->>'due_kind', 'on_delivery');
  v_due_date date := NULLIF(_payload->>'due_date','')::date;
  v_due_days integer := NULLIF(_payload->>'due_days','')::integer;
  v_paid numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sale_orders WHERE id = _sale_order_id) THEN
    RAISE EXCEPTION 'Sale order not found';
  END IF;
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'amount must be >= 0';
  END IF;
  IF v_due_kind NOT IN ('on_confirm','on_delivery','fixed_date','days_after_confirm') THEN
    RAISE EXCEPTION 'Invalid due_kind: %', v_due_kind;
  END IF;
  IF v_due_kind = 'fixed_date' AND v_due_date IS NULL THEN
    RAISE EXCEPTION 'due_date required for fixed_date';
  END IF;
  IF v_due_kind = 'days_after_confirm' AND v_due_days IS NULL THEN
    RAISE EXCEPTION 'due_days required for days_after_confirm';
  END IF;

  IF _schedule_id IS NOT NULL THEN
    SELECT paid_amount INTO v_paid FROM sale_payment_schedules
      WHERE id = _schedule_id AND order_id = _sale_order_id;
    IF v_paid IS NULL THEN
      RAISE EXCEPTION 'Schedule not found';
    END IF;
    IF v_amount < COALESCE(v_paid, 0) THEN
      RAISE EXCEPTION 'Cannot reduce amount below already paid (%.2f)', v_paid;
    END IF;
    UPDATE sale_payment_schedules SET
      sequence = v_sequence,
      label = v_label,
      due_kind = v_due_kind,
      due_date = CASE WHEN v_due_kind='fixed_date' THEN v_due_date ELSE NULL END,
      due_days = CASE WHEN v_due_kind='days_after_confirm' THEN v_due_days ELSE NULL END,
      percent = v_percent,
      amount = v_amount
    WHERE id = _schedule_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO sale_payment_schedules(
      order_id, sequence, label, due_kind, due_date, due_days, percent, amount
    ) VALUES (
      _sale_order_id, v_sequence, v_label, v_due_kind,
      CASE WHEN v_due_kind='fixed_date' THEN v_due_date END,
      CASE WHEN v_due_kind='days_after_confirm' THEN v_due_days END,
      v_percent, v_amount
    ) RETURNING id INTO v_id;
  END IF;

  PERFORM recompute_sale_payment_status(_sale_order_id);
  BEGIN
    PERFORM activity_log_event('sale_order', _sale_order_id,
      CASE WHEN _schedule_id IS NULL THEN 'payment_schedule_added' ELSE 'payment_schedule_updated' END,
      v_label || ' · ' || v_amount::text,
      jsonb_build_object('schedule_id', v_id, 'amount', v_amount, 'due_kind', v_due_kind),
      'internal');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN v_id;
END $$;

-- 2) sale_payment_schedule_delete
CREATE OR REPLACE FUNCTION public.sale_payment_schedule_delete(
  _schedule_id uuid,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order uuid;
  v_paid numeric;
  v_allocated integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT order_id, paid_amount INTO v_order, v_paid
    FROM sale_payment_schedules WHERE id = _schedule_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  IF COALESCE(v_paid,0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete schedule with paid amount (%.2f)', v_paid;
  END IF;
  SELECT count(*) INTO v_allocated FROM customer_payments
    WHERE schedule_id = _schedule_id AND state <> 'cancelled';
  IF v_allocated > 0 THEN
    RAISE EXCEPTION 'Schedule has % active payment(s) allocated', v_allocated;
  END IF;

  DELETE FROM sale_payment_schedules WHERE id = _schedule_id;

  PERFORM recompute_sale_payment_status(v_order);
  BEGIN
    PERFORM activity_log_event('sale_order', v_order, 'payment_schedule_deleted',
      COALESCE(_reason, 'Removida'),
      jsonb_build_object('schedule_id', _schedule_id, 'reason', _reason),
      'internal');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 3) cash_movement_reconcile
CREATE OR REPLACE FUNCTION public.cash_movement_reconcile(
  _movement_id uuid,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing timestamptz;
  v_ref text := _payload->>'reference';
  v_notes text := _payload->>'notes';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT reconciled_at INTO v_existing FROM cash_movements WHERE id = _movement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movement not found'; END IF;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  UPDATE cash_movements SET
    reconciled_at = now(),
    reconciled_by = v_uid,
    reference = COALESCE(NULLIF(v_ref,''), reference),
    notes = COALESCE(NULLIF(v_notes,''), notes)
  WHERE id = _movement_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4) cash_movement_unreconcile
CREATE OR REPLACE FUNCTION public.cash_movement_unreconcile(
  _movement_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing timestamptz;
  v_session uuid;
  v_notes text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason required';
  END IF;
  SELECT reconciled_at, session_id, notes INTO v_existing, v_session, v_notes
    FROM cash_movements WHERE id = _movement_id;
  IF v_session IS NULL THEN RAISE EXCEPTION 'Movement not found'; END IF;
  IF v_existing IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  UPDATE cash_movements SET
    reconciled_at = NULL,
    reconciled_by = NULL,
    notes = COALESCE(v_notes || E'\n', '') || '[unreconcile ' || to_char(now(),'YYYY-MM-DD HH24:MI') || '] ' || _reason
  WHERE id = _movement_id;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.sale_payment_schedule_upsert(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_payment_schedule_delete(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_movement_reconcile(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_movement_unreconcile(uuid, text) TO authenticated;
