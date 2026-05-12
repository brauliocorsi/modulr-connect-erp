CREATE OR REPLACE FUNCTION public.putaway_stock(
  _product uuid,
  _package uuid,
  _qty numeric,
  _location uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_loc record;
  v_stock_loc uuid;
  v_quant_id uuid;
  v_move_id uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade tem de ser maior que zero';
  END IF;

  SELECT * INTO v_loc FROM public.stock_locations WHERE id = _location;
  IF NOT FOUND THEN RAISE EXCEPTION 'Localização não encontrada'; END IF;
  IF v_loc.type <> 'internal' THEN
    RAISE EXCEPTION 'Localização tem de ser interna';
  END IF;

  -- Source: warehouse "Stock" virtual location
  v_stock_loc := public.default_location(v_loc.warehouse_id, 'Stock');
  IF v_stock_loc IS NULL THEN
    RAISE EXCEPTION 'Localização "Stock" do armazém não encontrada';
  END IF;

  -- Upsert quant on destination
  SELECT id INTO v_quant_id FROM public.stock_quants
    WHERE product_id = _product
      AND location_id = _location
      AND COALESCE(package_id::text,'') = COALESCE(_package::text,'')
    LIMIT 1;
  IF v_quant_id IS NULL THEN
    INSERT INTO public.stock_quants(product_id, location_id, package_id, quantity)
      VALUES (_product, _location, _package, _qty)
      RETURNING id INTO v_quant_id;
  ELSE
    UPDATE public.stock_quants
       SET quantity = quantity + _qty,
           updated_at = now()
     WHERE id = v_quant_id;
  END IF;

  -- Audit move (done) — only if source <> destination
  IF v_stock_loc <> _location THEN
    INSERT INTO public.stock_moves(
      product_id, package_id, source_location_id, destination_location_id,
      quantity, quantity_done, state, reference
    ) VALUES (
      _product, _package, v_stock_loc, _location,
      _qty, _qty, 'done'::picking_state, 'PUTAWAY'
    ) RETURNING id INTO v_move_id;
  END IF;

  PERFORM public.log_record_event('product', _product,
    format('Arrumado %s un. em %s%s', _qty, COALESCE(v_loc.full_path, v_loc.name),
           CASE WHEN _package IS NOT NULL THEN ' (colis)' ELSE '' END),
    jsonb_build_object('location_id', _location, 'package_id', _package));

  RETURN v_quant_id;
END $function$;