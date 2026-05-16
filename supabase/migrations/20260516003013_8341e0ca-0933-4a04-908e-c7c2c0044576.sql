CREATE OR REPLACE FUNCTION public.so_run_operational_plan(_order_id uuid, _mode text DEFAULT 'auto'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_line RECORD;
  v_class jsonb; v_classification text;
  v_qty_ready numeric; v_qty_miss numeric;
  v_inherited numeric;
  v_reserved numeric;
  v_need_id uuid; v_mo_id uuid;
  v_lead int;
  v_eta date; v_src text; v_conf text;
  v_status text;
  v_comp_short int;
  v_lines_summary jsonb := '[]'::jsonb;
  v_started timestamptz := clock_timestamp();
  v_counts jsonb := jsonb_build_object('reserved',0,'needs',0,'mos',0,'inherited',0);
  v_max_eta date;
  v_is_inherit boolean;
BEGIN
  SELECT * INTO v_so FROM sale_orders WHERE id=_order_id FOR UPDATE;
  IF v_so.id IS NULL THEN RETURN jsonb_build_object('error','sale_order_not_found'); END IF;
  IF v_so.state <> 'confirmed' THEN
    RETURN jsonb_build_object('skipped','sale_not_confirmed','state',v_so.state::text);
  END IF;

  v_is_inherit := (_mode = 'inherit') OR COALESCE(v_so.is_deferred,false);

  IF v_so.last_planned_at IS NOT NULL
     AND v_so.last_planned_at > now() - interval '2 seconds'
     AND _mode = 'replan' THEN
    RETURN jsonb_build_object('skipped','replan_throttled');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_order_id::text));

  FOR v_line IN
    SELECT * FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product' AND product_id IS NOT NULL
  LOOP
    v_class := so_classify_line(v_line.id);
    v_classification := v_class->>'classification';
    v_qty_ready := (v_class->>'qty_ready')::numeric;
    v_qty_miss  := (v_class->>'qty_missing')::numeric;

    v_inherited := 0;
    IF v_is_inherit THEN
      v_inherited := _soss_inherited_qty(v_line.id);
      IF v_inherited > 0 THEN
        v_qty_miss := GREATEST(0, v_qty_miss - v_inherited);
        v_counts := jsonb_set(v_counts,'{inherited}', to_jsonb(((v_counts->>'inherited')::numeric + v_inherited)));
      END IF;
    END IF;

    v_reserved := 0;
    IF v_qty_ready > 0 THEN
      v_reserved := _so_reserve_line(v_line.id, v_qty_ready);
      v_counts := jsonb_set(v_counts,'{reserved}', to_jsonb(((v_counts->>'reserved')::numeric + v_reserved)));
    END IF;

    v_need_id := NULL; v_mo_id := NULL; v_lead := 7; v_comp_short := 0;
    IF v_qty_miss > 0 THEN
      IF (v_class->>'product_can_be_manufactured')::boolean AND (v_class->>'has_active_bom')::boolean THEN
        v_mo_id := _so_ensure_mo_for_line(v_line.id, v_qty_miss);
        IF v_mo_id IS NOT NULL THEN
          v_counts := jsonb_set(v_counts,'{mos}', to_jsonb(((v_counts->>'mos')::int + 1)));
          PERFORM _soss_record(v_line.id, 'manufacturing_order', NULL, NULL, v_mo_id, v_qty_miss);
          PERFORM so_emit_timeline(_order_id,'manufacturing.planned', v_line.id,
                                   v_mo_id::text, jsonb_build_object('qty',v_qty_miss), _mode);
          SELECT count(*) INTO v_comp_short
            FROM purchase_needs
           WHERE manufacturing_order_id = v_mo_id
             AND state IN ('pending','quoting','approved');
        END IF;
      ELSIF (v_class->>'product_can_be_purchased')::boolean THEN
        SELECT COALESCE(ps.lead_time_days, p.purchase_lead_time_days, 7)
          INTO v_lead
          FROM products p
          LEFT JOIN LATERAL (SELECT lead_time_days FROM product_suppliers
                              WHERE product_id=p.id ORDER BY priority NULLS LAST LIMIT 1) ps ON true
         WHERE p.id=v_line.product_id;
        v_need_id := create_purchase_need(v_line.product_id, v_qty_miss, 'sale'::purchase_need_origin,
                       _order_id, NULL,
                       COALESCE(v_so.commitment_date, CURRENT_DATE + COALESCE(v_lead,7)),
                       'auto by so_run_operational_plan');
        IF v_need_id IS NOT NULL THEN
          v_counts := jsonb_set(v_counts,'{needs}', to_jsonb(((v_counts->>'needs')::int + 1)));
          PERFORM _soss_record(v_line.id, 'purchase_need', v_need_id, NULL, NULL, v_qty_miss);
          PERFORM so_emit_timeline(_order_id,'purchase.planned', v_line.id,
                                   v_need_id::text, jsonb_build_object('qty',v_qty_miss,'lead',v_lead), _mode);
        END IF;
      END IF;
    END IF;

    IF v_qty_miss = 0 AND v_inherited = 0 THEN
      v_eta := CURRENT_DATE; v_src := 'stock'; v_conf := 'high';
    ELSIF v_inherited > 0 AND v_qty_miss = 0 THEN
      v_eta := v_so.expected_ready_date; v_src := 'inherited_supply'; v_conf := 'medium';
    ELSIF v_mo_id IS NOT NULL THEN
      SELECT CURRENT_DATE + COALESCE(mfg_lead_time_days, 7) INTO v_eta FROM products WHERE id=v_line.product_id;
      v_src := 'manufacturing'; v_conf := 'medium';
    ELSIF v_need_id IS NOT NULL THEN
      v_eta := CURRENT_DATE + COALESCE(v_lead,7); v_src := 'incoming_purchase'; v_conf := 'medium';
    ELSE
      v_eta := NULL; v_src := 'backorder'; v_conf := 'low';
    END IF;
    IF v_qty_ready > 0 AND (v_qty_miss > 0 OR v_inherited > 0) THEN v_src := 'mixed'; END IF;

    IF v_qty_miss = 0 AND v_inherited = 0 THEN v_status := 'ready_stock';
    ELSIF v_qty_ready > 0 THEN v_status := 'partially_reserved';
    ELSIF v_inherited > 0 AND v_qty_miss = 0 THEN v_status := 'waiting_inherited_supply';
    ELSIF v_mo_id IS NOT NULL THEN v_status := 'waiting_manufacturing';
    ELSIF v_need_id IS NOT NULL THEN v_status := 'waiting_purchase';
    ELSE v_status := 'backorder';
    END IF;

    -- Fase 13 fix: se a MO tem componentes em falta (purchase_needs vinculadas), classificar como waiting_components
    IF v_mo_id IS NOT NULL AND v_comp_short > 0 AND v_qty_ready = 0 THEN
      v_status := 'waiting_components';
      v_conf := 'low';
    END IF;

    UPDATE sale_order_lines
       SET qty_reserved = v_reserved,
           qty_to_purchase    = CASE WHEN v_need_id IS NOT NULL THEN v_qty_miss ELSE 0 END,
           qty_to_manufacture = CASE WHEN v_mo_id   IS NOT NULL THEN v_qty_miss ELSE 0 END,
           operational_status = v_status,
           expected_availability_date = v_eta,
           availability_source = v_src,
           confidence_level = v_conf,
           last_planned_at = now()
     WHERE id = v_line.id;

    v_lines_summary := v_lines_summary || jsonb_build_object(
      'line_id', v_line.id, 'classification', v_classification, 'qty_ready', v_qty_ready,
      'qty_missing', v_qty_miss, 'inherited', v_inherited, 'status', v_status,
      'eta', v_eta, 'source', v_src, 'confidence', v_conf,
      'need_id', v_need_id, 'mo_id', v_mo_id, 'comp_short', v_comp_short);

    IF v_eta IS NOT NULL AND (v_max_eta IS NULL OR v_eta > v_max_eta) THEN v_max_eta := v_eta; END IF;
  END LOOP;

  UPDATE sale_orders
     SET operational_status = so_rollup_operational_status(_order_id),
         expected_ready_date = v_max_eta,
         last_planned_at = now()
   WHERE id = _order_id;

  PERFORM so_emit_timeline(_order_id,'plan.executed', NULL,
            extract(epoch from now())::bigint::text,
            jsonb_build_object('mode',_mode,'inherit',v_is_inherit,'counts',v_counts), _mode);

  INSERT INTO sale_operational_plan_log(sale_order_id, mode, summary, duration_ms)
  VALUES (_order_id, _mode,
          jsonb_build_object('counts',v_counts,'lines',v_lines_summary,'eta',v_max_eta,'inherit',v_is_inherit),
          (extract(epoch from clock_timestamp() - v_started)*1000)::int);

  RETURN jsonb_build_object('ok',true,'inherit',v_is_inherit,'counts',v_counts,'eta',v_max_eta,'lines',v_lines_summary);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO sale_operational_plan_log(sale_order_id, mode, error, duration_ms, summary)
  VALUES (_order_id, _mode, SQLERRM,
          (extract(epoch from clock_timestamp() - v_started)*1000)::int,
          jsonb_build_object('failed_at','exception'));
  RAISE;
END $function$;