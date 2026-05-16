
CREATE OR REPLACE FUNCTION public.so_generate_delivery_picking(_order_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_pid uuid;
  v_src uuid; v_dst uuid;
  v_line RECORD;
BEGIN
  SELECT * INTO v_so FROM sale_orders WHERE id=_order_id;
  IF v_so.id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_pid FROM stock_pickings
   WHERE origin = v_so.name AND kind='outgoing' AND state IN ('draft','waiting','ready')
   ORDER BY created_at DESC LIMIT 1;
  IF v_pid IS NOT NULL THEN RETURN v_pid; END IF;

  SELECT id INTO v_src FROM stock_locations WHERE warehouse_id=v_so.warehouse_id AND type='internal' AND active=true ORDER BY created_at LIMIT 1;
  SELECT id INTO v_dst FROM stock_locations WHERE type='customer' AND active=true ORDER BY created_at LIMIT 1;
  IF v_src IS NULL OR v_dst IS NULL THEN
    RAISE EXCEPTION 'so_generate_delivery_picking: faltam locations (src=% dst=%)', v_src, v_dst;
  END IF;

  INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id,
    partner_id, origin, scheduled_at)
  VALUES ('OUT/'||substr(v_so.name,1,20)||'/'||to_char(now(),'YYYYMMDDHH24MISS'),
          'outgoing', 'ready', v_so.warehouse_id, v_src, v_dst,
          v_so.partner_id, v_so.name, now())
  RETURNING id INTO v_pid;

  FOR v_line IN
    SELECT * FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product' AND product_id IS NOT NULL
      AND COALESCE(qty_reserved,0) > 0
  LOOP
    INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
      source_location_id, destination_location_id, quantity, reserved_quantity)
    VALUES (v_pid, v_line.product_id, v_line.variant_id, v_line.uom_id,
      v_src, v_dst, v_line.qty_reserved, v_line.qty_reserved);
  END LOOP;

  PERFORM so_emit_timeline(_order_id, CASE WHEN v_so.is_deferred THEN 'deferred.picking.created' ELSE 'picking.created' END,
    NULL, v_pid::text, jsonb_build_object('picking_id',v_pid), 'auto');

  RETURN v_pid;
END $$;
