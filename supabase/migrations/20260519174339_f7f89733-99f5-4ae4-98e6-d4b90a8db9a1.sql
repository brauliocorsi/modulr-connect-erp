
CREATE OR REPLACE FUNCTION public._test_phase20_financial_core(_cleanup boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pfx text := 'P20_'||to_char(now(),'YYYYMMDDHH24MISSMS')||'_';
  v_cust uuid; v_sup uuid; v_prod uuid; v_so uuid; v_so_cancelled uuid;
  v_po uuid; v_pol1 uuid; v_pol2 uuid; v_bill uuid; v_bill2 uuid;
  v_reg uuid; v_sess uuid; v_method uuid; v_pay uuid; v_cm uuid;
  v_case uuid; v_case_warranty uuid; v_credit uuid;
  v_res jsonb; v_health jsonb;
  v_report jsonb := '[]'::jsonb; v_pass boolean; v_ok int:=0; v_fail int:=0; v_detail text;
BEGIN
  INSERT INTO partners(name, kind, is_customer) VALUES (v_pfx||'CUST','individual'::partner_kind, true) RETURNING id INTO v_cust;
  INSERT INTO partners(name, kind, is_supplier) VALUES (v_pfx||'SUP','company'::partner_kind, true) RETURNING id INTO v_sup;
  INSERT INTO products(name, sku, type) VALUES (v_pfx||'PROD', v_pfx||'SKU','storable') RETURNING id INTO v_prod;
  INSERT INTO sale_orders(name, partner_id, state) VALUES (v_pfx||'SO', v_cust, 'confirmed'::sale_state) RETURNING id INTO v_so;
  INSERT INTO sale_orders(name, partner_id, state) VALUES (v_pfx||'SO-X', v_cust, 'cancelled'::sale_state) RETURNING id INTO v_so_cancelled;
  INSERT INTO purchase_orders(name, partner_id, state) VALUES (v_pfx||'PO', v_sup, 'confirmed'::purchase_state) RETURNING id INTO v_po;
  INSERT INTO purchase_order_lines(order_id, product_id, description, quantity, unit_price, subtotal)
    VALUES (v_po, v_prod, 'L1', 10, 5.00, 50.00) RETURNING id INTO v_pol1;
  INSERT INTO purchase_order_lines(order_id, product_id, description, quantity, unit_price, subtotal)
    VALUES (v_po, v_prod, 'L2', 4, 25.00, 100.00) RETURNING id INTO v_pol2;
  INSERT INTO cash_registers(name) VALUES (v_pfx||'REG') RETURNING id INTO v_reg;
  INSERT INTO cash_sessions(name, register_id, state, opening_balance) VALUES (v_pfx||'SESS', v_reg, 'open', 0) RETURNING id INTO v_sess;
  SELECT id INTO v_method FROM payment_methods WHERE active=true LIMIT 1;

  v_res := create_customer_credit(v_cust, 100.00, 'devolução', NULL, NULL, v_pfx||'IDEM1');
  v_credit := (v_res->>'credit_id')::uuid;
  v_pass := (v_res->>'ok')::bool AND v_credit IS NOT NULL
            AND EXISTS(SELECT 1 FROM customer_credits WHERE id=v_credit AND remaining_amount=100.00 AND state='open');
  v_report:=v_report||jsonb_build_object('id','01_credit_created','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := create_customer_credit(v_cust, 100.00, 'devolução', NULL, NULL, v_pfx||'IDEM1');
  v_pass := (v_res->>'credit_id')::uuid = v_credit AND (v_res->>'idempotent')::bool;
  v_report:=v_report||jsonb_build_object('id','02_credit_create_idem','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := apply_customer_credit(v_credit, 30.00, v_so, NULL, 'parcial1');
  v_pass := (v_res->>'ok')::bool AND (SELECT remaining_amount FROM customer_credits WHERE id=v_credit) = 70.00;
  v_report:=v_report||jsonb_build_object('id','03_credit_partial_apply','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := apply_customer_credit(v_credit, 999.00, v_so, NULL, NULL);
  v_pass := v_res->>'error' = 'amount_exceeds_remaining';
  v_report:=v_report||jsonb_build_object('id','04_credit_prevent_overapply','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_res::text);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := apply_customer_credit(v_credit, 10.00, v_so_cancelled, NULL, NULL);
  v_pass := v_res->>'error' = 'sale_order_cancelled';
  v_report:=v_report||jsonb_build_object('id','05_credit_blocks_cancelled_so','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_res::text);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  INSERT INTO cash_movements(session_id, kind, amount, notes) VALUES (v_sess, 'expense', -25.00, 'teste') RETURNING id INTO v_cm;
  v_res := cash_movement_reverse(v_cm, 'erro');
  v_pass := (v_res->>'ok')::bool AND EXISTS(SELECT 1 FROM cash_movements WHERE reversal_of_id=v_cm AND amount=25.00);
  v_report:=v_report||jsonb_build_object('id','06_cash_reverse','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := cash_movement_reverse(v_cm, 'erro 2');
  v_pass := v_res->>'error' = 'already_reversed';
  v_report:=v_report||jsonb_build_object('id','07_cash_double_reverse_blocked','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_bill_create_from_po(v_po, jsonb_build_array(jsonb_build_object('po_line_id',v_pol1,'quantity',4)), v_pfx||'BIDEM1', NULL, NULL);
  v_bill := (v_res->>'bill_id')::uuid;
  v_pass := (v_res->>'ok')::bool AND v_bill IS NOT NULL AND (SELECT amount_total FROM supplier_bills WHERE id=v_bill) = 20.00;
  v_report:=v_report||jsonb_build_object('id','08_bill_from_po_partial','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_bill_create_from_po(v_po, jsonb_build_array(jsonb_build_object('po_line_id',v_pol1,'quantity',4)), v_pfx||'BIDEM1', NULL, NULL);
  v_pass := (v_res->>'bill_id')::uuid = v_bill AND (v_res->>'idempotent')::bool;
  v_report:=v_report||jsonb_build_object('id','09_bill_idempotent','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_bill_create_from_po(v_po, jsonb_build_array(
              jsonb_build_object('po_line_id',v_pol1,'quantity',6),
              jsonb_build_object('po_line_id',v_pol2,'quantity',4)), v_pfx||'BIDEM2', NULL, NULL);
  v_bill2 := (v_res->>'bill_id')::uuid;
  v_pass := (v_res->>'ok')::bool AND (SELECT amount_total FROM supplier_bills WHERE id=v_bill2) = 130.00;
  v_report:=v_report||jsonb_build_object('id','10_bill_partial_second','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  BEGIN
    PERFORM supplier_bill_create_from_po(v_po, jsonb_build_array(jsonb_build_object('po_line_id',v_pol1,'quantity',1)), v_pfx||'BIDEM3', NULL, NULL);
    v_pass := false; v_detail := 'no_exception';
  EXCEPTION WHEN OTHERS THEN v_pass := SQLERRM LIKE '%overbilling%'; v_detail := SQLERRM; END;
  v_report:=v_report||jsonb_build_object('id','11_overbilling_blocked','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_detail);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_payment_register(v_bill, 10.00, v_method, NULL, NULL, v_pfx||'PIDEM1');
  v_pay := (v_res->>'payment_id')::uuid;
  v_pass := (v_res->>'ok')::bool AND (SELECT amount_paid FROM supplier_bills WHERE id=v_bill) = 10.00
            AND (SELECT state FROM supplier_bills WHERE id=v_bill) = 'partial';
  v_report:=v_report||jsonb_build_object('id','12_supplier_payment_partial','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_payment_register(v_bill, 10.00, v_method, NULL, NULL, v_pfx||'PIDEM1');
  v_pass := (v_res->>'payment_id')::uuid = v_pay AND (v_res->>'idempotent')::bool;
  v_report:=v_report||jsonb_build_object('id','13_supplier_pay_idem','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_payment_register(v_bill, 15.00, v_method, NULL, NULL, v_pfx||'POVER');
  v_pass := v_res->>'error' = 'overpayment';
  v_report:=v_report||jsonb_build_object('id','14_supplier_overpayment_blocked','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_res::text);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := supplier_payment_cancel(v_pay, 'erro');
  v_pass := (v_res->>'ok')::bool AND (SELECT amount_paid FROM supplier_bills WHERE id=v_bill) = 0
            AND (SELECT state FROM supplier_bills WHERE id=v_bill) = 'open';
  v_report:=v_report||jsonb_build_object('id','15_supplier_payment_cancel_recompute','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  INSERT INTO service_cases(case_number, customer_id, case_type, source, warranty_status, status)
    VALUES (v_pfx||'SC1', v_cust, 'customer_claim'::service_case_type,'customer'::service_case_source,
            'out_of_warranty'::service_case_warranty_status, 'in_progress'::service_case_status)
    RETURNING id INTO v_case;
  INSERT INTO service_cases(case_number, customer_id, case_type, source, warranty_status, status)
    VALUES (v_pfx||'SC2', v_cust, 'warranty'::service_case_type,'customer'::service_case_source,
            'in_warranty'::service_case_warranty_status,'in_progress'::service_case_status)
    RETURNING id INTO v_case_warranty;

  v_res := service_case_cost_add(v_case, 'internal', 'mão de obra', 2, 15.50, NULL, NULL);
  v_pass := (v_res->>'ok')::bool AND (v_res->>'total_cost')::numeric = 31.00;
  v_report:=v_report||jsonb_build_object('id','16_assist_internal_cost','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := service_case_cost_add(v_case, 'supplier', 'peça', 1, 80.00, v_sup, NULL);
  v_pass := (v_res->>'ok')::bool AND (v_res->>'total_cost')::numeric = 80.00;
  v_report:=v_report||jsonb_build_object('id','17_assist_supplier_cost','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := service_case_charge_add(v_case, v_cust, 'charge', 50.00, NULL, NULL, NULL);
  v_pass := (v_res->>'ok')::bool AND EXISTS(SELECT 1 FROM service_case_charges WHERE service_case_id=v_case AND kind='charge');
  v_report:=v_report||jsonb_build_object('id','18_assist_customer_charge','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_res := service_case_charge_add(v_case_warranty, v_cust, 'charge', 50.00, NULL, NULL, NULL);
  v_pass := v_res->>'error' = 'warranty_blocks_customer_charge';
  v_report:=v_report||jsonb_build_object('id','19_warranty_blocks_charge','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_health := erp_financial_health_check();
  v_pass := v_health ? 'ok' AND v_health ? 'findings'
            AND v_health->'summary' ? 'p0' AND v_health->'summary' ? 'p1' AND v_health->'summary' ? 'p2';
  v_report:=v_report||jsonb_build_object('id','20_health_shape_p0_p1_p2','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  UPDATE supplier_bills SET amount_paid = amount_total + 1 WHERE id = v_bill2;
  v_health := erp_financial_health_check();
  v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f WHERE f->>'code'='supplier_bill_paid_above_total');
  v_report:=v_report||jsonb_build_object('id','21_health_detects_overpayment','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  UPDATE supplier_bills SET amount_paid = 0 WHERE id = v_bill2;

  v_pass := EXISTS(SELECT 1 FROM supplier_payments WHERE id=v_pay AND state='cancelled' AND cancelled_at IS NOT NULL);
  v_report:=v_report||jsonb_build_object('id','22_audit_cancelled_payment','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS(SELECT 1 FROM customer_credits WHERE remaining_amount < 0);
  v_report:=v_report||jsonb_build_object('id','23_no_negative_remaining','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS(SELECT 1 FROM customer_credit_applications a WHERE NOT EXISTS(SELECT 1 FROM customer_credits c WHERE c.id=a.credit_id));
  v_report:=v_report||jsonb_build_object('id','24_no_orphan_allocations','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := EXISTS(SELECT 1 FROM pg_proc WHERE proname='helpdesk_ticket_convert_to_service_case')
        AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_customer_credit')
        AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='supplier_bill_create_from_po')
        AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='erp_financial_health_check');
  v_report:=v_report||jsonb_build_object('id','25_regression_guard','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END);
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  IF _cleanup THEN
    DELETE FROM service_case_charges WHERE service_case_id IN (v_case, v_case_warranty);
    DELETE FROM service_case_costs WHERE service_case_id IN (v_case, v_case_warranty);
    DELETE FROM service_cases WHERE id IN (v_case, v_case_warranty);
    DELETE FROM supplier_payments WHERE bill_id IN (v_bill, v_bill2);
    DELETE FROM supplier_bill_lines WHERE bill_id IN (v_bill, v_bill2);
    DELETE FROM supplier_bills WHERE id IN (v_bill, v_bill2);
    DELETE FROM cash_movements WHERE session_id = v_sess;
    DELETE FROM cash_sessions WHERE id = v_sess;
    DELETE FROM cash_registers WHERE id = v_reg;
    DELETE FROM customer_credit_applications WHERE credit_id = v_credit;
    DELETE FROM customer_credits WHERE id = v_credit;
    DELETE FROM purchase_order_lines WHERE order_id = v_po;
    DELETE FROM purchase_orders WHERE id = v_po;
    DELETE FROM sale_orders WHERE id IN (v_so, v_so_cancelled);
    DELETE FROM products WHERE id = v_prod;
    DELETE FROM partners WHERE id IN (v_cust, v_sup);
  END IF;

  RETURN jsonb_build_object('ok', v_fail=0, 'pass', v_ok, 'fail', v_fail, 'total', v_ok+v_fail, 'report', v_report);
END $$;
