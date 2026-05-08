-- Backorder tracking
ALTER TABLE public.stock_pickings
  ADD COLUMN IF NOT EXISTS backorder_id uuid REFERENCES public.stock_pickings(id);

CREATE INDEX IF NOT EXISTS idx_stock_pickings_backorder ON public.stock_pickings(backorder_id);

-- Recreate validate_picking to create backorders for partially fulfilled moves
CREATE OR REPLACE FUNCTION public.validate_picking(_picking uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  prod record;
  pk record;
  pk_kind picking_kind;
  bo_id uuid;
  bo_name text;
  seq_code text;
  shortage numeric;
  has_shortage boolean := false;
BEGIN
  SELECT * INTO pk FROM stock_pickings WHERE id = _picking;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking not found'; END IF;

  FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking LOOP
    SELECT tracking INTO prod FROM products WHERE id = m.product_id;
    IF prod.tracking IS DISTINCT FROM 'none' AND m.lot_id IS NULL AND COALESCE(m.quantity_done,0) > 0 THEN
      RAISE EXCEPTION 'Produto rastreado por % requer lote/série no movimento', prod.tracking;
    END IF;

    IF COALESCE(m.quantity_done,0) > 0 THEN
      UPDATE stock_quants
        SET quantity = quantity - m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.source_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.source_location_id, m.lot_id, -m.quantity_done);
      END IF;

      UPDATE stock_quants
        SET quantity = quantity + m.quantity_done
        WHERE product_id = m.product_id
          AND location_id = m.destination_location_id
          AND COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(m.lot_id, '00000000-0000-0000-0000-000000000000'::uuid);
      IF NOT FOUND THEN
        INSERT INTO stock_quants(product_id, variant_id, location_id, lot_id, quantity)
        VALUES (m.product_id, m.variant_id, m.destination_location_id, m.lot_id, m.quantity_done);
      END IF;
    END IF;

    IF COALESCE(m.quantity_done,0) < m.quantity THEN
      has_shortage := true;
    END IF;

    UPDATE stock_moves SET state = 'done' WHERE id = m.id;
  END LOOP;

  -- Create backorder if any shortage
  IF has_shortage THEN
    seq_code := CASE pk.kind
      WHEN 'incoming' THEN 'picking_in'
      WHEN 'outgoing' THEN 'picking_out'
      ELSE 'picking_int'
    END;
    bo_name := public.next_sequence(seq_code);
    INSERT INTO public.stock_pickings(
      name, kind, state, warehouse_id, source_location_id, destination_location_id,
      partner_id, origin, scheduled_at, backorder_id, created_by
    ) VALUES (
      bo_name, pk.kind, 'ready'::picking_state, pk.warehouse_id,
      pk.source_location_id, pk.destination_location_id,
      pk.partner_id, pk.origin, now(), _picking, pk.created_by
    ) RETURNING id INTO bo_id;

    FOR m IN SELECT * FROM stock_moves WHERE picking_id = _picking AND COALESCE(quantity_done,0) < quantity LOOP
      shortage := m.quantity - COALESCE(m.quantity_done,0);
      INSERT INTO stock_moves(
        picking_id, product_id, variant_id, uom_id,
        source_location_id, destination_location_id, quantity, state, reference
      ) VALUES (
        bo_id, m.product_id, m.variant_id, m.uom_id,
        m.source_location_id, m.destination_location_id, shortage,
        'ready'::picking_state, m.reference
      );
    END LOOP;

    -- Try to reserve for outgoing backorder
    IF pk.kind = 'outgoing' THEN
      DECLARE bm record;
      BEGIN
        FOR bm IN SELECT id FROM stock_moves WHERE picking_id = bo_id LOOP
          PERFORM public.reserve_for_move(bm.id);
        END LOOP;
      END;
    END IF;

    PERFORM public.log_record_event('stock_picking', _picking,
      format('Backorder %s criada para quantidades pendentes', bo_name),
      jsonb_build_object('backorder_id', bo_id, 'backorder_name', bo_name));
    PERFORM public.log_record_event('stock_picking', bo_id,
      format('Backorder de %s', pk.name), '{}'::jsonb);
  END IF;

  UPDATE stock_pickings SET state = 'done', done_at = now() WHERE id = _picking;

  SELECT kind INTO pk_kind FROM stock_pickings WHERE id = _picking;
  IF pk_kind = 'incoming' THEN
    PERFORM public.reserve_incoming_to_origin_so(_picking);
  END IF;
END;
$function$;

-- RPC to create internal transfer manually
CREATE OR REPLACE FUNCTION public.create_internal_transfer(
  _source uuid,
  _destination uuid,
  _lines jsonb,
  _scheduled_at timestamptz DEFAULT now(),
  _partner uuid DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  pk_id uuid;
  pk_name text;
  wh uuid;
  ln jsonb;
BEGIN
  IF _source IS NULL OR _destination IS NULL THEN
    RAISE EXCEPTION 'Origem e destino obrigatórios';
  END IF;
  SELECT warehouse_id INTO wh FROM public.stock_locations WHERE id = _source;
  pk_name := public.next_sequence('picking_int');
  INSERT INTO public.stock_pickings(
    name, kind, state, warehouse_id, source_location_id, destination_location_id,
    partner_id, scheduled_at, created_by
  ) VALUES (
    pk_name, 'internal'::picking_kind, 'draft'::picking_state, wh,
    _source, _destination, _partner, _scheduled_at, auth.uid()
  ) RETURNING id INTO pk_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    INSERT INTO public.stock_moves(
      picking_id, product_id, uom_id, source_location_id, destination_location_id,
      quantity, state
    ) VALUES (
      pk_id,
      (ln->>'product_id')::uuid,
      NULLIF(ln->>'uom_id','')::uuid,
      _source, _destination,
      (ln->>'quantity')::numeric,
      'draft'::picking_state
    );
  END LOOP;

  -- Try to reserve
  DECLARE mv record;
  BEGIN
    FOR mv IN SELECT id FROM stock_moves WHERE picking_id = pk_id LOOP
      PERFORM public.reserve_for_move(mv.id);
    END LOOP;
  END;

  RETURN pk_id;
END;
$$;