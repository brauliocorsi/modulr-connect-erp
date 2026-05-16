
CREATE OR REPLACE FUNCTION public.transfer_sale_reservation(
  _from_sale_order_line_id uuid,
  _to_sale_order_line_id   uuid,
  _qty                     numeric,
  _reason                  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from   public.sale_order_lines%ROWTYPE;
  v_to     public.sale_order_lines%ROWTYPE;
  v_prod   public.products%ROWTYPE;
  v_to_so  uuid;
  v_pkg    record;
  v_moved  numeric := 0;
  v_demand numeric;
  v_pkgs   jsonb := '[]'::jsonb;
  v_take   numeric;
  v_allow_dock boolean;
  v_pkg_ids uuid[];
BEGIN
  IF _from_sale_order_line_id IS NULL OR _to_sale_order_line_id IS NULL OR _qty IS NULL OR _qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;
  IF _from_sale_order_line_id = _to_sale_order_line_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_line');
  END IF;

  IF NOT public.is_sale_line_compatible_for_allocation(_from_sale_order_line_id, _to_sale_order_line_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incompatible_lines');
  END IF;

  SELECT * INTO v_from FROM public.sale_order_lines WHERE id = _from_sale_order_line_id FOR UPDATE;
  SELECT * INTO v_to   FROM public.sale_order_lines WHERE id = _to_sale_order_line_id   FOR UPDATE;
  SELECT order_id INTO v_to_so FROM public.sale_order_lines WHERE id = _to_sale_order_line_id;
  SELECT * INTO v_prod FROM public.products WHERE id = v_from.product_id;

  v_demand := public.sale_line_qty_missing(_to_sale_order_line_id);
  IF v_demand <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_has_no_demand');
  END IF;
  IF COALESCE(v_from.qty_reserved,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source_has_no_reservation');
  END IF;

  v_allow_dock := _reason IS NOT NULL AND _reason ILIKE '%manual_override%';

  IF COALESCE(v_prod.package_tracking_enabled,false) THEN
    FOR v_pkg IN
      SELECT id, qty, status, condition
        FROM public.stock_packages
       WHERE sale_order_line_id = _from_sale_order_line_id
       ORDER BY qty ASC
       FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN v_moved >= _qty;
      -- block terminal / outbound statuses
      IF v_pkg.status IN ('delivered','picked','cancelled') THEN
        CONTINUE;
      END IF;
      -- block compromised condition
      IF v_pkg.condition IN ('damaged','quarantine','missing') THEN
        CONTINUE;
      END IF;
      -- block packages already staged at dock / loaded unless override
      IF v_pkg.status IN ('at_dock','loaded') AND NOT v_allow_dock THEN
        CONTINUE;
      END IF;
      IF (v_moved + v_pkg.qty) > _qty THEN CONTINUE; END IF;

      UPDATE public.stock_packages
         SET sale_order_line_id = _to_sale_order_line_id,
             sale_order_id      = v_to_so,
             status             = 'reserved'
       WHERE id = v_pkg.id;

      v_moved := v_moved + v_pkg.qty;
      v_pkgs  := v_pkgs || to_jsonb(v_pkg.id);
    END LOOP;

    IF v_moved <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_eligible_packages');
    END IF;
  ELSE
    v_take := LEAST(_qty, COALESCE(v_from.qty_reserved,0), v_demand);
    IF v_take <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_qty_to_move');
    END IF;
    v_moved := v_take;
  END IF;

  UPDATE public.sale_order_lines
     SET qty_reserved = GREATEST(COALESCE(qty_reserved,0) - v_moved, 0)
   WHERE id = _from_sale_order_line_id;
  UPDATE public.sale_order_lines
     SET qty_reserved = COALESCE(qty_reserved,0) + v_moved
   WHERE id = _to_sale_order_line_id;

  v_pkg_ids := CASE WHEN jsonb_array_length(v_pkgs) > 0
                    THEN ARRAY(SELECT (value::text)::uuid FROM jsonb_array_elements_text(v_pkgs))
                    ELSE NULL END;

  INSERT INTO public.stock_reservation_log(
    product_id, variant_id, qty, origin_type, origin_id, action, notes,
    from_sale_order_line_id, to_sale_order_line_id, package_ids, payload
  ) VALUES (
    v_from.product_id, v_from.variant_id, v_moved,
    'MANUAL', NULL, 'transfer', _reason,
    _from_sale_order_line_id, _to_sale_order_line_id,
    v_pkg_ids,
    jsonb_build_object(
      'source','transfer_sale_reservation',
      'reason', _reason,
      'tracking', COALESCE(v_prod.package_tracking_enabled,false),
      'product_id', v_from.product_id,
      'variant_id', v_from.variant_id,
      'from_sale_order_line_id', _from_sale_order_line_id,
      'to_sale_order_line_id', _to_sale_order_line_id,
      'qty', v_moved,
      'package_ids', v_pkgs
    )
  );

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'packages', v_pkgs);
END;
$$;
