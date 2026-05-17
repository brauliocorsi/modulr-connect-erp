
CREATE OR REPLACE FUNCTION public.purchase_needs_create_po(
  _need_ids uuid[],
  _supplier_id uuid DEFAULT NULL,
  _expected_date date DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  n purchase_needs%ROWTYPE;
  v_need_id uuid;
  v_supplier uuid;
  v_remaining numeric;
  v_unit_price numeric;
  v_uom uuid;
  v_has_variant boolean;
  v_seq int;
  v_po_id uuid;
  v_pol_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_distinct_suppliers int;
  v_existing_pol uuid;
  v_existing_po uuid;
  v_existing_state text;
  v_already_existing jsonb := '[]'::jsonb;
  v_bypass boolean;
BEGIN
  v_bypass := current_user IN ('postgres','service_role','supabase_admin');
  IF NOT v_bypass AND NOT public.purchase_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  IF _need_ids IS NULL OR cardinality(_need_ids) = 0 THEN
    RAISE EXCEPTION 'NEED_IDS_REQUIRED';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _pn_buf (
    need_id uuid PRIMARY KEY, supplier_id uuid, remaining numeric,
    unit_price numeric, uom_id uuid, expected_date date
  ) ON COMMIT DROP;
  DELETE FROM _pn_buf;

  FOREACH v_need_id IN ARRAY _need_ids LOOP
    SELECT * INTO n FROM purchase_needs WHERE id = v_need_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NEED_NOT_FOUND: %', v_need_id; END IF;
    IF n.state = 'cancelled' THEN RAISE EXCEPTION 'NEED_CANCELLED: %', v_need_id; END IF;
    IF n.state = 'received'  THEN RAISE EXCEPTION 'NEED_RECEIVED: %', v_need_id; END IF;

    IF n.purchase_order_line_id IS NOT NULL THEN
      SELECT pol.id, pol.order_id, po.state::text
        INTO v_existing_pol, v_existing_po, v_existing_state
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id = pol.order_id
       WHERE pol.id = n.purchase_order_line_id;
      IF v_existing_pol IS NOT NULL THEN
        v_already_existing := v_already_existing || jsonb_build_array(jsonb_build_object(
          'need_id', v_need_id, 'purchase_order_id', v_existing_po,
          'purchase_order_line_id', v_existing_pol, 'po_state', v_existing_state,
          'reason', 'already_linked'));
        CONTINUE;
      END IF;
    END IF;

    v_remaining := public.purchase_need_remaining_qty(v_need_id);
    IF v_remaining IS NULL OR v_remaining <= 0 THEN
      RAISE EXCEPTION 'NEED_NO_REMAINING_QTY: %', v_need_id;
    END IF;

    SELECT EXISTS(SELECT 1 FROM product_variants pv WHERE pv.product_id = n.product_id AND pv.active)
      INTO v_has_variant;
    IF v_has_variant AND n.product_variant_id IS NULL THEN
      RAISE EXCEPTION 'NEED_VARIANT_REQUIRED: %', v_need_id;
    END IF;

    IF _supplier_id IS NOT NULL THEN
      v_supplier := _supplier_id;
    ELSIF n.suggested_partner_id IS NOT NULL THEN
      v_supplier := n.suggested_partner_id;
    ELSE
      SELECT partner_id INTO v_supplier FROM product_suppliers
       WHERE product_id = n.product_id
       ORDER BY priority NULLS LAST, COALESCE(price, 0) LIMIT 1;
      IF v_supplier IS NULL THEN
        RAISE EXCEPTION 'NEED_SUPPLIER_SELECTION: %', v_need_id;
      END IF;
    END IF;

    SELECT price INTO v_unit_price FROM product_suppliers
     WHERE product_id = n.product_id AND partner_id = v_supplier
     ORDER BY priority NULLS LAST LIMIT 1;
    v_unit_price := COALESCE(v_unit_price, 0);
    SELECT COALESCE(purchase_uom_id, uom_id) INTO v_uom FROM products WHERE id = n.product_id;

    INSERT INTO _pn_buf(need_id, supplier_id, remaining, unit_price, uom_id, expected_date)
    VALUES (v_need_id, v_supplier, v_remaining, v_unit_price, v_uom,
            COALESCE(_expected_date, n.needed_by));
  END LOOP;

  IF _supplier_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT supplier_id) INTO v_distinct_suppliers FROM _pn_buf;
    IF v_distinct_suppliers > 1 THEN RAISE EXCEPTION 'MIXED_SUPPLIER_SELECTION'; END IF;
  END IF;

  FOR v_supplier IN SELECT DISTINCT supplier_id FROM _pn_buf LOOP
    INSERT INTO purchase_orders(
      name, partner_id, state, buyer_id, date_order, expected_date,
      amount_untaxed, amount_tax, amount_total, warehouse_id, origin, created_by)
    VALUES (
      public.next_sequence('purchase_order'),
      v_supplier, 'draft'::purchase_order_state,
      CASE WHEN v_bypass THEN NULL ELSE auth.uid() END,
      now(),
      (SELECT MIN(expected_date) FROM _pn_buf WHERE supplier_id = v_supplier),
      0, 0, 0, public.default_warehouse_id(),
      'purchase_needs',
      CASE WHEN v_bypass THEN NULL ELSE auth.uid() END)
    RETURNING id INTO v_po_id;

    v_seq := 10;
    FOR n IN
      SELECT pn.* FROM purchase_needs pn
        JOIN _pn_buf b ON b.need_id = pn.id
       WHERE b.supplier_id = v_supplier
       ORDER BY pn.priority DESC, pn.created_at
    LOOP
      SELECT remaining, unit_price, uom_id
        INTO v_remaining, v_unit_price, v_uom
        FROM _pn_buf WHERE need_id = n.id;

      INSERT INTO purchase_order_lines(
        order_id, product_id, variant_id, description,
        quantity, uom_id, unit_price, tax_pct, discount_pct,
        subtotal, sequence, source_sale_order_id)
      VALUES (
        v_po_id, n.product_id, n.product_variant_id, NULL,
        v_remaining, v_uom, v_unit_price, 0, 0,
        v_remaining * v_unit_price, v_seq, n.sale_order_id)
      RETURNING id INTO v_pol_id;
      v_seq := v_seq + 10;

      UPDATE purchase_needs
         SET purchase_order_id = v_po_id,
             purchase_order_line_id = v_pol_id,
             state = 'po_created'::purchase_need_state
       WHERE id = n.id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'need_id', n.id, 'purchase_order_id', v_po_id,
        'purchase_order_line_id', v_pol_id));
    END LOOP;

    UPDATE purchase_orders po
       SET amount_untaxed = COALESCE(s.untaxed, 0),
           amount_tax     = COALESCE(s.tax, 0),
           amount_total   = COALESCE(s.untaxed, 0) + COALESCE(s.tax, 0)
      FROM (
        SELECT order_id,
               SUM(quantity * unit_price * (1 - discount_pct/100.0)) AS untaxed,
               SUM(quantity * unit_price * (1 - discount_pct/100.0) * (tax_pct/100.0)) AS tax
          FROM purchase_order_lines WHERE order_id = v_po_id GROUP BY order_id
      ) s
     WHERE po.id = v_po_id AND s.order_id = po.id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_results, 'already_linked', v_already_existing);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_need(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n purchase_needs%ROWTYPE; v_bypass boolean;
BEGIN
  v_bypass := current_user IN ('postgres','service_role','supabase_admin');
  IF NOT v_bypass AND NOT public.purchase_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_n FROM purchase_needs WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEED_NOT_FOUND'; END IF;
  IF v_n.state IN ('received','cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'state', v_n.state::text);
  END IF;
  IF v_n.purchase_order_id IS NOT NULL AND v_n.state IN ('po_created','partially_received') THEN
    RAISE EXCEPTION 'NEED_ALREADY_ORDERED';
  END IF;
  UPDATE purchase_needs SET state='cancelled' WHERE id=_id;
  RETURN jsonb_build_object('ok', true, 'id', _id);
END $function$;
