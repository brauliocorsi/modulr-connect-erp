CREATE OR REPLACE FUNCTION public._so_reserve_line(_line_id uuid, _qty numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_line sale_order_lines%ROWTYPE; v_so sale_orders%ROWTYPE;
  v_src_loc uuid; v_dst_loc uuid; v_wh uuid;
  v_picking uuid; v_already numeric := 0; v_to_add numeric;
BEGIN
  IF _qty <= 0 THEN RETURN 0; END IF;
  SELECT * INTO v_line FROM sale_order_lines WHERE id=_line_id;
  SELECT * INTO v_so   FROM sale_orders WHERE id=v_line.order_id;
  v_wh := v_so.warehouse_id;

  SELECT id INTO v_src_loc FROM stock_locations
   WHERE warehouse_id=v_wh AND type='internal' AND active
   ORDER BY (parent_id IS NULL) DESC LIMIT 1;
  IF v_src_loc IS NULL THEN RETURN 0; END IF;
  SELECT id INTO v_dst_loc FROM stock_locations WHERE type='customer' LIMIT 1;
  IF v_dst_loc IS NULL THEN RETURN 0; END IF;

  SELECT id INTO v_picking FROM stock_pickings
   WHERE origin = v_so.name AND kind='outgoing' AND state IN ('draft','ready')
   ORDER BY created_at LIMIT 1;
  IF v_picking IS NULL THEN
    INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id,
                               destination_location_id, partner_id, origin)
    VALUES ('OUT/'||v_so.name||'/'||substr(_line_id::text,1,8),
            'outgoing','draft', v_wh, v_src_loc, v_dst_loc, v_so.partner_id, v_so.name)
    RETURNING id INTO v_picking;
  END IF;

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_already
    FROM stock_moves
   WHERE picking_id=v_picking AND product_id=v_line.product_id
     AND state IN ('ready','draft');
  v_to_add := GREATEST(_qty - v_already, 0);
  IF v_to_add > 0 THEN
    INSERT INTO stock_moves(picking_id, product_id, source_location_id,
                            destination_location_id, quantity, state)
    VALUES (v_picking, v_line.product_id, v_src_loc, v_dst_loc, v_to_add, 'draft');
    BEGIN
      PERFORM reserve_picking_strict(v_picking);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'reserve failed line=% : %', _line_id, SQLERRM;
    END;
  END IF;

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_already
    FROM stock_moves
   WHERE picking_id=v_picking AND product_id=v_line.product_id
     AND state IN ('ready','draft');
  RETURN v_already;
END $$;