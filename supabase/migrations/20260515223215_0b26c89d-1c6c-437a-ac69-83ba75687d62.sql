
-- ===========================================
-- PHASE 10: Cross-module Accounting Reconciliation
-- ===========================================

CREATE OR REPLACE FUNCTION public.sale_order_reconciliation(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so record;
  v_paid numeric;
  v_refunded numeric;
  v_scheduled numeric;
  v_net numeric;
  v_balance numeric;
  v_expected_status text;
  v_consistent boolean;
BEGIN
  SELECT * INTO v_so FROM public.sale_orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SO not found'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_paid
    FROM public.customer_payments
    WHERE order_id = _order_id AND state = 'posted' AND refund_of IS NULL;

  SELECT COALESCE(SUM(amount),0) INTO v_refunded
    FROM public.customer_payments
    WHERE order_id = _order_id AND refund_of IS NOT NULL;

  SELECT COALESCE(SUM(amount),0) INTO v_scheduled
    FROM public.sale_payment_schedules
    WHERE order_id = _order_id AND COALESCE(state,'') <> 'cancelled';

  v_net := v_paid - v_refunded;
  v_balance := COALESCE(v_so.amount_total,0) - v_net;

  v_expected_status := CASE
    WHEN v_net <= 0.001 THEN 'unpaid'
    WHEN v_net >= COALESCE(v_so.amount_total,0) - 0.001 THEN 'paid'
    ELSE 'partial'
  END;
  v_consistent := (v_so.payment_status = v_expected_status);

  RETURN jsonb_build_object(
    'order_id', v_so.id,
    'order_name', v_so.name,
    'amount_total', v_so.amount_total,
    'paid_posted', v_paid,
    'refunded', v_refunded,
    'net_paid', v_net,
    'balance_due', v_balance,
    'scheduled_total', v_scheduled,
    'payment_status_db', v_so.payment_status,
    'payment_status_expected', v_expected_status,
    'consistent', v_consistent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.daily_finance_snapshot(_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gross_sales numeric;
  v_payments numeric;
  v_refunds numeric;
  v_cash_in numeric;
  v_cash_out numeric;
  v_cash_net numeric;
BEGIN
  SELECT COALESCE(SUM(amount_total),0) INTO v_gross_sales
    FROM public.sale_orders
    WHERE state IN ('confirmed','done')
      AND date_order::date = _date;

  SELECT COALESCE(SUM(amount),0) INTO v_payments
    FROM public.customer_payments
    WHERE state = 'posted' AND refund_of IS NULL AND payment_date = _date;

  SELECT COALESCE(SUM(amount),0) INTO v_refunds
    FROM public.customer_payments
    WHERE refund_of IS NOT NULL AND payment_date = _date;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE amount > 0),0),
    COALESCE(SUM(-amount) FILTER (WHERE amount < 0),0),
    COALESCE(SUM(amount),0)
  INTO v_cash_in, v_cash_out, v_cash_net
  FROM public.cash_movements
  WHERE created_at::date = _date;

  RETURN jsonb_build_object(
    'date', _date,
    'gross_sales', v_gross_sales,
    'payments_posted', v_payments,
    'refunds', v_refunds,
    'net_payments', v_payments - v_refunds,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'cash_net', v_cash_net
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._test_phase10()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner uuid; v_so uuid;
  v_pay uuid; v_refund uuid;
  v_recon jsonb; v_snap jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  INSERT INTO public.partners(name, is_customer) VALUES ('TEST_P10_CUS_'||gen_random_uuid(), true) RETURNING id INTO v_partner;

  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, payment_status)
  VALUES ('TESTSO10_'||substr(gen_random_uuid()::text,1,8), v_partner, 'confirmed', 100, 'unpaid')
  RETURNING id INTO v_so;

  v_recon := public.sale_order_reconciliation(v_so);
  v_results := v_results || jsonb_build_object('test','New SO unpaid (balance=100)',
    'pass', (v_recon->>'balance_due')::numeric = 100 AND (v_recon->>'consistent')::boolean = true);

  -- Add posted payment 60
  INSERT INTO public.customer_payments(name, partner_id, order_id, amount, state)
  VALUES ('TESTPAY10_'||substr(gen_random_uuid()::text,1,8), v_partner, v_so, 60, 'posted')
  RETURNING id INTO v_pay;

  v_recon := public.sale_order_reconciliation(v_so);
  v_results := v_results || jsonb_build_object('test','After payment 60 → net=60, balance=40',
    'pass', (v_recon->>'net_paid')::numeric = 60 AND (v_recon->>'balance_due')::numeric = 40);

  -- Add refund 20
  INSERT INTO public.customer_payments(name, partner_id, order_id, amount, state, refund_of)
  VALUES ('TESTREF10_'||substr(gen_random_uuid()::text,1,8), v_partner, v_so, 20, 'refunded', v_pay)
  RETURNING id INTO v_refund;

  v_recon := public.sale_order_reconciliation(v_so);
  v_results := v_results || jsonb_build_object('test','After refund 20 → net=40, balance=60',
    'pass', (v_recon->>'net_paid')::numeric = 40 AND (v_recon->>'balance_due')::numeric = 60);

  -- Daily snapshot for today
  v_snap := public.daily_finance_snapshot(CURRENT_DATE);
  v_results := v_results || jsonb_build_object('test','Snapshot returns object',
    'pass', v_snap ? 'gross_sales' AND v_snap ? 'net_payments');

  -- Cleanup
  DELETE FROM public.customer_payments WHERE order_id = v_so;
  DELETE FROM public.sale_orders WHERE id = v_so;
  DELETE FROM public.partners WHERE id = v_partner;

  RETURN jsonb_build_object(
    'phase', 10,
    'tests', v_results,
    'pass_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_results) e WHERE (e->>'pass')::boolean),
    'total', jsonb_array_length(v_results)
  );
END;
$$;
