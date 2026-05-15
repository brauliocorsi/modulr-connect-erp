
CREATE OR REPLACE FUNCTION public._test_phase3()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pfx text := 'TESTE_E2E_PH3_FN_'||to_char(now(),'HH24MISSMS')||'_';
  v_wh uuid; v_loc uuid; v_cust uuid; v_partner uuid; v_fg uuid;
  v_so uuid; v_pk uuid; v_ev uuid;
  c_confirmed int; c_confirmed2 int; c_cancelled int; c_pkdone int; c_fanout int;
  pl jsonb;
  asserts jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_wh FROM warehouses WHERE active LIMIT 1;
  SELECT id INTO v_loc FROM stock_locations WHERE warehouse_id=v_wh AND type='internal' AND active LIMIT 1;
  SELECT id INTO v_cust FROM stock_locations WHERE type='customer' LIMIT 1;
  INSERT INTO products(name,type,active,can_be_sold) VALUES (v_pfx||'FG','storable',true,true) RETURNING id INTO v_fg;
  INSERT INTO partners(name,is_customer) VALUES (v_pfx||'CUST',true) RETURNING id INTO v_partner;

  -- T1 emit_event direto
  v_ev := emit_event('sales','test.synthetic','{"a":1}'::jsonb,'unit_test',NULL);
  SELECT payload INTO pl FROM module_events WHERE id=v_ev;
  asserts := asserts || jsonb_build_object('step','T1.emit_event',
              'ok', (pl->>'a')='1' AND (pl->>'entity_type')='unit_test' AND pl ? 'emitted_at',
              'observed', pl);

  -- T2 SO confirmed
  INSERT INTO sale_orders(name,partner_id,state,warehouse_id,amount_total)
    VALUES (v_pfx||'SO',v_partner,'draft',v_wh,200) RETURNING id INTO v_so;
  UPDATE sale_orders SET state='confirmed' WHERE id=v_so;
  SELECT count(*) INTO c_confirmed FROM module_events
    WHERE event_type='sale.confirmed' AND payload->>'so_id'=v_so::text;
  asserts := asserts || jsonb_build_object('step','T2.sale.confirmed','ok', c_confirmed=1, 'observed', jsonb_build_object('count',c_confirmed));

  -- T6 idempotência: re-update mesmo state
  UPDATE sale_orders SET state='confirmed' WHERE id=v_so;
  SELECT count(*) INTO c_confirmed2 FROM module_events
    WHERE event_type='sale.confirmed' AND payload->>'so_id'=v_so::text;
  asserts := asserts || jsonb_build_object('step','T6.idempotency','ok', c_confirmed2=1, 'observed', jsonb_build_object('count',c_confirmed2));

  -- T3 SO cancelled
  UPDATE sale_orders SET state='cancelled' WHERE id=v_so;
  SELECT count(*) INTO c_cancelled FROM module_events
    WHERE event_type='sale.cancelled' AND payload->>'so_id'=v_so::text;
  asserts := asserts || jsonb_build_object('step','T3.sale.cancelled','ok', c_cancelled=1, 'observed', jsonb_build_object('count',c_cancelled));

  -- T4 picking done
  INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
    VALUES (v_pfx||'PK','outgoing','ready',v_wh,v_loc,v_cust,v_partner,v_pfx||'SO')
    RETURNING id INTO v_pk;
  UPDATE stock_pickings SET state='done' WHERE id=v_pk;
  SELECT count(*) INTO c_pkdone FROM module_events
    WHERE event_type='inventory.picking.done' AND payload->>'picking_id'=v_pk::text;
  asserts := asserts || jsonb_build_object('step','T4.picking.done','ok', c_pkdone=1, 'observed', jsonb_build_object('count',c_pkdone));

  -- T5 notify_group vazio
  c_fanout := notify_group(v_pfx||'NO_GROUP','sales'::app_module,'test.fanout','x');
  asserts := asserts || jsonb_build_object('step','T5.notify_group_empty','ok', c_fanout=0, 'observed', jsonb_build_object('sent',c_fanout));

  -- cleanup
  DELETE FROM module_events WHERE id=v_ev;
  DELETE FROM module_events WHERE payload->>'so_id'=v_so::text OR payload->>'picking_id'=v_pk::text;
  DELETE FROM stock_pickings WHERE id=v_pk;
  DELETE FROM sale_orders WHERE id=v_so;
  DELETE FROM products WHERE id=v_fg;
  DELETE FROM partners WHERE id=v_partner;

  RETURN jsonb_build_object('asserts', asserts);
END $$;
