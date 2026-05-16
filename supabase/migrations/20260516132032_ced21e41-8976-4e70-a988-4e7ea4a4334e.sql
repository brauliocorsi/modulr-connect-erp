
CREATE OR REPLACE FUNCTION public.delivery_route_cash_summary(_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_route record; v_cash numeric := 0; v_mb numeric := 0; v_trf numeric := 0;
  v_mbway numeric := 0; v_other numeric := 0; v_total numeric := 0;
  v_existing record; v_payments jsonb;
BEGIN
  SELECT * INTO v_route FROM delivery_routes WHERE id=_route_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','route_not_found'); END IF;

  -- Expected from cash_movements bound to this route (deposits only). Exclude variance entries.
  SELECT
    COALESCE(SUM(CASE WHEN cm.reference='PAY:CASH'   THEN cm.amount END),0),
    COALESCE(SUM(CASE WHEN cm.reference='PAY:MBWAY'  THEN cm.amount END),0),
    COALESCE(SUM(CASE WHEN cm.reference='PAY:MB'     THEN cm.amount END),0),
    COALESCE(SUM(CASE WHEN cm.reference='PAY:TRANSF' THEN cm.amount END),0),
    COALESCE(SUM(CASE WHEN cm.reference IS NOT NULL
                       AND cm.reference LIKE 'PAY:%'
                       AND cm.reference NOT IN ('PAY:CASH','PAY:MBWAY','PAY:MB','PAY:TRANSF')
                  THEN cm.amount END),0)
  INTO v_cash, v_mbway, v_mb, v_trf, v_other
  FROM cash_movements cm
  WHERE cm.route_id=_route_id
    AND cm.kind='deposit'
    AND COALESCE(cm.reference,'') LIKE 'PAY:%';

  v_total := v_cash + v_mbway + v_mb + v_trf + v_other;

  SELECT * INTO v_existing FROM delivery_route_cash_closure WHERE route_id=_route_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('payment_id',cp.id,'amount',cp.amount,'method',pm.code)),'[]'::jsonb)
  INTO v_payments
  FROM customer_payments cp
  JOIN payment_methods pm ON pm.id=cp.method_id
  JOIN cash_movements cm ON cm.payment_id=cp.id
  WHERE cm.route_id=_route_id;

  RETURN jsonb_build_object(
    'ok',true,
    'route_id', _route_id,
    'expected_cash', v_cash,
    'expected_mbway', v_mbway,
    'expected_multibanco', v_mb,
    'expected_transfer', v_trf,
    'expected_other', v_other,
    'total_expected', v_total,
    'closure_existing', to_jsonb(v_existing),
    'payments', v_payments
  );
END $$;
