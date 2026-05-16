
CREATE OR REPLACE FUNCTION public.so_split_partial_delivery(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent sale_orders%ROWTYPE;
  v_existing uuid;
  v_def_id uuid;
  v_def_name text;
  v_root uuid;
  v_line RECORD;
  v_new_line uuid;
  v_qty_pending numeric;
  v_lines_split int := 0;
  v_finance jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('split:'||_order_id::text));

  SELECT * INTO v_parent FROM sale_orders WHERE id=_order_id FOR UPDATE;
  IF v_parent.id IS NULL THEN RETURN jsonb_build_object('error','sale_order_not_found'); END IF;
  IF v_parent.state NOT IN ('confirmed') THEN RETURN jsonb_build_object('error','invalid_state','state',v_parent.state::text); END IF;

  SELECT id INTO v_existing FROM sale_orders
   WHERE parent_sale_order_id=_order_id AND is_deferred=true AND state='confirmed' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'deferred_id',v_existing);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product'
      AND (quantity - COALESCE(qty_delivered,0) - COALESCE(qty_split_out,0)) > 0
  ) THEN
    RETURN jsonb_build_object('skipped','no_pending_lines');
  END IF;

  v_root := so_root_id(_order_id);

  INSERT INTO sale_orders(
    name, partner_id, pricelist_id, salesperson_id, date_order, warehouse_id, company_id,
    state, parent_sale_order_id, root_sale_order_id, is_deferred, deferred_reason, split_at,
    operational_status, store_id, delivery_mode, include_assembly, include_delivery,
    confirmed_at, amount_total, amount_untaxed, amount_tax, payment_status
  ) VALUES (
    v_parent.name || '-D' || (
      SELECT COUNT(*)+1 FROM sale_orders WHERE root_sale_order_id=v_root AND is_deferred=true
    )::text,
    v_parent.partner_id, v_parent.pricelist_id, v_parent.salesperson_id, now(),
    v_parent.warehouse_id, v_parent.company_id,
    'confirmed', _order_id, v_root, true, 'partial_delivery', now(),
    'waiting_stock', v_parent.store_id, v_parent.delivery_mode,
    v_parent.include_assembly, v_parent.include_delivery,
    now(), 0, 0, 0, 'unpaid'
  ) RETURNING id, name INTO v_def_id, v_def_name;

  FOR v_line IN
    SELECT * FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product'
    ORDER BY sequence, id
  LOOP
    v_qty_pending := v_line.quantity - COALESCE(v_line.qty_delivered,0) - COALESCE(v_line.qty_split_out,0);
    IF v_qty_pending <= 0 THEN CONTINUE; END IF;

    INSERT INTO sale_order_lines(
      order_id, product_id, variant_id, description, quantity, uom_id, unit_price,
      discount_pct, tax_pct, subtotal, sequence, line_kind, parent_line_id, qty_delivered, qty_split_out
    ) VALUES (
      v_def_id, v_line.product_id, v_line.variant_id, v_line.description, v_qty_pending,
      v_line.uom_id, v_line.unit_price, v_line.discount_pct, v_line.tax_pct,
      ROUND((v_qty_pending * v_line.unit_price * (1 - COALESCE(v_line.discount_pct,0)/100))::numeric, 2),
      v_line.sequence, v_line.line_kind, v_line.id, 0, 0
    ) RETURNING id INTO v_new_line;

    UPDATE sale_order_line_supply_links
       SET sale_order_line_id = v_new_line,
           inherited_from_line_id = v_line.id,
           moved_at = now(),
           updated_at = now()
     WHERE sale_order_line_id = v_line.id AND state = 'active'
       AND link_kind IN ('purchase_need','purchase_order_line','manufacturing_order');

    UPDATE sale_order_lines
       SET qty_split_out = COALESCE(qty_split_out,0) + v_qty_pending,
           qty_reserved = 0, qty_to_purchase = 0, qty_to_manufacture = 0
     WHERE id = v_line.id;

    v_lines_split := v_lines_split + 1;
  END LOOP;

  UPDATE sale_orders SET
    amount_untaxed = COALESCE((SELECT SUM(qty_delivered * unit_price * (1 - COALESCE(discount_pct,0)/100))
                                FROM sale_order_lines WHERE order_id=_order_id),0),
    amount_total = COALESCE((SELECT SUM(qty_delivered * unit_price * (1 - COALESCE(discount_pct,0)/100) * (1 + COALESCE(tax_pct,0)/100))
                                FROM sale_order_lines WHERE order_id=_order_id),0)
   WHERE id=_order_id;

  UPDATE sale_orders SET
    amount_untaxed = COALESCE((SELECT SUM(quantity * unit_price * (1 - COALESCE(discount_pct,0)/100))
                                FROM sale_order_lines WHERE order_id=v_def_id),0),
    amount_total = COALESCE((SELECT SUM(quantity * unit_price * (1 - COALESCE(discount_pct,0)/100) * (1 + COALESCE(tax_pct,0)/100))
                                FROM sale_order_lines WHERE order_id=v_def_id),0)
   WHERE id=v_def_id;

  UPDATE sale_orders SET amount_total = (SELECT amount_total FROM sale_orders WHERE id=_order_id)
                                       + (SELECT amount_total FROM sale_orders WHERE id=v_def_id)
   WHERE id=_order_id;

  v_finance := _so_split_finance(_order_id, v_def_id);

  PERFORM so_emit_timeline(_order_id,'sale.split.created', NULL, v_def_id::text,
    jsonb_build_object('deferred_id',v_def_id,'lines_split',v_lines_split,'finance',v_finance), 'split');
  PERFORM so_emit_timeline(v_def_id,'sale.deferred.created', NULL, _order_id::text,
    jsonb_build_object('parent_id',_order_id,'root_id',v_root), 'split');

  IF v_parent.salesperson_id IS NOT NULL THEN
    BEGIN PERFORM notify_user(v_parent.salesperson_id, 'sales'::app_module, 'so.split',
      'Venda dividida', 'Foi criada SO diferida ' || v_def_name, '/sales/orders/'||v_def_id::text);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  PERFORM so_run_operational_plan(v_def_id, 'inherit');

  IF NOT EXISTS (
    SELECT 1 FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product'
      AND COALESCE(qty_delivered,0) < COALESCE(quantity,0) - COALESCE(qty_split_out,0)
  ) THEN
    UPDATE sale_orders SET operational_status='completed',
      state = CASE WHEN payment_status='paid' THEN 'done'::sale_state ELSE state END,
      closed_at = COALESCE(closed_at, now())
     WHERE id=_order_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'deferred_id',v_def_id,'deferred_name',v_def_name,
    'lines_split',v_lines_split,'finance',v_finance);
END $$;
