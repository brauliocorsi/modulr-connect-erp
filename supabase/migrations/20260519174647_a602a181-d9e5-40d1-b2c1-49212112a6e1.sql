
CREATE OR REPLACE FUNCTION public.erp_financial_health_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_findings jsonb := '[]'::jsonb; v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_count int; v_started timestamptz := clock_timestamp();
BEGIN
  SELECT count(*) INTO v_count FROM customer_credits WHERE remaining_amount < 0;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','customer_credit_negative','severity','p0','count',v_count,'message','Créditos negativos')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM supplier_bills WHERE amount_paid > amount_total + 0.001 AND state <> 'cancelled';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','supplier_bill_paid_above_total','severity','p0','count',v_count,'message','Faturas pagas acima do total')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM customer_credits c
    JOIN (SELECT credit_id, SUM(amount) s FROM customer_credit_applications WHERE reversed_at IS NULL GROUP BY credit_id) a ON a.credit_id=c.id
   WHERE a.s > c.amount + 0.001;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','customer_credit_overapplied','severity','p0','count',v_count,'message','Crédito sobre-aplicado')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM (SELECT reversal_of_id FROM cash_movements WHERE reversal_of_id IS NOT NULL GROUP BY reversal_of_id HAVING count(*) > 1) x;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','reversed_cash_movement_twice','severity','p0','count',v_count,'message','Reversões duplicadas')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT sbl.po_line_id, pol.quantity, SUM(sbl.quantity) tot
      FROM supplier_bill_lines sbl JOIN supplier_bills sb ON sb.id=sbl.bill_id
      JOIN purchase_order_lines pol ON pol.id=sbl.po_line_id
     WHERE sb.state<>'cancelled' AND sbl.po_line_id IS NOT NULL
     GROUP BY sbl.po_line_id, pol.quantity HAVING SUM(sbl.quantity) > pol.quantity + 0.001) y;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','duplicated_supplier_bill_for_po_line','severity','p0','count',v_count,'message','Overbilling em PO line')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM customer_payments cp JOIN payment_methods pm ON pm.id=cp.method_id
   WHERE cp.state='posted' AND pm.feeds_cash_session=true
     AND NOT EXISTS (SELECT 1 FROM cash_movements cm WHERE cm.payment_id=cp.id);
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','payment_posted_without_cash_movement','severity','p0','count',v_count,'message','Pagamento sem cash_movement')); v_p0 := v_p0 + 1; END IF;

  SELECT count(*) INTO v_count FROM supplier_bills sb WHERE sb.state NOT IN ('draft','cancelled')
     AND NOT EXISTS (SELECT 1 FROM supplier_bill_lines x WHERE x.bill_id=sb.id);
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','supplier_bill_without_lines','severity','p1','count',v_count,'message','Faturas sem linhas')); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM customer_credit_applications a WHERE NOT EXISTS (SELECT 1 FROM customer_credits c WHERE c.id=a.credit_id);
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','orphan_customer_credit_application','severity','p1','count',v_count,'message','Aplicações órfãs')); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM service_case_charges WHERE partner_id IS NULL;
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','service_case_charge_without_partner','severity','p1','count',v_count,'message','Cobrança sem partner')); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM service_case_costs c WHERE NOT EXISTS (SELECT 1 FROM service_cases s WHERE s.id=c.service_case_id);
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','service_case_cost_without_case','severity','p1','count',v_count,'message','Custos órfãos')); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM customer_credits WHERE state='open' AND remaining_amount>0 AND created_at < now() - interval '90 days';
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','unapplied_customer_credit_aged','severity','p1','count',v_count,'message','Créditos antigos abertos')); v_p1 := v_p1 + 1; END IF;

  SELECT count(*) INTO v_count FROM cash_movements WHERE reversal_of_id IS NOT NULL AND created_at > now() - interval '30 days';
  IF v_count > 5 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','excessive_manual_cash_reversals','severity','p2','count',v_count,'message','Excesso de reversões')); v_p2 := v_p2 + 1; END IF;

  SELECT count(*) INTO v_count FROM service_cases sc
   WHERE sc.status = 'done'::service_case_status
     AND NOT EXISTS (SELECT 1 FROM service_case_costs c WHERE c.service_case_id=sc.id)
     AND NOT EXISTS (SELECT 1 FROM service_case_charges ch WHERE ch.service_case_id=sc.id);
  IF v_count > 0 THEN v_findings := v_findings || jsonb_build_array(jsonb_build_object('code','assistance_cases_without_cost_tracking','severity','p2','count',v_count,'message','Casos done sem custo nem cobrança')); v_p2 := v_p2 + 1; END IF;

  RETURN jsonb_build_object('ok',(v_p0=0),'findings',v_findings,
    'summary',jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'duration_ms',extract(milliseconds from clock_timestamp()-v_started)::int));
END $$;
