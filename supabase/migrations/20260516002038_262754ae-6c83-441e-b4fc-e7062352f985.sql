
-- ============================================================================
-- FASE 14 — RPCs e triggers
-- ============================================================================

-- ---------- Helper: registrar supply_link ----------
CREATE OR REPLACE FUNCTION public._soss_record(
  _line_id uuid,
  _kind public.supply_link_kind,
  _need_id uuid,
  _pol_id uuid,
  _mo_id uuid,
  _qty numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  -- não duplicar
  IF _need_id IS NOT NULL AND EXISTS(SELECT 1 FROM sale_order_line_supply_links WHERE purchase_need_id=_need_id AND state='active') THEN RETURN NULL; END IF;
  IF _pol_id  IS NOT NULL AND EXISTS(SELECT 1 FROM sale_order_line_supply_links WHERE purchase_order_line_id=_pol_id AND state='active') THEN RETURN NULL; END IF;
  IF _mo_id   IS NOT NULL AND EXISTS(SELECT 1 FROM sale_order_line_supply_links WHERE manufacturing_order_id=_mo_id AND state='active') THEN RETURN NULL; END IF;

  INSERT INTO sale_order_line_supply_links(sale_order_line_id, origin_line_id, link_kind, purchase_need_id, purchase_order_line_id, manufacturing_order_id, qty, state)
  VALUES (_line_id, _line_id, _kind, _need_id, _pol_id, _mo_id, _qty, 'active')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- Helper: cobertura herdada de uma linha ----------
CREATE OR REPLACE FUNCTION public._soss_inherited_qty(_line_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(qty),0)::numeric
  FROM sale_order_line_supply_links
  WHERE sale_order_line_id = _line_id AND state = 'active'
    AND link_kind IN ('purchase_need','purchase_order_line','manufacturing_order');
$$;

-- ---------- Patch: so_run_operational_plan (com inherit + auto-record links) ----------
CREATE OR REPLACE FUNCTION public.so_run_operational_plan(_order_id uuid, _mode text DEFAULT 'auto')
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

    -- Cobertura herdada de supply_links (apenas no inherit)
    v_inherited := 0;
    IF v_is_inherit THEN
      v_inherited := _soss_inherited_qty(v_line.id);
      IF v_inherited > 0 THEN
        v_qty_miss := GREATEST(0, v_qty_miss - v_inherited);
        v_counts := jsonb_set(v_counts,'{inherited}', to_jsonb(((v_counts->>'inherited')::numeric + v_inherited)));
      END IF;
    END IF;

    -- Reservar stock real disponível
    v_reserved := 0;
    IF v_qty_ready > 0 THEN
      v_reserved := _so_reserve_line(v_line.id, v_qty_ready);
      v_counts := jsonb_set(v_counts,'{reserved}', to_jsonb(((v_counts->>'reserved')::numeric + v_reserved)));
    END IF;

    v_need_id := NULL; v_mo_id := NULL; v_lead := 7;
    IF v_qty_miss > 0 THEN
      IF (v_class->>'product_can_be_manufactured')::boolean AND (v_class->>'has_active_bom')::boolean THEN
        v_mo_id := _so_ensure_mo_for_line(v_line.id, v_qty_miss);
        IF v_mo_id IS NOT NULL THEN
          v_counts := jsonb_set(v_counts,'{mos}', to_jsonb(((v_counts->>'mos')::int + 1)));
          PERFORM _soss_record(v_line.id, 'manufacturing_order', NULL, NULL, v_mo_id, v_qty_miss);
          PERFORM so_emit_timeline(_order_id,'manufacturing.planned', v_line.id,
                                   v_mo_id::text, jsonb_build_object('qty',v_qty_miss), _mode);
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

    -- ETA
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
      'need_id', v_need_id, 'mo_id', v_mo_id);

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

-- ---------- Backfill: registar supply_links para needs/MOs já existentes ----------
INSERT INTO public.sale_order_line_supply_links(sale_order_line_id, origin_line_id, link_kind, purchase_need_id, qty, state)
SELECT sol.id, sol.id, 'purchase_need'::public.supply_link_kind, pn.id, pn.qty_needed, 'active'
FROM public.purchase_needs pn
JOIN public.sale_order_lines sol
  ON sol.order_id = pn.sale_order_id AND sol.product_id = pn.product_id
WHERE pn.sale_order_id IS NOT NULL
  AND pn.state IN ('pending','quoting','approved','po_created','partially_received')
  AND NOT EXISTS (SELECT 1 FROM public.sale_order_line_supply_links sl WHERE sl.purchase_need_id = pn.id);

INSERT INTO public.sale_order_line_supply_links(sale_order_line_id, origin_line_id, link_kind, manufacturing_order_id, qty, state)
SELECT mo.sale_order_line_id, mo.sale_order_line_id, 'manufacturing_order'::public.supply_link_kind, mo.id, mo.qty, 'active'
FROM public.manufacturing_orders mo
WHERE mo.sale_order_line_id IS NOT NULL
  AND mo.state NOT IN ('done','cancelled')
  AND NOT EXISTS (SELECT 1 FROM public.sale_order_line_supply_links sl WHERE sl.manufacturing_order_id = mo.id);

-- ---------- _so_split_finance ----------
CREATE OR REPLACE FUNCTION public._so_split_finance(_parent uuid, _deferred uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_orig numeric;
  v_delivered_value numeric;
  v_deferred_value numeric;
  v_paid numeric;
  v_parent_amount numeric;
  v_sinal_carry numeric := 0;
  v_delta numeric;
  v_alloc_id uuid;
BEGIN
  SELECT amount_total INTO v_total_orig FROM sale_orders WHERE id=_parent;

  -- valor já entregue (com base nos preços das linhas originais)
  SELECT COALESCE(SUM(sol.qty_delivered * sol.unit_price * (1 - COALESCE(sol.discount_pct,0)/100) * (1 + COALESCE(sol.tax_pct,0)/100)),0)
    INTO v_delivered_value
    FROM sale_order_lines sol WHERE sol.order_id=_parent;

  v_delivered_value := ROUND(v_delivered_value::numeric, 2);
  v_deferred_value  := ROUND((v_total_orig - v_delivered_value)::numeric, 2);

  -- pagamentos já registados
  SELECT COALESCE(SUM(amount),0) INTO v_paid
    FROM customer_payments WHERE order_id=_parent AND state IN ('posted','pending','pending_delivery');

  -- delta de arredondamento
  v_delta := ROUND((v_total_orig - (v_delivered_value + v_deferred_value))::numeric, 4);

  -- sinal aplicado à diferida = excedente sobre o entregue
  IF v_paid > v_delivered_value THEN
    v_sinal_carry := LEAST(v_paid - v_delivered_value, v_deferred_value);
  END IF;

  v_parent_amount := v_delivered_value;

  UPDATE sale_orders SET amount_total = v_parent_amount WHERE id=_parent;
  UPDATE sale_orders SET amount_total = v_deferred_value WHERE id=_deferred;

  -- recriar schedules
  DELETE FROM sale_payment_schedules WHERE order_id IN (_parent, _deferred);
  IF v_parent_amount > 0 THEN
    INSERT INTO sale_payment_schedules(order_id, sequence, label, due_kind, percent, amount, paid_amount, state)
    VALUES (_parent, 1, 'Entrega', 'on_delivery', 100, v_parent_amount,
            LEAST(v_paid, v_parent_amount),
            CASE WHEN v_paid >= v_parent_amount THEN 'paid' ELSE 'pending' END);
  END IF;
  IF v_deferred_value > 0 THEN
    INSERT INTO sale_payment_schedules(order_id, sequence, label, due_kind, percent, amount, paid_amount, state)
    VALUES (_deferred, 1, 'Saldo na entrega futura', 'on_delivery', 100, v_deferred_value,
            v_sinal_carry,
            CASE WHEN v_sinal_carry >= v_deferred_value THEN 'paid' ELSE 'pending' END);
  END IF;

  -- payment_status
  UPDATE sale_orders SET payment_status =
    CASE WHEN v_paid >= v_parent_amount THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END
   WHERE id=_parent;
  UPDATE sale_orders SET payment_status =
    CASE WHEN v_sinal_carry >= v_deferred_value THEN 'paid' WHEN v_sinal_carry > 0 THEN 'partial' ELSE 'unpaid' END
   WHERE id=_deferred;

  INSERT INTO sale_split_payment_allocations(parent_order_id, deferred_order_id,
    amount_total_original, amount_total_parent_after, amount_total_deferred,
    paid_so_far, sinal_applied_to_deferred, delta_rounding)
  VALUES (_parent, _deferred, v_total_orig, v_parent_amount, v_deferred_value,
          v_paid, v_sinal_carry, v_delta)
  RETURNING id INTO v_alloc_id;

  RETURN jsonb_build_object('alloc_id', v_alloc_id, 'parent_after', v_parent_amount,
    'deferred', v_deferred_value, 'paid', v_paid, 'sinal_carry', v_sinal_carry, 'delta', v_delta);
END $$;

-- ---------- so_split_partial_delivery ----------
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

  -- idempotência: já existe diferida ativa para este parent?
  SELECT id INTO v_existing FROM sale_orders
   WHERE parent_sale_order_id=_order_id AND is_deferred=true AND state='confirmed' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'deferred_id',v_existing);
  END IF;

  -- existem itens pendentes?
  IF NOT EXISTS (
    SELECT 1 FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product'
      AND (quantity - COALESCE(qty_delivered,0) - COALESCE(qty_split_out,0)) > 0
  ) THEN
    RETURN jsonb_build_object('skipped','no_pending_lines');
  END IF;

  v_root := so_root_id(_order_id);

  -- criar diferida
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

  -- copiar linhas pendentes
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

    -- mover supply_links ativos
    UPDATE sale_order_line_supply_links
       SET sale_order_line_id = v_new_line,
           inherited_from_line_id = v_line.id,
           moved_at = now(),
           updated_at = now()
     WHERE sale_order_line_id = v_line.id AND state = 'active'
       AND link_kind IN ('purchase_need','purchase_order_line','manufacturing_order');

    -- registrar split_out na linha original (preserva histórico)
    UPDATE sale_order_lines
       SET qty_split_out = COALESCE(qty_split_out,0) + v_qty_pending,
           qty_reserved = 0, qty_to_purchase = 0, qty_to_manufacture = 0
     WHERE id = v_line.id;

    v_lines_split := v_lines_split + 1;
  END LOOP;

  -- recalcular totals do parent (apenas o que realmente fica)
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

  -- Restaurar amount_total original p/ alocação (reverter o "encurtamento" do parent antes de _so_split_finance)
  -- Estratégia: somar parent + deferred = original, depois _so_split_finance redistribui
  UPDATE sale_orders SET amount_total = (SELECT amount_total FROM sale_orders WHERE id=_order_id)
                                       + (SELECT amount_total FROM sale_orders WHERE id=v_def_id)
   WHERE id=_order_id;

  v_finance := _so_split_finance(_order_id, v_def_id);

  -- timeline
  PERFORM so_emit_timeline(_order_id,'sale.split.created', NULL, v_def_id::text,
    jsonb_build_object('deferred_id',v_def_id,'lines_split',v_lines_split,'finance',v_finance), 'split');
  PERFORM so_emit_timeline(v_def_id,'sale.deferred.created', NULL, _order_id::text,
    jsonb_build_object('parent_id',_order_id,'root_id',v_root), 'split');

  -- notificar vendedor
  IF v_parent.salesperson_id IS NOT NULL THEN
    BEGIN PERFORM notify_user(v_parent.salesperson_id, 'sales'::app_module, 'so.split',
      'Venda dividida', 'Foi criada SO diferida ' || v_def_name, '/sales/orders/'||v_def_id::text);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- replano da diferida em modo inherit
  PERFORM so_run_operational_plan(v_def_id, 'inherit');

  -- fechar parent se totalmente entregue
  IF NOT EXISTS (
    SELECT 1 FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product'
      AND COALESCE(qty_delivered,0) < COALESCE(quantity,0) - COALESCE(qty_split_out,0)
  ) THEN
    UPDATE sale_orders SET operational_status='completed',
      state = CASE WHEN payment_status='paid' THEN 'done'::sale_order_state ELSE state END,
      closed_at = COALESCE(closed_at, now())
     WHERE id=_order_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'deferred_id',v_def_id,'deferred_name',v_def_name,
    'lines_split',v_lines_split,'finance',v_finance);
END $$;

-- ---------- so_generate_delivery_picking (idempotente) ----------
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

  -- idempotência: já existe picking outgoing aberto para esta SO?
  SELECT id INTO v_pid FROM stock_pickings
   WHERE origin = v_so.name AND kind='outgoing' AND state IN ('draft','assigned','ready')
   ORDER BY created_at DESC LIMIT 1;
  IF v_pid IS NOT NULL THEN RETURN v_pid; END IF;

  -- localizações
  SELECT id INTO v_src FROM stock_locations WHERE warehouse_id=v_so.warehouse_id AND type='internal' AND active=true ORDER BY created_at LIMIT 1;
  SELECT id INTO v_dst FROM stock_locations WHERE type='customer' AND active=true ORDER BY created_at LIMIT 1;
  IF v_src IS NULL OR v_dst IS NULL THEN
    RAISE EXCEPTION 'so_generate_delivery_picking: faltam locations (src=% dst=%)', v_src, v_dst;
  END IF;

  INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id,
    partner_id, origin, scheduled_at)
  VALUES ('OUT/'||substr(v_so.name,1,20)||'/'||to_char(now(),'YYYYMMDDHH24MISS'),
          'outgoing', 'draft', v_so.warehouse_id, v_src, v_dst,
          v_so.partner_id, v_so.name, now())
  RETURNING id INTO v_pid;

  FOR v_line IN
    SELECT * FROM sale_order_lines
    WHERE order_id=_order_id AND line_kind='product' AND product_id IS NOT NULL
      AND COALESCE(qty_reserved,0) > 0
  LOOP
    INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
      source_location_id, destination_location_id, quantity, reserved_quantity, state)
    VALUES (v_pid, v_line.product_id, v_line.variant_id, v_line.uom_id,
      v_src, v_dst, v_line.qty_reserved, v_line.qty_reserved, 'assigned');
  END LOOP;

  PERFORM so_emit_timeline(_order_id, CASE WHEN v_so.is_deferred THEN 'deferred.picking.created' ELSE 'picking.created' END,
    NULL, v_pid::text, jsonb_build_object('picking_id',v_pid), 'auto');

  RETURN v_pid;
END $$;

-- ---------- Triggers de replano: usar supply_links ----------
CREATE OR REPLACE FUNCTION public.tg_zz_mo_done_replan()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner_so uuid;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    -- consumir o supply_link e descobrir o dono atual
    SELECT sol.order_id INTO v_owner_so
      FROM sale_order_line_supply_links sl
      JOIN sale_order_lines sol ON sol.id = sl.sale_order_line_id
     WHERE sl.manufacturing_order_id = NEW.id AND sl.state='active' LIMIT 1;
    UPDATE sale_order_line_supply_links
      SET state='consumed', updated_at=now()
     WHERE manufacturing_order_id = NEW.id AND state='active';

    IF v_owner_so IS NOT NULL THEN
      BEGIN PERFORM so_run_operational_plan(v_owner_so,'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN PERFORM so_emit_timeline(v_owner_so,'manufacturing.done', NULL, NEW.id::text,
        jsonb_build_object('mo_id',NEW.id), 'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    ELSIF NEW.sale_order_id IS NOT NULL THEN
      BEGIN PERFORM so_run_operational_plan(NEW.sale_order_id,'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_zz_po_receipt_replan()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.kind='incoming' AND NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    -- replano via supply_links das needs cuja PO foi recebida
    FOR r IN
      SELECT DISTINCT sol.order_id AS so_id
      FROM stock_moves m
      JOIN purchase_needs pn ON pn.product_id = m.product_id AND pn.state IN ('po_created','partially_received','received')
      JOIN sale_order_line_supply_links sl ON sl.purchase_need_id = pn.id AND sl.state='active'
      JOIN sale_order_lines sol ON sol.id = sl.sale_order_line_id
      WHERE m.picking_id = NEW.id
    LOOP
      BEGIN PERFORM so_run_operational_plan(r.so_id,'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN PERFORM so_emit_timeline(r.so_id,'purchase.received', NULL, NEW.id::text,
        jsonb_build_object('picking_id',NEW.id), 'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

    -- fallback regressão F13: replano por purchase_needs.sale_order_id direto (se sem link)
    FOR r IN
      SELECT DISTINCT pn.sale_order_id AS so_id
      FROM purchase_needs pn
      WHERE pn.sale_order_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sale_order_line_supply_links sl WHERE sl.purchase_need_id=pn.id)
    LOOP
      BEGIN PERFORM so_run_operational_plan(r.so_id,'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
