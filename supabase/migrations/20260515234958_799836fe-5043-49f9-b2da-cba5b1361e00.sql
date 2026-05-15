CREATE OR REPLACE FUNCTION public._test_phase13()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pfx text := 'TESTE_E2E_PH13_' || to_char(clock_timestamp(),'HH24MISSMS') || '_';
  wh uuid; loc uuid; cust_loc uuid; sup_loc uuid;
  partner uuid; supplier uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p8 uuid; p9 uuid; p12 uuid;
  comp_ok uuid; comp_miss uuid;
  bom3 uuid; bom4 uuid; bom9 uuid;
  so1 uuid; so2 uuid; so3 uuid; so4 uuid; so5 uuid;
  so6a uuid; so6b uuid; so8 uuid; so9 uuid; so12 uuid;
  pk_in uuid; mo9 uuid;
  tests jsonb := '[]'::jsonb;
  v_status text; v_reserved numeric; v_to_purchase numeric; v_src text; v_conf text; v_need_qty numeric;
  v_int int; v_int2 int; v_obj jsonb; v_passed bool;
  before_n int; before_m int; before_mv int; after_n int; after_m int; after_mv int;
BEGIN
  SELECT id INTO wh FROM warehouses WHERE active ORDER BY created_at LIMIT 1;
  SELECT id INTO loc FROM stock_locations WHERE warehouse_id=wh AND type='internal' AND active ORDER BY (parent_id IS NULL) DESC LIMIT 1;
  SELECT id INTO cust_loc FROM stock_locations WHERE type='customer' LIMIT 1;
  SELECT id INTO sup_loc FROM stock_locations WHERE type='supplier' LIMIT 1;
  IF sup_loc IS NULL THEN sup_loc := cust_loc; END IF;

  INSERT INTO partners(name,is_customer) VALUES (pfx||'CUST',true) RETURNING id INTO partner;
  INSERT INTO partners(name,is_supplier) VALUES (pfx||'SUP',true)  RETURNING id INTO supplier;

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased,mfg_lead_time_days,purchase_lead_time_days)
    VALUES (pfx||'FG1','storable',true,true,true,3,5) RETURNING id INTO p1;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p1,supplier,5,1,1);
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(p1,loc,10);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO1',partner,'draft',wh) RETURNING id INTO so1;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so1,p1,3,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so1;
  SELECT operational_status, qty_reserved INTO v_status, v_reserved FROM sale_order_lines WHERE order_id=so1;
  SELECT count(*) INTO v_int FROM purchase_needs WHERE sale_order_id=so1 AND state IN ('pending','quoting','approved');
  v_passed := v_status='ready_stock' AND v_reserved=3 AND v_int=0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T1.ready_stock','passed',v_passed,
    'observed', jsonb_build_object('status',v_status,'reserved',v_reserved,'needs',v_int)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased,purchase_lead_time_days)
    VALUES (pfx||'FG2','storable',true,true,true,4) RETURNING id INTO p2;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p2,supplier,4,1,1);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO2',partner,'draft',wh) RETURNING id INTO so2;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so2,p2,2,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so2;
  SELECT operational_status, availability_source INTO v_status, v_src FROM sale_order_lines WHERE order_id=so2;
  SELECT count(*) INTO v_int FROM purchase_needs WHERE sale_order_id=so2;
  v_passed := v_status='waiting_purchase' AND v_int=1 AND v_src='incoming_purchase';
  tests := tests || jsonb_build_array(jsonb_build_object('name','T2.waiting_purchase','passed',v_passed,
    'observed', jsonb_build_object('status',v_status,'needs',v_int,'src',v_src)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'COMP3','storable',true,false,true) RETURNING id INTO comp_ok;
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(comp_ok,loc,100);
  INSERT INTO products(name,type,active,can_be_sold,can_be_manufactured,mfg_lead_time_days) VALUES (pfx||'FG3','storable',true,true,true,3) RETURNING id INTO p3;
  INSERT INTO boms(product_id,active,quantity) VALUES(p3,true,1) RETURNING id INTO bom3;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity) VALUES(bom3,comp_ok,2);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO3',partner,'draft',wh) RETURNING id INTO so3;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so3,p3,1,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so3;
  SELECT operational_status, confidence_level INTO v_status, v_conf FROM sale_order_lines WHERE order_id=so3;
  SELECT count(*) INTO v_int FROM manufacturing_orders WHERE sale_order_id=so3;
  v_passed := v_status='waiting_manufacturing' AND v_int=1 AND v_conf='medium';
  tests := tests || jsonb_build_array(jsonb_build_object('name','T3.waiting_manufacturing','passed',v_passed,
    'observed', jsonb_build_object('status',v_status,'mos',v_int,'conf',v_conf)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'COMP4','storable',true,false,true) RETURNING id INTO comp_miss;
  INSERT INTO products(name,type,active,can_be_sold,can_be_manufactured,mfg_lead_time_days) VALUES (pfx||'FG4','storable',true,true,true,3) RETURNING id INTO p4;
  INSERT INTO boms(product_id,active,quantity) VALUES(p4,true,1) RETURNING id INTO bom4;
  INSERT INTO bom_lines(bom_id,component_product_id,quantity) VALUES(bom4,comp_miss,5);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO4',partner,'draft',wh) RETURNING id INTO so4;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so4,p4,1,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so4;
  SELECT operational_status, confidence_level INTO v_status, v_conf FROM sale_order_lines WHERE order_id=so4;
  SELECT count(*) INTO v_int FROM purchase_needs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id=so4);
  v_passed := v_status='waiting_components' AND v_int=1 AND v_conf='low';
  tests := tests || jsonb_build_array(jsonb_build_object('name','T4.waiting_components','passed',v_passed,
    'observed', jsonb_build_object('status',v_status,'comp_needs',v_int,'conf',v_conf)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'FG5','storable',true,true,true) RETURNING id INTO p5;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p5,supplier,5,1,1);
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(p5,loc,2);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO5',partner,'draft',wh) RETURNING id INTO so5;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so5,p5,5,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so5;
  SELECT operational_status, qty_reserved, qty_to_purchase, availability_source
    INTO v_status, v_reserved, v_to_purchase, v_src FROM sale_order_lines WHERE order_id=so5;
  SELECT qty_needed INTO v_need_qty FROM purchase_needs WHERE sale_order_id=so5 LIMIT 1;
  v_passed := v_status='partially_reserved' AND v_reserved=2 AND v_to_purchase=3 AND v_src='mixed' AND v_need_qty=3;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T5.partial','passed',v_passed,
    'observed', jsonb_build_object('status',v_status,'reserved',v_reserved,'purch',v_to_purchase,'src',v_src,'need_qty',v_need_qty)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'FG6','storable',true,true,true) RETURNING id INTO p6;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p6,supplier,5,1,1);
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(p6,loc,1);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO6A',partner,'draft',wh) RETURNING id INTO so6a;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so6a,p6,1,1,1);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO6B',partner,'draft',wh) RETURNING id INTO so6b;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so6b,p6,1,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so6a;
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so6b;
  SELECT count(*) FILTER (WHERE operational_status='ready_stock'),
         count(*) FILTER (WHERE operational_status='waiting_purchase'),
         coalesce(sum(qty_reserved),0)
    INTO v_int, v_int2, v_reserved
    FROM sale_order_lines WHERE order_id IN (so6a,so6b);
  v_passed := v_int=1 AND v_int2=1 AND v_reserved<=1;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T6.concurrency','passed',v_passed,
    'observed', jsonb_build_object('ready',v_int,'waiting',v_int2,'reserved_sum',v_reserved)));

  SELECT count(*) INTO before_n FROM purchase_needs WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b)
    OR manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b));
  SELECT count(*) INTO before_m  FROM manufacturing_orders WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b);
  SELECT count(*) INTO before_mv FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE pfx||'%');
  PERFORM so_run_operational_plan(s,'manual') FROM unnest(ARRAY[so1,so2,so3,so4,so5,so6a,so6b]) s;
  PERFORM so_run_operational_plan(s,'manual') FROM unnest(ARRAY[so1,so2,so3,so4,so5,so6a,so6b]) s;
  PERFORM so_run_operational_plan(s,'manual') FROM unnest(ARRAY[so1,so2,so3,so4,so5,so6a,so6b]) s;
  SELECT count(*) INTO after_n FROM purchase_needs WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b)
    OR manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b));
  SELECT count(*) INTO after_m  FROM manufacturing_orders WHERE sale_order_id IN (so1,so2,so3,so4,so5,so6a,so6b);
  SELECT count(*) INTO after_mv FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE pfx||'%');
  v_passed := before_n=after_n AND before_m=after_m AND before_mv=after_mv;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T7.idempotency','passed',v_passed,
    'observed', jsonb_build_object('needs',before_n||'->'||after_n,'mos',before_m||'->'||after_m,'moves',before_mv||'->'||after_mv)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'FG8','storable',true,true,true) RETURNING id INTO p8;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p8,supplier,5,1,1);
  INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
    VALUES (pfx||'IN8','incoming','draft',wh,sup_loc,loc,supplier,pfx||'IN8') RETURNING id INTO pk_in;
  INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state)
    VALUES (pk_in,p8,sup_loc,loc,100,'draft');
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO8',partner,'draft',wh) RETURNING id INTO so8;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so8,p8,5,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so8;
  SELECT operational_status, qty_reserved INTO v_status, v_reserved FROM sale_order_lines WHERE order_id=so8;
  v_passed := v_reserved=0 AND v_status='waiting_purchase'
              AND so_product_incoming_qty(p8,wh)=100 AND so_product_available_now(p8,wh)=0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T8.incoming_not_reservable','passed',v_passed,
    'observed', jsonb_build_object('reserved',v_reserved,'status',v_status,
                                   'incoming',so_product_incoming_qty(p8,wh),'avail',so_product_available_now(p8,wh))));

  INSERT INTO products(name,type,active,can_be_sold,can_be_manufactured) VALUES (pfx||'FG9','storable',true,true,true) RETURNING id INTO p9;
  INSERT INTO boms(product_id,active,quantity) VALUES(p9,true,1) RETURNING id INTO bom9;
  INSERT INTO manufacturing_orders(code,product_id,qty,state,warehouse_id,bom_id)
    VALUES (pfx||'MO9',p9,50,'in_progress',wh,bom9) RETURNING id INTO mo9;
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO9',partner,'draft',wh) RETURNING id INTO so9;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so9,p9,1,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so9;
  SELECT operational_status, qty_reserved INTO v_status, v_reserved FROM sale_order_lines WHERE order_id=so9;
  v_passed := v_reserved=0 AND so_product_in_production_qty(p9,wh)>=50 AND so_product_available_now(p9,wh)=0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T9.in_production_not_reservable','passed',v_passed,
    'observed', jsonb_build_object('reserved',v_reserved,'status',v_status,
                                   'in_prod',so_product_in_production_qty(p9,wh),'avail',so_product_available_now(p9,wh))));

  SELECT count(*) INTO v_int FROM stock_quants q
    JOIN products pr ON pr.id=q.product_id
   WHERE pr.name LIKE pfx||'%'
     AND (q.quantity<0 OR q.reserved_quantity<0 OR q.reserved_quantity>q.quantity);
  v_passed := v_int=0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T10.stock_integrity','passed',v_passed,
    'observed', jsonb_build_object('violations_in_test_products',v_int)));

  PERFORM so_run_operational_plan(so1,'replan');
  v_obj := so_run_operational_plan(so1,'replan');
  v_passed := (v_obj->>'skipped')='replan_throttled';
  tests := tests || jsonb_build_array(jsonb_build_object('name','T11.replan_throttle','passed',v_passed,
    'observed', jsonb_build_object('result',v_obj)));

  INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (pfx||'FG12','storable',true,true,true) RETURNING id INTO p12;
  INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(p12,supplier,5,1,1);
  INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(p12,loc,5);
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(pfx||'SO12',partner,'draft',wh) RETURNING id INTO so12;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(so12,p12,1,1,1);
  UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=so12;
  SELECT count(*) INTO v_int FROM module_events WHERE event_type='sale.confirmed' AND (payload->>'so_id')=so12::text;
  v_passed := v_int=1;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T12a.sale_confirmed_event','passed',v_passed,
    'observed', jsonb_build_object('events',v_int)));

  SELECT count(*) INTO v_int FROM sale_orders WHERE state='confirmed' AND name LIKE pfx||'%' AND last_planned_at IS NULL;
  v_passed := v_int=0;
  tests := tests || jsonb_build_array(jsonb_build_object('name','T12b.all_so_planned','passed',v_passed,
    'observed', jsonb_build_object('missing',v_int)));

  DELETE FROM sale_order_timeline WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%');
  DELETE FROM sale_operational_plan_log WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%');
  DELETE FROM purchase_needs WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%')
     OR manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%') OR code LIKE pfx||'%');
  DELETE FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%') OR code LIKE pfx||'%';
  DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE pfx||'%'));
  DELETE FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE pfx||'%');
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE pfx||'%' OR name LIKE pfx||'%');
  DELETE FROM stock_pickings WHERE origin LIKE pfx||'%' OR name LIKE pfx||'%';
  DELETE FROM module_events WHERE (payload->>'so_id') IN (SELECT id::text FROM sale_orders WHERE name LIKE pfx||'%');
  DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE pfx||'%');
  DELETE FROM sale_orders WHERE name LIKE pfx||'%';
  DELETE FROM product_suppliers WHERE product_id IN (SELECT id FROM products WHERE name LIKE pfx||'%');
  DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE pfx||'%');
  DELETE FROM products WHERE name LIKE pfx||'%';
  DELETE FROM partners WHERE name LIKE pfx||'%';

  RETURN jsonb_build_object(
    'prefix', pfx,
    'tests', tests,
    'total', jsonb_array_length(tests),
    'passed', (SELECT count(*) FROM jsonb_array_elements(tests) t WHERE (t->>'passed')::bool),
    'failed', (SELECT count(*) FROM jsonb_array_elements(tests) t WHERE NOT (t->>'passed')::bool)
  );
END $function$;