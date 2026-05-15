
-- ============================================
-- PHASE 8: PO Receipt Stock Integrity
-- ============================================

-- 1) Trigger: prevent over-receipt on incoming pickings tied to a PO
CREATE OR REPLACE FUNCTION public.tg_prevent_po_over_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pick record;
  v_po_name text;
  v_ordered numeric;
  v_received numeric;
  v_new_done numeric;
BEGIN
  -- Only validate when quantity_done is being set/changed
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.quantity_done,0) = COALESCE(OLD.quantity_done,0) THEN
    RETURN NEW;
  END IF;

  IF NEW.picking_id IS NULL THEN RETURN NEW; END IF;

  SELECT kind, origin, state INTO v_pick
  FROM public.stock_pickings WHERE id = NEW.picking_id;

  IF v_pick.kind <> 'incoming' OR v_pick.origin IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve PO from origin
  SELECT name INTO v_po_name FROM public.purchase_orders WHERE name = v_pick.origin;
  IF v_po_name IS NULL THEN RETURN NEW; END IF;

  -- Total ordered for (product, variant) across this PO
  SELECT COALESCE(SUM(pol.quantity),0) INTO v_ordered
  FROM public.purchase_order_lines pol
  JOIN public.purchase_orders po ON po.id = pol.order_id
  WHERE po.name = v_po_name
    AND pol.product_id = NEW.product_id
    AND pol.variant_id IS NOT DISTINCT FROM NEW.variant_id;

  IF v_ordered = 0 THEN
    RAISE EXCEPTION 'Produto/variante % não pertence à compra %', NEW.product_id, v_po_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Total already received across all incoming pickings of this PO (excluding this row)
  SELECT COALESCE(SUM(sm.quantity_done),0) INTO v_received
  FROM public.stock_moves sm
  JOIN public.stock_pickings sp ON sp.id = sm.picking_id
  WHERE sp.kind = 'incoming'
    AND sp.origin = v_po_name
    AND sp.state <> 'cancelled'
    AND sm.product_id = NEW.product_id
    AND sm.variant_id IS NOT DISTINCT FROM NEW.variant_id
    AND sm.id <> NEW.id;

  v_new_done := v_received + COALESCE(NEW.quantity_done,0);

  IF v_new_done > v_ordered + 0.0001 THEN
    RAISE EXCEPTION 'Recebimento em excesso para % na compra %: pedido %, já recebido %, tentativa adicional %',
      NEW.product_id, v_po_name, v_ordered, v_received, NEW.quantity_done
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_po_over_receipt ON public.stock_moves;
CREATE TRIGGER trg_prevent_po_over_receipt
BEFORE INSERT OR UPDATE OF quantity_done ON public.stock_moves
FOR EACH ROW EXECUTE FUNCTION public.tg_prevent_po_over_receipt();

-- 2) Helper: receipt status per PO
CREATE OR REPLACE FUNCTION public.purchase_order_receipt_status(_po_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_po record;
  v_lines jsonb;
  v_total_ordered numeric;
  v_total_received numeric;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = _po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'line_id', pol.id,
    'product_id', pol.product_id,
    'variant_id', pol.variant_id,
    'ordered', pol.quantity,
    'received', COALESCE(rcv.received,0),
    'pending', GREATEST(pol.quantity - COALESCE(rcv.received,0), 0)
  )), '[]'::jsonb)
  INTO v_lines
  FROM public.purchase_order_lines pol
  LEFT JOIN LATERAL (
    SELECT SUM(sm.quantity_done) AS received
    FROM public.stock_moves sm
    JOIN public.stock_pickings sp ON sp.id = sm.picking_id
    WHERE sp.kind = 'incoming'
      AND sp.origin = v_po.name
      AND sp.state <> 'cancelled'
      AND sm.product_id = pol.product_id
      AND sm.variant_id IS NOT DISTINCT FROM pol.variant_id
  ) rcv ON true
  WHERE pol.order_id = _po_id;

  SELECT COALESCE(SUM((l->>'ordered')::numeric),0),
         COALESCE(SUM((l->>'received')::numeric),0)
  INTO v_total_ordered, v_total_received
  FROM jsonb_array_elements(v_lines) l;

  RETURN jsonb_build_object(
    'po_id', v_po.id,
    'po_name', v_po.name,
    'state', v_po.state,
    'total_ordered', v_total_ordered,
    'total_received', v_total_received,
    'fully_received', v_total_received >= v_total_ordered AND v_total_ordered > 0,
    'lines', v_lines
  );
END;
$$;

-- 3) Self-test
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
  -- Setup
  INSERT INTO public.partners(name, is_supplier) VALUES ('TEST_PHASE8_SUP_'||gen_random_uuid(), true) RETURNING id INTO v_partner;
  SELECT id INTO v_product FROM public.products WHERE active = true LIMIT 1;
  IF v_product IS NULL THEN
    INSERT INTO public.products(name, active) VALUES ('TEST_PHASE8_PROD', true) RETURNING id INTO v_product;
  END IF;

  -- Create PO with 10 units
  INSERT INTO public.purchase_orders(name, partner_id, state)
  VALUES ('TESTPO8_'||substr(gen_random_uuid()::text,1,8), v_partner, 'draft')
  RETURNING id, name INTO v_po, v_po_name;

  INSERT INTO public.purchase_order_lines(order_id, product_id, quantity, unit_price)
  VALUES (v_po, v_product, 10, 5);

  PERFORM public.confirm_purchase_order(v_po);
  v_results := v_results || jsonb_build_object('test','PO confirmed','pass',true);

  -- Find the picking
  SELECT id INTO v_pick FROM public.stock_pickings WHERE origin = v_po_name AND kind='incoming';
  SELECT id INTO v_move FROM public.stock_moves WHERE picking_id = v_pick LIMIT 1;

  -- Partial receipt: 6 of 10
  UPDATE public.stock_moves SET quantity_done = 6 WHERE id = v_move;
  v_results := v_results || jsonb_build_object('test','Partial receipt 6/10','pass',true);

  -- Status check
  v_status := public.purchase_order_receipt_status(v_po);
  v_results := v_results || jsonb_build_object(
    'test','Status reflects 6/10',
    'pass', (v_status->>'total_received')::numeric = 6 AND (v_status->>'total_ordered')::numeric = 10,
    'status', v_status
  );

  -- Try over-receipt: 11 (should fail)
  BEGIN
    UPDATE public.stock_moves SET quantity_done = 11 WHERE id = v_move;
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',false,'note','no exception');
  EXCEPTION WHEN check_violation THEN
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',true);
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_results := v_results || jsonb_build_object('test','Over-receipt rejected','pass',true,'note',v_err);
  END;

  -- Complete receipt: 10
  UPDATE public.stock_moves SET quantity_done = 10 WHERE id = v_move;
  v_status := public.purchase_order_receipt_status(v_po);
  v_results := v_results || jsonb_build_object(
    'test','Full receipt 10/10',
    'pass', (v_status->>'fully_received')::boolean = true
  );

  -- Cleanup
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
