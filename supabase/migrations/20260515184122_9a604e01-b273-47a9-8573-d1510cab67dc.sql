
CREATE OR REPLACE FUNCTION public.scan_increment_move(_move uuid, _delta numeric DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move record;
  v_picking_state text;
  v_new numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'Invalid delta' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.quantity, COALESCE(m.quantity_done,0) AS qd, m.picking_id
    INTO v_move
  FROM stock_moves m
  WHERE m.id = _move
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Move not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_move.picking_id IS NOT NULL THEN
    SELECT state INTO v_picking_state FROM stock_pickings WHERE id = v_move.picking_id;
    IF v_picking_state IN ('done','cancelled') THEN
      RAISE EXCEPTION 'Picking is %', v_picking_state USING ERRCODE = '55000';
    END IF;
  END IF;

  v_new := v_move.qd + _delta;
  IF v_new > v_move.quantity THEN
    RAISE EXCEPTION 'Exceeds demand (%/%).', v_new, v_move.quantity USING ERRCODE = '23514';
  END IF;

  UPDATE stock_moves SET quantity_done = v_new WHERE id = _move;
  RETURN jsonb_build_object('move_id', _move, 'quantity_done', v_new, 'demand', v_move.quantity);
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_set_move_done(_move uuid, _qty numeric, _lot uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move record;
  v_picking_state text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _qty IS NULL OR _qty < 0 THEN
    RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.quantity, m.picking_id INTO v_move
  FROM stock_moves m WHERE m.id = _move FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Move not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_move.picking_id IS NOT NULL THEN
    SELECT state INTO v_picking_state FROM stock_pickings WHERE id = v_move.picking_id;
    IF v_picking_state IN ('done','cancelled') THEN
      RAISE EXCEPTION 'Picking is %', v_picking_state USING ERRCODE = '55000';
    END IF;
  END IF;

  IF _qty > v_move.quantity THEN
    RAISE EXCEPTION 'Exceeds demand (%/%).', _qty, v_move.quantity USING ERRCODE = '23514';
  END IF;

  UPDATE stock_moves
     SET quantity_done = _qty,
         lot_id = COALESCE(_lot, lot_id)
   WHERE id = _move;

  RETURN jsonb_build_object('move_id', _move, 'quantity_done', _qty, 'demand', v_move.quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_increment_move(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_set_move_done(uuid, numeric, uuid) TO authenticated;
