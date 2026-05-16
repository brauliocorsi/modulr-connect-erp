
CREATE OR REPLACE FUNCTION public._test_phase14()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  pfx text := 'TESTE_E2E_PH14_' || to_char(clock_timestamp(),'HH24MISSMS') || '_';
  wh uuid; loc uuid;
  partner uuid; supplier uuid;
  p_buy uuid; p_mfg uuid; comp uuid;
  bom_id uuid;
  so_a uuid; def_a uuid;
  so_b uuid; def_b uuid;
  so_c uuid; def_c uuid;
  so_d uuid; def_d uuid;
  so_e uuid; def_e uuid;
  so_f uuid; def_f uuid;
  so_g uuid; def_g1 uuid; def_g2 uuid;
  before_needs int; after_needs int;
  before_mos int;   after_mos int;
  before_pays int;  after_pays int;
  v_total numeric; v_parent numeric; v_def numeric;
  v_inh numeric; v_picking uuid; v_picking2 uuid;
  v_root uuid; v_pass bool;
  tests jsonb := '[]'::jsonb;
  v_obj jsonb;
  v_phase13_before jsonb;
  v_phase13_after  jsonb;
BEGIN
  -- 0) Regressão F13 antes
  v_phase13_before := _test_phase13();

  SELECT id INTO wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  SELECT id INTO loc FROM stock_locations WHERE warehouse_id=wh AND type='internal' AND active ORDER BY (parent_id IS NULL) DESC LIMIT 1;

  INSERT INTO partners(name,is_customer) VALUES (pfx||'CUST',true) RETURNING id INTO partner;
  INSERT INTO partners(name,is_supplier) VALUES (pfx||'SUP',true) RETURNING id INTO supplier;

  -- produtos
  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased,purchase_lead_time_days)
    VALUES (pfx||'BUY','storable',true,true,true,4) RETURNING id INTO p_buy;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p_buy,supplier,4,1,1);

  INSERT INTO products(name,type,active,can_be_sold,can_be_manufactured,mfg_lead_time_days)
    VALUES (pfx||'MFG','storable',true,true,true,3) RETURNING id INTO p_mfg;
  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'COMP','storable',true,false,true) RETURNING id INTO comp;
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(comp,loc,500);
  INSERT INTO boms(product_id,active,quantity) VALUES(p_mfg,true,1) RETURNING id INTO bom_id;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity) VALUES(bom_id,comp,1);

  -- =====================================================
  -- T1: split sem duplicar purchase_need
  -- =====================================================
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SOA',partner,'draft',wh) RETURNING id INTO so_a;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so_a,p_buy,5,10,50);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so_a;
  -- simular entrega parcial: 2 já entregues, 3 pendentes
  UPDATE sale_order_lines SET qty_delivered=2 WHERE order_id=so_a;

  SELECT count(*) INTO before_needs FROM purchase_needs pn JOIN sale_order_lines sol ON sol.product_id=pn.product_id WHERE sol.order_id=so_a;

  v_obj := so_split_partial_delivery(so_a);
  def_a := (v_obj->>'deferred_id')::uuid;

  SELECT count(*) INTO after_needs FROM purchase_needs pn
    JOIN sale_order_line_supply_links sl ON sl.purchase_need_id=pn.id AND sl.state='active'
    JOIN sale_order_lines sol ON sol.id=sl.sale_order_line_id
    WHERE sol.order_id IN (so_a, def_a);

  v_pass := def_a IS NOT NULL AND after_needs = before_needs;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T1.split_no_dup_purchase_need','passed',v_pass,
    'observed',jsonb_build_object('before',before_needs,'after',after_needs,'def',def_a)));

  -- =====================================================
  -- T2: picking da diferida é novo (não herda)
  -- =====================================================
  -- garantir stock para reservar na diferida
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(p_buy,loc,3);
  PERFORM so_run_operational_plan(def_a, 'inherit');
  v_picking := so_generate_delivery_picking(def_a);
  -- segunda chamada deve retornar o mesmo (idempotência)
  v_picking2 := so_generate_delivery_picking(def_a);
  v_pass := v_picking IS NOT NULL AND v_picking = v_picking2
        AND NOT EXISTS(SELECT 1 FROM stock_pickings WHERE id=v_picking AND origin = (SELECT name FROM sale_orders WHERE id=so_a));
  tests := tests || jsonb_build_array(jsonb_build_object('name','T2.deferred_picking_new_idempotent','passed',v_pass,
    'observed',jsonb_build_object('picking',v_picking,'picking2',v_picking2)));

  -- =====================================================
  -- T3: histórico preservado (qty_split_out, parent links)
  -- =====================================================
  v_pass := EXISTS(SELECT 1 FROM sale_order_lines WHERE order_id=so_a AND qty_split_out=3 AND qty_delivered=2)
        AND EXISTS(SELECT 1 FROM sale_orders WHERE id=def_a AND parent_sale_order_id=so_a AND root_sale_order_id IS NOT NULL)
        AND EXISTS(SELECT 1 FROM sale_order_lines WHERE order_id=def_a AND parent_line_id IS NOT NULL AND quantity=3);
  tests := tests || jsonb_build_array(jsonb_build_object('name','T3.history_preserved','passed',v_pass));

  -- =====================================================
  -- T4: soma financeira fecha (parent_after + deferred = original)
  -- =====================================================
  SELECT amount_total_original, amount_total_parent_after, amount_total_deferred
    INTO v_total, v_parent, v_def
    FROM sale_split_payment_allocations WHERE deferred_order_id=def_a;
  v_pass := abs((v_parent + v_def) - v_total) < 0.01 AND v_total = 50;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T4.finance_sum_closes','passed',v_pass,
    'observed',jsonb_build_object('total',v_total,'parent',v_parent,'def',v_def)));

  -- =====================================================
  -- T5: split não cria customer_payment artificial
  -- =====================================================
  SELECT count(*) INTO after_pays FROM customer_payments WHERE order_id IN (so_a, def_a);
  v_pass := after_pays = 0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T5.no_artificial_payment','passed',v_pass,
    'observed',jsonb_build_object('payments',after_pays)));

  -- =====================================================
  -- T6: pago total → diferida nasce paid
  -- =====================================================
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SOD',partner,'draft',wh) RETURNING id INTO so_d;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so_d,p_buy,4,10,40);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now(), amount_total=40 WHERE id=so_d;
  UPDATE sale_order_lines SET qty_delivered=1 WHERE order_id=so_d;
  -- registrar pagamento total prévio
  INSERT INTO customer_payments(order_id,amount,payment_date,state) VALUES(so_d,40,CURRENT_DATE,'posted');
  v_obj := so_split_partial_delivery(so_d);
  def_d := (v_obj->>'deferred_id')::uuid;
  SELECT payment_status INTO v_obj FROM (SELECT to_jsonb(payment_status) AS payment_status FROM sale_orders WHERE id=def_d) x;
  v_pass := (SELECT payment_status FROM sale_orders WHERE id=def_d) = 'paid'
         AND (SELECT count(*) FROM customer_payments WHERE order_id=def_d) = 0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T6.deferred_born_paid','passed',v_pass,
    'observed',jsonb_build_object('def_status',(SELECT payment_status FROM sale_orders WHERE id=def_d))));

  -- =====================================================
  -- T7: pago parcial == entregue → original paid, diferida unpaid
  -- =====================================================
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SOE',partner,'draft',wh) RETURNING id INTO so_e;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so_e,p_buy,4,10,40);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now(), amount_total=40 WHERE id=so_e;
  UPDATE sale_order_lines SET qty_delivered=2 WHERE order_id=so_e;
  INSERT INTO customer_payments(order_id,amount,payment_date,state) VALUES(so_e,20,CURRENT_DATE,'posted');
  v_obj := so_split_partial_delivery(so_e);
  def_e := (v_obj->>'deferred_id')::uuid;
  v_pass := (SELECT payment_status FROM sale_orders WHERE id=so_e) = 'paid'
        AND (SELECT payment_status FROM sale_orders WHERE id=def_e) = 'unpaid'
        AND (SELECT amount_total FROM sale_orders WHERE id=def_e) = 20;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T7.partial_payment_distribution','passed',v_pass,
    'observed',jsonb_build_object('parent',(SELECT payment_status FROM sale_orders WHERE id=so_e),
                                  'def',(SELECT payment_status FROM sale_orders WHERE id=def_e),
                                  'def_total',(SELECT amount_total FROM sale_orders WHERE id=def_e))));

  -- =====================================================
  -- T8: idempotência (split 3x não duplica)
  -- =====================================================
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SOF',partner,'draft',wh) RETURNING id INTO so_f;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so_f,p_buy,3,10,30);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so_f;
  UPDATE sale_order_lines SET qty_delivered=1 WHERE order_id=so_f;
  v_obj := so_split_partial_delivery(so_f);
  def_f := (v_obj->>'deferred_id')::uuid;
  PERFORM so_split_partial_delivery(so_f);
  PERFORM so_split_partial_delivery(so_f);
  v_pass := (SELECT count(*) FROM sale_orders WHERE parent_sale_order_id=so_f AND is_deferred) = 1;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T8.idempotent_split','passed',v_pass,
    'observed',jsonb_build_object('def_count',(SELECT count(*) FROM sale_orders WHERE parent_sale_order_id=so_f))));

  -- =====================================================
  -- T9: inherit mode reduz qty_missing pela cobertura herdada
  -- =====================================================
  -- def_a tem 3 unidades de p_buy; depois inserimos stock e replanamos; supply herdado existe
  v_inh := _soss_inherited_qty((SELECT id FROM sale_order_lines WHERE order_id=def_a LIMIT 1));
  v_pass := v_inh > 0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T9.inherited_qty_present','passed',v_pass,
    'observed',jsonb_build_object('inherited',v_inh)));

  -- =====================================================
  -- T10: cascade — diferida pode ter pai, root resolve corretamente
  -- =====================================================
  -- simular entrega parcial na diferida e novo split
  UPDATE sale_order_lines SET qty_delivered=1, qty_split_out=0 WHERE order_id=def_a;
  v_obj := so_split_partial_delivery(def_a);
  def_g1 := (v_obj->>'deferred_id')::uuid;
  v_root := so_root_id(def_g1);
  v_pass := v_root = so_a;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T10.root_resolves_in_chain','passed',v_pass,
    'observed',jsonb_build_object('root',v_root,'expected',so_a,'def_g1',def_g1)));

  -- =====================================================
  -- T11: regressão F13 depois
  -- =====================================================
  v_phase13_after := _test_phase13();
  v_pass := (v_phase13_after->>'failed')::int = 0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T11.phase13_regression','passed',v_pass,
    'observed',jsonb_build_object('before_passed',v_phase13_before->>'passed',
                                  'after_passed',v_phase13_after->>'passed',
                                  'after_failed',v_phase13_after->>'failed')));

  RETURN jsonb_build_object(
    'prefix', pfx,
    'total', jsonb_array_length(tests),
    'passed', (SELECT count(*) FROM jsonb_array_elements(tests) e WHERE (e->>'passed')::bool),
    'failed', (SELECT count(*) FROM jsonb_array_elements(tests) e WHERE NOT (e->>'passed')::bool),
    'tests', tests,
    'phase13_before', v_phase13_before,
    'phase13_after',  v_phase13_after
  );
END
$function$;
