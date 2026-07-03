
-- =========================================================================
-- PASSO 1 — confirm_sale_order sem criação inline de PO
-- =========================================================================
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o record; l record; wh uuid;
  v_picking_id uuid;
  use_chain boolean;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id=_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.state <> 'draft' AND o.state <> 'sent' THEN
    RAISE EXCEPTION 'Order must be draft/sent';
  END IF;

  PERFORM public.assert_so_has_lines(_order);
  PERFORM public.assert_lines_have_variant('sale_order_lines', _order);

  wh := COALESCE(o.warehouse_id, public.default_warehouse_id());
  use_chain := COALESCE(o.delivery_mode,'delivery') IN ('delivery','pickup');

  IF use_chain THEN
    v_picking_id := public.create_outgoing_chain(_order);
    FOR l IN
      SELECT sm.* FROM public.stock_moves sm
      JOIN public.stock_pickings sp ON sp.id=sm.picking_id
      WHERE sp.origin=o.name AND sp.kind='outgoing'
        AND sm.source_location_id = public.default_location(wh,'Stock')
    LOOP
      PERFORM public.reserve_for_move(l.id);
    END LOOP;
  END IF;

  UPDATE public.sale_orders SET state='confirmed' WHERE id=_order;
  PERFORM public.log_record_event('sale_order',_order,'Pedido confirmado','{}'::jsonb);
  IF o.salesperson_id IS NOT NULL THEN
    PERFORM public.notify_user(o.salesperson_id,'sales','so_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (SELECT name FROM public.partners WHERE id=o.partner_id)),
      '/sales/orders');
  END IF;
END $function$;

-- =========================================================================
-- PASSO 2 — remover triggers legados (funções ficam órfãs no schema)
-- =========================================================================
DROP TRIGGER IF EXISTS trg_so_confirm_mo ON public.sale_orders;
DROP TRIGGER IF EXISTS trg_so_confirm_purchase_needs ON public.sale_orders;

-- =========================================================================
-- PASSO 3 — guarda anti-duplicação em create_purchase_need
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_need(
  _product uuid,
  _qty numeric,
  _origin purchase_need_origin,
  _sale uuid DEFAULT NULL::uuid,
  _mo uuid DEFAULT NULL::uuid,
  _needed_by date DEFAULT NULL::date,
  _notes text DEFAULT NULL::text,
  _variant uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid; _supplier uuid; _po_name text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  -- Guarda anti-duplicação: PO em curso para a mesma venda+produto+variante
  IF _sale IS NOT NULL THEN
    SELECT po.name INTO _po_name
      FROM public.purchase_order_lines pol
      JOIN public.purchase_orders po ON po.id = pol.order_id
     WHERE pol.source_sale_order_id = _sale
       AND pol.product_id = _product
       AND COALESCE(pol.variant_id::text,'') = COALESCE(_variant::text,'')
       AND po.state NOT IN ('cancelled','done')
     ORDER BY po.created_at DESC
     LIMIT 1;
    IF _po_name IS NOT NULL THEN
      BEGIN
        PERFORM public.log_record_event('sale_order', _sale,
          format('supply já em curso via PO %s', _po_name),
          jsonb_build_object('product_id',_product,'variant_id',_variant,'po_name',_po_name));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      RETURN NULL;
    END IF;
  END IF;

  -- Dedupe existente: needs já pendentes para o mesmo contexto
  SELECT id INTO _id FROM public.purchase_needs
   WHERE product_id = _product
     AND COALESCE(product_variant_id::text,'') = COALESCE(_variant::text,'')
     AND origin_kind = _origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(_sale::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(_mo::text,'')
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  SELECT partner_id INTO _supplier FROM public.product_suppliers
    WHERE product_id = _product ORDER BY priority NULLS LAST LIMIT 1;

  INSERT INTO public.purchase_needs(product_id, product_variant_id, qty_needed, origin_kind,
       sale_order_id, manufacturing_order_id, suggested_partner_id, needed_by, notes)
  VALUES (_product, _variant, _qty, _origin, _sale, _mo, _supplier, _needed_by, _notes)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;

-- =========================================================================
-- so_run_operational_plan — notificação delta-based ao salesperson
-- =========================================================================
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
  v_needs_before int := 0;
  v_needs_after  int := 0;
  v_needs_delta  int := 0;
BEGIN
  SELECT * INTO v_so FROM sale_orders WHERE id=_order_id FOR UPDATE;
  IF v_so.id IS NULL THEN RETURN jsonb_build_object('error','sale_order_not_found'); END IF;
  IF v_so.state <> 'confirmed' THEN
    RETURN jsonb_build_object('skipped','sale_not_confirmed','state',v_so.state::text);
  END IF;

  v_is_inherit := (_mode = 'inherit') OR COALESCE(v_so.is_deferred,false);

  IF v_so.last_planned_at IS NOT NULL
     AND v_so.last_planned_at > now() - interval '2 seconds'
     AND _mode IN ('auto','replan') THEN
    RETURN jsonb_build_object('skipped','replan_throttled');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_order_id::text));

  SELECT count(*) INTO v_needs_before
    FROM purchase_needs
   WHERE sale_order_id = _order_id
     AND state IN ('pending','quoting','approved');

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
                       'auto by so_run_operational_plan', v_line.variant_id);
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

  -- Notificação delta-based: só se o planeamento criou needs NOVAS
  SELECT count(*) INTO v_needs_after
    FROM purchase_needs
   WHERE sale_order_id = _order_id
     AND state IN ('pending','quoting','approved');
  v_needs_delta := v_needs_after - v_needs_before;
  IF v_needs_delta > 0 AND v_so.salesperson_id IS NOT NULL THEN
    BEGIN
      PERFORM public.notify_user(v_so.salesperson_id, 'sales'::app_module, 'purchase_need',
        'Necessidades de compra geradas',
        format('Venda %s gerou %s necessidade(s) de compra.', v_so.name, v_needs_delta),
        '/sales/orders/' || _order_id::text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok',true,'inherit',v_is_inherit,'counts',v_counts,'eta',v_max_eta,'lines',v_lines_summary,
                            'needs_delta', v_needs_delta);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO sale_operational_plan_log(sale_order_id, mode, error, duration_ms, summary)
  VALUES (_order_id, _mode, SQLERRM,
          (extract(epoch from clock_timestamp() - v_started)*1000)::int,
          jsonb_build_object('failed_at','exception'));
  RAISE;
END $function$;

-- =========================================================================
-- PASSO 5 — teste de regressão _test_supply_canonical_path
-- =========================================================================
CREATE OR REPLACE FUNCTION public._test_supply_canonical_path()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_partner uuid; v_supplier uuid; v_product uuid; v_variant uuid;
  v_wh uuid; v_uom uuid;
  v_so uuid; v_sol uuid;
  v_po_direct_count int;
  v_needs_count int;
  v_need_id uuid;
  v_po uuid; v_pol uuid;
  v_plan1 jsonb; v_plan2 jsonb; v_plan3 jsonb;
  v_results jsonb := '[]'::jsonb;
  v_tag text := 'TEST_SUPPLY_CANON_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_line_status text;
BEGIN
  -- Setup: warehouse, uom, cliente, fornecedor, produto comprável (sem BOM)
  SELECT id INTO v_wh FROM warehouses ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'no warehouse available'; END IF;

  SELECT id INTO v_uom FROM product_uom ORDER BY id LIMIT 1;

  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI', true) RETURNING id INTO v_partner;
  INSERT INTO partners(name, is_supplier) VALUES (v_tag||' SUP', true) RETURNING id INTO v_supplier;

  INSERT INTO products(name, type, can_be_sold, can_be_purchased, can_be_manufactured, uom_id, supply_route)
  VALUES (v_tag||' PROD','storable',true,true,false,v_uom,'buy'::product_supply_route)
  RETURNING id INTO v_product;

  INSERT INTO product_suppliers(product_id, partner_id, priority, lead_time_days)
  VALUES (v_product, v_supplier, 1, 5);

  -- (a) SO com produto comprável sem stock → confirmar
  INSERT INTO sale_orders(name, partner_id, warehouse_id, state, salesperson_id)
  VALUES (v_tag, v_partner, v_wh, 'draft', NULL)
  RETURNING id INTO v_so;

  INSERT INTO sale_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_uom, 3, 10, 30, 'product')
  RETURNING id INTO v_sol;

  PERFORM confirm_sale_order(v_so);
  -- trigger tg_zz_so_run_plan_on_confirm chama o planner automaticamente

  -- Assert (a): NÃO deve existir PO criado inline
  SELECT count(*) INTO v_po_direct_count
    FROM purchase_order_lines pol
   WHERE pol.source_sale_order_id = v_so;
  IF v_po_direct_count <> 0 THEN
    RAISE EXCEPTION 'FAIL (a): PO inline criado (% linhas)', v_po_direct_count;
  END IF;

  SELECT count(*) INTO v_needs_count
    FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN
    RAISE EXCEPTION 'FAIL (a): esperado 1 need, obtido %', v_needs_count;
  END IF;
  v_results := v_results || jsonb_build_object('a_confirm_ok',true,'po_inline',v_po_direct_count,'needs',v_needs_count);

  -- (b) Replan → idempotente (continua 1 need)
  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan2 := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count
    FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 1 THEN
    RAISE EXCEPTION 'FAIL (b): replan duplicou needs (agora %)', v_needs_count;
  END IF;
  v_results := v_results || jsonb_build_object('b_replan_idempotent',true,'needs',v_needs_count);

  -- (c) Converter need em PO e replanear → guarda evita nova need
  SELECT id INTO v_need_id FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved') LIMIT 1;

  INSERT INTO purchase_orders(name, state, partner_id, warehouse_id, expected_date, origin)
  VALUES (v_tag||'-PO', 'draft', v_supplier, v_wh, CURRENT_DATE + 5, v_tag)
  RETURNING id INTO v_po;

  INSERT INTO purchase_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, source_sale_order_id)
  VALUES (v_po, v_product, v_uom, 3, 10, 30, v_so)
  RETURNING id INTO v_pol;

  UPDATE purchase_needs SET state='po_created', purchase_order_id=v_po WHERE id=v_need_id;
  UPDATE purchase_orders SET state='confirmed' WHERE id=v_po;

  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan3 := so_run_operational_plan(v_so, 'replan');
  SELECT count(*) INTO v_needs_count
    FROM purchase_needs
   WHERE sale_order_id = v_so AND state IN ('pending','quoting','approved');
  IF v_needs_count <> 0 THEN
    RAISE EXCEPTION 'FAIL (c): guarda falhou, nova need criada com PO em curso (needs pending=%)', v_needs_count;
  END IF;
  v_results := v_results || jsonb_build_object('c_guard_ok',true,'pending_needs',v_needs_count);

  -- (d) Marcar PO como done (simula recepção) e replanear
  --      Sem stock físico injetado, qty_reserved fica 0 mas a guarda continua a evitar novas needs.
  UPDATE purchase_orders SET state='done' WHERE id=v_po;
  UPDATE purchase_needs SET state='received' WHERE id=v_need_id;

  UPDATE sale_orders SET last_planned_at = now() - interval '10 seconds' WHERE id = v_so;
  v_plan3 := so_run_operational_plan(v_so, 'replan');
  SELECT operational_status INTO v_line_status FROM sale_order_lines WHERE id = v_sol;
  v_results := v_results || jsonb_build_object('d_after_receipt',true,'line_status',v_line_status,'plan',v_plan3);

  -- Cleanup
  DELETE FROM purchase_order_lines WHERE order_id = v_po;
  DELETE FROM purchase_orders WHERE id = v_po;
  DELETE FROM purchase_needs WHERE sale_order_id = v_so;
  DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so;
  DELETE FROM sale_order_timeline WHERE sale_order_id = v_so;
  DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so));
  DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so);
  DELETE FROM sale_order_lines WHERE order_id = v_so;
  DELETE FROM sale_orders WHERE id = v_so;
  DELETE FROM product_suppliers WHERE product_id = v_product;
  DELETE FROM products WHERE id = v_product;
  DELETE FROM partners WHERE id IN (v_partner, v_supplier);

  RETURN jsonb_build_object('ok', true, 'steps', v_results);

EXCEPTION WHEN OTHERS THEN
  -- Best-effort cleanup
  BEGIN DELETE FROM purchase_order_lines WHERE source_sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_orders WHERE id = v_po; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_needs WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_operational_plan_log WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_timeline WHERE sale_order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so)); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_pickings WHERE origin = (SELECT name FROM sale_orders WHERE id=v_so); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_lines WHERE order_id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_orders WHERE id = v_so; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_suppliers WHERE product_id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM products WHERE id = v_product; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM partners WHERE id IN (v_partner, v_supplier); EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END $function$;
