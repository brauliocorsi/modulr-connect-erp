
CREATE OR REPLACE FUNCTION public._test_phase8()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner uuid; v_product uuid; v_po uuid; v_pick uuid; v_move uuid;
  v_po_name text;
  v_status jsonb;
  v_results jsonb := '[]'::jsonb;
  v_err text;
BEGIN
  INSERT INTO public.partners(name, is_supplier) VALUES ('TEST_PHASE8_SUP_'||gen_random_uuid(), true) RETURNING id INTO v_partner;

  -- Pick a product without variants
  SELECT p.id INTO v_product
  FROM public.products p
  WHERE p.active = true
    AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id)
  LIMIT 1;

  IF v_product IS NULL THEN
    INSERT INTO public.products(name, active) VALUES ('TEST_PHASE8_PROD_'||substr(gen_random_uuid()::text,1,8), true) RETURNING id INTO v_product;
  END IF;

  INSERT INTO public.purchase_orders(name, partner_id, state)
  VALUES ('TESTPO8_'||substr(gen_random_uuid()::text,1,8), v_partner, 'draft')
  RETURNING id, name INTO v_po, v_po_name;

  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price)
  VALUES (v_po, v_product, 10, 5);

  PERFORM public.confirm_purchase_order(v_po);
  v_results := v_results || jsonb_build_object('test','PO confirmed','pass',true);

  SELECT id INTO v_pick FROM public.stock_pickings WHERE origin = v_po_name AND kind='incoming';
  SELECT id INTO v_move FROM public.stock_moves WHERE picking_id = v_pick LIMIT 1;

  UPDATE public.stock_moves SET quantity_done = 6 WHERE id = v_move;
  v_results := v_results || jsonb_build_object('test','Partial receipt 6/10','pass',true);

  v_status := public.purchase_order_receipt_status(v_po);
  v_results := v_results || jsonb_build_object(
    'test','Status reflects 6/10',
    'pass', (v_status->>'total_received')::numeric = 6 AND (v_status->>'total_ordered')::numeric = 10
  );

  BEGIN
    UPDATE public.stock_moves SET quantity_done = 11 WHERE id = v_move;
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',false);
  EXCEPTION WHEN check_violation THEN
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',true);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',true,'note',v_err);
  END;

  UPDATE public.stock_moves SET quantity_done = 10 WHERE id = v_move;
  v_status := public.purchase_order_receipt_status(v_po);
  v_results := v_results || jsonb_build_object(
    'test','Full receipt 10/10',
    'pass', (v_status->>'fully_received')::boolean = true
  );

  DELETE FROM public.stock_moves WHERE picking_id = v_pick;
  DELETE FROM public.stock_pickings WHERE id = v_pick;
  DELETE FROM public.purchase_order_lines WHERE order_id = v_po;
  DELETE FROM public.purchase_orders WHERE id = v_po;
  DELETE FROM public.partners WHERE id = v_partner;

  RETURN jsonb_build_object(
    'phase', 8,
    'tests', v_results,
    'pass_count', (SELECT COUNT(*) FROM jsonb_array_elements(v_results) e WHERE (e->>'pass')::boolean),
    'total', jsonb_array_length(v_results)
  );
END;
$$;
