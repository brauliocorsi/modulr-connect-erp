-- =====================================================================
-- PHASE 13 — Motor Operacional Automático
-- =====================================================================

ALTER TABLE public.sale_order_lines
  ADD COLUMN IF NOT EXISTS operational_status text,
  ADD COLUMN IF NOT EXISTS qty_reserved numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_to_purchase numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_to_manufacture numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_availability_date date,
  ADD COLUMN IF NOT EXISTS availability_source text,
  ADD COLUMN IF NOT EXISTS confidence_level text,
  ADD COLUMN IF NOT EXISTS last_planned_at timestamptz;

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS operational_status text,
  ADD COLUMN IF NOT EXISTS expected_ready_date date,
  ADD COLUMN IF NOT EXISTS last_planned_at timestamptz;

ALTER TABLE public.manufacturing_orders
  ADD COLUMN IF NOT EXISTS expected_finish_date date;

CREATE TABLE IF NOT EXISTS public.sale_order_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  sale_order_line_id uuid REFERENCES sale_order_lines(id) ON DELETE CASCADE,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'done',
  ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_sot_so ON sale_order_timeline(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_sot_step ON sale_order_timeline(step);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sot_dedup
  ON sale_order_timeline(sale_order_id, step,
                         COALESCE(sale_order_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
                         COALESCE(ref,''));

ALTER TABLE public.sale_order_timeline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sot_view ON public.sale_order_timeline;
CREATE POLICY sot_view ON public.sale_order_timeline FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'sales'::app_module,'orders'::text,'view'::permission_action));
DROP POLICY IF EXISTS sot_admin ON public.sale_order_timeline;
CREATE POLICY sot_admin ON public.sale_order_timeline FOR ALL TO authenticated
  USING (has_group(auth.uid(),'system_admin'::text))
  WITH CHECK (has_group(auth.uid(),'system_admin'::text));

CREATE TABLE IF NOT EXISTS public.sale_operational_plan_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  error text
);
CREATE INDEX IF NOT EXISTS idx_sopl_so ON sale_operational_plan_log(sale_order_id, run_at DESC);
ALTER TABLE public.sale_operational_plan_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sopl_admin ON public.sale_operational_plan_log;
CREATE POLICY sopl_admin ON public.sale_operational_plan_log FOR ALL TO authenticated
  USING (has_group(auth.uid(),'system_admin'::text))
  WITH CHECK (has_group(auth.uid(),'system_admin'::text));

CREATE UNIQUE INDEX IF NOT EXISTS uq_mo_active_per_so_line
  ON manufacturing_orders(sale_order_line_id)
  WHERE sale_order_line_id IS NOT NULL AND state NOT IN ('cancelled','done');

-- ----- Helpers -----

CREATE OR REPLACE FUNCTION public.so_product_available_now(_product uuid, _warehouse uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(GREATEST(q.quantity - q.reserved_quantity, 0)), 0)::numeric
  FROM stock_quants q
  JOIN stock_locations l ON l.id = q.location_id
  WHERE q.product_id = _product
    AND l.type = 'internal'
    AND (_warehouse IS NULL OR l.warehouse_id = _warehouse);
$$;

CREATE OR REPLACE FUNCTION public.so_product_incoming_qty(_product uuid, _warehouse uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(GREATEST(sm.quantity - sm.quantity_done, 0)), 0)::numeric
  FROM stock_moves sm
  JOIN stock_pickings p ON p.id = sm.picking_id
  WHERE sm.product_id = _product
    AND p.kind = 'incoming'
    AND p.state NOT IN ('done','cancelled')
    AND (_warehouse IS NULL OR p.warehouse_id = _warehouse);
$$;

CREATE OR REPLACE FUNCTION public.so_product_in_production_qty(_product uuid, _warehouse uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(SUM(mo.qty), 0)::numeric
  FROM manufacturing_orders mo
  WHERE mo.product_id = _product
    AND mo.state IN ('draft','waiting_material','ready','in_progress','paused','qc')
    AND (_warehouse IS NULL OR mo.warehouse_id = _warehouse);
$$;

CREATE OR REPLACE FUNCTION public.so_classify_line(_line_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_line sale_order_lines%ROWTYPE;
  v_so sale_orders%ROWTYPE;
  v_prod products%ROWTYPE;
  v_avail numeric := 0; v_incoming numeric := 0; v_inprod numeric := 0;
  v_qty_ready numeric := 0; v_qty_miss numeric := 0;
  v_class text; v_has_bom boolean := false;
BEGIN
  SELECT * INTO v_line FROM sale_order_lines WHERE id=_line_id;
  IF v_line.id IS NULL OR v_line.line_kind <> 'product' OR v_line.product_id IS NULL THEN
    RETURN jsonb_build_object('classification','non_stock','qty_ready',0,'qty_missing',0);
  END IF;
  SELECT * INTO v_so FROM sale_orders WHERE id=v_line.order_id;
  SELECT * INTO v_prod FROM products WHERE id=v_line.product_id;

  v_avail    := so_product_available_now(v_prod.id, v_so.warehouse_id);
  v_incoming := so_product_incoming_qty(v_prod.id, v_so.warehouse_id);
  v_inprod   := so_product_in_production_qty(v_prod.id, v_so.warehouse_id);

  v_qty_ready := LEAST(v_avail, v_line.quantity);
  v_qty_miss  := GREATEST(v_line.quantity - v_qty_ready, 0);

  SELECT EXISTS(SELECT 1 FROM boms WHERE product_id=v_prod.id AND active) INTO v_has_bom;

  IF v_qty_miss = 0 THEN v_class := 'ready_stock';
  ELSIF v_qty_ready > 0 THEN v_class := 'partially_reserved';
  ELSIF v_prod.can_be_manufactured AND v_has_bom THEN v_class := 'manufacturing_required';
  ELSIF v_prod.can_be_purchased THEN v_class := 'purchase_required';
  ELSE v_class := 'backorder';
  END IF;

  RETURN jsonb_build_object(
    'line_id', v_line.id, 'product_id', v_prod.id, 'quantity', v_line.quantity,
    'available_now', v_avail, 'incoming_qty', v_incoming, 'in_production_qty', v_inprod,
    'qty_ready', v_qty_ready, 'qty_missing', v_qty_miss, 'classification', v_class,
    'product_can_be_purchased', v_prod.can_be_purchased,
    'product_can_be_manufactured', v_prod.can_be_manufactured,
    'has_active_bom', v_has_bom);
END $$;

CREATE OR REPLACE FUNCTION public.so_emit_timeline(
  _so uuid, _step text, _line uuid, _ref text, _payload jsonb, _source text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO sale_order_timeline(sale_order_id, sale_order_line_id, step, ref, payload, source)
  VALUES (_so, _line, _step, _ref, COALESCE(_payload,'{}'::jsonb), _source)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.so_rollup_operational_status(_so uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_total int; v_delivered int; v_ready int; v_partial int;
  v_wp int; v_wm int; v_wc int; v_bo int; v_status text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE line_kind='product'),
    COUNT(*) FILTER (WHERE operational_status='delivered'),
    COUNT(*) FILTER (WHERE operational_status='ready_stock'),
    COUNT(*) FILTER (WHERE operational_status='partially_reserved'),
    COUNT(*) FILTER (WHERE operational_status='waiting_purchase'),
    COUNT(*) FILTER (WHERE operational_status='waiting_manufacturing'),
    COUNT(*) FILTER (WHERE operational_status='waiting_components'),
    COUNT(*) FILTER (WHERE operational_status='backorder')
    INTO v_total, v_delivered, v_ready, v_partial, v_wp, v_wm, v_wc, v_bo
  FROM sale_order_lines WHERE order_id=_so;

  IF v_total = 0 THEN RETURN 'reserved'; END IF;
  IF v_delivered = v_total THEN v_status := 'completed';
  ELSIF v_wc > 0 THEN v_status := 'waiting_components';
  ELSIF v_wm > 0 THEN v_status := 'waiting_manufacturing';
  ELSIF v_wp > 0 THEN v_status := 'waiting_purchase';
  ELSIF v_partial > 0 THEN v_status := 'partially_reserved';
  ELSIF v_bo > 0 THEN v_status := 'waiting_stock';
  ELSIF v_ready = v_total THEN v_status := 'ready_delivery';
  ELSE v_status := 'partially_reserved';
  END IF;
  RETURN v_status;
END $$;

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
   WHERE origin = v_so.name AND kind='outgoing' AND state IN ('draft','assigned')
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
     AND state IN ('assigned','draft');
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
     AND state IN ('assigned','draft');
  RETURN v_already;
END $$;

CREATE OR REPLACE FUNCTION public._so_ensure_mo_for_line(_line_id uuid, _qty numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_line sale_order_lines%ROWTYPE; v_so sale_orders%ROWTYPE;
  v_mo uuid; v_bom uuid; v_code text;
BEGIN
  IF _qty <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_line FROM sale_order_lines WHERE id=_line_id;
  SELECT * INTO v_so FROM sale_orders WHERE id=v_line.order_id;
  SELECT id INTO v_bom FROM boms WHERE product_id=v_line.product_id AND active LIMIT 1;
  IF v_bom IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_mo FROM manufacturing_orders
   WHERE sale_order_line_id=_line_id AND state NOT IN ('cancelled','done') LIMIT 1;
  IF v_mo IS NOT NULL THEN RETURN v_mo; END IF;

  v_code := 'MO/'||v_so.name||'/'||substr(_line_id::text,1,8);
  INSERT INTO manufacturing_orders(code, sale_order_id, sale_order_line_id, partner_id,
                                   product_id, bom_id, qty, state, warehouse_id,
                                   origin, due_date)
  VALUES (v_code, v_so.id, _line_id, v_so.partner_id,
          v_line.product_id, v_bom, _qty, 'draft', v_so.warehouse_id,
          'sale', v_so.commitment_date)
  RETURNING id INTO v_mo;

  INSERT INTO purchase_needs(product_id, qty_needed, origin_kind, sale_order_id,
                             manufacturing_order_id, suggested_partner_id, needed_by)
  SELECT bl.component_product_id,
         (bl.quantity * _qty) - so_product_available_now(bl.component_product_id, v_so.warehouse_id),
         'manufacturing', NULL, v_mo,
         (SELECT partner_id FROM product_suppliers WHERE product_id=bl.component_product_id
            ORDER BY priority NULLS LAST LIMIT 1),
         COALESCE(v_so.commitment_date, (CURRENT_DATE + COALESCE(
              (SELECT lead_time_days FROM product_suppliers WHERE product_id=bl.component_product_id
                 ORDER BY priority NULLS LAST LIMIT 1), 7)))
  FROM bom_lines bl
  WHERE bl.bom_id = v_bom
    AND (bl.quantity * _qty) > so_product_available_now(bl.component_product_id, v_so.warehouse_id)
    AND NOT EXISTS (
      SELECT 1 FROM purchase_needs pn
      WHERE pn.manufacturing_order_id = v_mo
        AND pn.product_id = bl.component_product_id
        AND pn.state IN ('pending','quoting','approved')
    );
  RETURN v_mo;
END $$;

CREATE OR REPLACE FUNCTION public.so_run_operational_plan(_order_id uuid, _mode text DEFAULT 'auto')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_line RECORD;
  v_class jsonb; v_classification text;
  v_qty_ready numeric; v_qty_miss numeric;
  v_reserved numeric;
  v_need_id uuid; v_mo_id uuid;
  v_lead int;
  v_eta date; v_src text; v_conf text;
  v_status text;
  v_lines_summary jsonb := '[]'::jsonb;
  v_started timestamptz := clock_timestamp();
  v_counts jsonb := jsonb_build_object('reserved',0,'needs',0,'mos',0);
  v_max_eta date;
BEGIN
  SELECT * INTO v_so FROM sale_orders WHERE id=_order_id FOR UPDATE;
  IF v_so.id IS NULL THEN RETURN jsonb_build_object('error','sale_order_not_found'); END IF;
  IF v_so.state <> 'confirmed' THEN
    RETURN jsonb_build_object('skipped','sale_not_confirmed','state',v_so.state::text);
  END IF;

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
          PERFORM so_emit_timeline(_order_id,'purchase.planned', v_line.id,
                                   v_need_id::text, jsonb_build_object('qty',v_qty_miss,'lead',v_lead), _mode);
        END IF;
      END IF;
    END IF;

    IF v_qty_miss = 0 THEN
      v_eta := CURRENT_DATE; v_src := 'stock'; v_conf := 'high';
    ELSIF v_mo_id IS NOT NULL THEN
      SELECT CURRENT_DATE + COALESCE(mfg_lead_time_days, 7)
        INTO v_eta FROM products WHERE id=v_line.product_id;
      v_src := 'manufacturing'; v_conf := 'medium';
      IF EXISTS(SELECT 1 FROM purchase_needs WHERE manufacturing_order_id=v_mo_id
                  AND state IN ('pending','quoting','approved','po_created','partially_received')) THEN
        v_conf := 'low';
        v_eta := v_eta + COALESCE(
          (SELECT MAX(COALESCE(ps.lead_time_days, p.purchase_lead_time_days, 7))
             FROM purchase_needs pn
             JOIN products p ON p.id=pn.product_id
             LEFT JOIN LATERAL (SELECT lead_time_days FROM product_suppliers
                                 WHERE product_id=p.id ORDER BY priority NULLS LAST LIMIT 1) ps ON true
            WHERE pn.manufacturing_order_id=v_mo_id), 7);
      END IF;
      UPDATE manufacturing_orders SET expected_finish_date=v_eta WHERE id=v_mo_id;
    ELSIF v_need_id IS NOT NULL THEN
      v_eta := CURRENT_DATE + COALESCE(v_lead,7); v_src := 'incoming_purchase'; v_conf := 'medium';
    ELSE
      v_eta := NULL; v_src := 'backorder'; v_conf := 'low';
    END IF;
    IF v_qty_ready > 0 AND v_qty_miss > 0 THEN v_src := 'mixed'; END IF;

    IF v_qty_miss = 0 THEN v_status := 'ready_stock';
    ELSIF v_qty_ready > 0 THEN v_status := 'partially_reserved';
    ELSIF v_mo_id IS NOT NULL THEN
      v_status := CASE WHEN v_conf='low' THEN 'waiting_components' ELSE 'waiting_manufacturing' END;
    ELSIF v_need_id IS NOT NULL THEN v_status := 'waiting_purchase';
    ELSE v_status := 'backorder';
    END IF;

    UPDATE sale_order_lines
       SET qty_reserved = v_reserved,
           qty_to_purchase = CASE WHEN v_need_id IS NOT NULL THEN v_qty_miss ELSE 0 END,
           qty_to_manufacture = CASE WHEN v_mo_id IS NOT NULL THEN v_qty_miss ELSE 0 END,
           operational_status = v_status,
           expected_availability_date = v_eta,
           availability_source = v_src,
           confidence_level = v_conf,
           last_planned_at = now()
     WHERE id = v_line.id;

    v_lines_summary := v_lines_summary || jsonb_build_object(
      'line_id', v_line.id, 'classification', v_classification, 'qty_ready', v_qty_ready,
      'qty_missing', v_qty_miss, 'status', v_status, 'eta', v_eta,
      'source', v_src, 'confidence', v_conf,
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
            jsonb_build_object('mode',_mode,'counts',v_counts), _mode);

  INSERT INTO sale_operational_plan_log(sale_order_id, mode, summary, duration_ms)
  VALUES (_order_id, _mode,
          jsonb_build_object('counts',v_counts,'lines',v_lines_summary,'eta',v_max_eta),
          (extract(epoch from clock_timestamp() - v_started)*1000)::int);

  RETURN jsonb_build_object('ok',true,'counts',v_counts,'eta',v_max_eta,'lines',v_lines_summary);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO sale_operational_plan_log(sale_order_id, mode, error,
          duration_ms, summary)
  VALUES (_order_id, _mode, SQLERRM,
          (extract(epoch from clock_timestamp() - v_started)*1000)::int,
          jsonb_build_object('failed_at','exception'));
  RAISE;
END $$;

-- ----- Triggers -----
CREATE OR REPLACE FUNCTION public.tg_zz_so_run_plan_on_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.state = 'confirmed' AND COALESCE(OLD.state::text,'') <> 'confirmed' THEN
    BEGIN PERFORM so_run_operational_plan(NEW.id, 'auto');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'so_run_operational_plan failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_zz_so_run_plan_on_confirm ON public.sale_orders;
CREATE TRIGGER tg_zz_so_run_plan_on_confirm
  AFTER UPDATE OF state ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION tg_zz_so_run_plan_on_confirm();

CREATE OR REPLACE FUNCTION public.tg_zz_po_receipt_replan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.kind='incoming' AND NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    FOR r IN
      SELECT DISTINCT pn.sale_order_id
      FROM purchase_needs pn
      WHERE pn.sale_order_id IS NOT NULL
    LOOP
      BEGIN PERFORM so_run_operational_plan(r.sale_order_id,'replan');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_zz_po_receipt_replan ON public.stock_pickings;
CREATE TRIGGER tg_zz_po_receipt_replan
  AFTER UPDATE OF state ON public.stock_pickings
  FOR EACH ROW EXECUTE FUNCTION tg_zz_po_receipt_replan();

CREATE OR REPLACE FUNCTION public.tg_zz_mo_done_replan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' AND NEW.sale_order_id IS NOT NULL THEN
    BEGIN PERFORM so_run_operational_plan(NEW.sale_order_id,'replan');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_zz_mo_done_replan ON public.manufacturing_orders;
CREATE TRIGGER tg_zz_mo_done_replan
  AFTER UPDATE OF state ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION tg_zz_mo_done_replan();