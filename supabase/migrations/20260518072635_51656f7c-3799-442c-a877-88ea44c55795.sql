
-- ============================================================
-- F18-B :: RPCs + reservation trigger
-- ============================================================

-- helper: log to sale_order_timeline if SO present (dedup by ref+step)
CREATE OR REPLACE FUNCTION public._service_log(
  _case_id uuid, _step text, _ref text, _payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_so uuid;
BEGIN
  SELECT sale_order_id INTO v_so FROM public.service_cases WHERE id=_case_id;
  IF v_so IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.sale_order_timeline
              WHERE sale_order_id=v_so AND step=_step AND ref=_ref) THEN
    RETURN;
  END IF;
  INSERT INTO public.sale_order_timeline(sale_order_id, step, status, ref, payload, source, occurred_at, created_by)
  VALUES (v_so, _step, 'ok', _ref, COALESCE(_payload,'{}'::jsonb), 'service', now(), auth.uid());
END $$;

-- ----- service_case_create(_payload jsonb) -----
CREATE OR REPLACE FUNCTION public.service_case_create(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_so uuid := NULLIF(_payload->>'sale_order_id','')::uuid;
  v_customer uuid := NULLIF(_payload->>'customer_id','')::uuid;
BEGIN
  IF v_so IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sale_orders WHERE id=v_so) THEN
    RAISE EXCEPTION 'service_case_create: sale_order_not_found %', v_so;
  END IF;
  IF v_customer IS NULL AND v_so IS NOT NULL THEN
    SELECT partner_id INTO v_customer FROM public.sale_orders WHERE id=v_so;
  END IF;

  INSERT INTO public.service_cases(
    case_number, customer_id, sale_order_id, sale_order_line_id,
    delivery_schedule_id, delivery_route_order_id, stock_package_id,
    product_id, product_variant_id,
    case_type, source, priority, status, responsibility, warranty_status,
    description, customer_notes, internal_notes, reported_by, assigned_to
  ) VALUES (
    public.next_service_case_number(),
    v_customer, v_so, NULLIF(_payload->>'sale_order_line_id','')::uuid,
    NULLIF(_payload->>'delivery_schedule_id','')::uuid,
    NULLIF(_payload->>'delivery_route_order_id','')::uuid,
    NULLIF(_payload->>'stock_package_id','')::uuid,
    NULLIF(_payload->>'product_id','')::uuid,
    NULLIF(_payload->>'product_variant_id','')::uuid,
    COALESCE((_payload->>'case_type')::public.service_case_type,'other'),
    COALESCE((_payload->>'source')::public.service_case_source,'internal'),
    COALESCE((_payload->>'priority')::public.service_case_priority,'normal'),
    'new'::public.service_case_status,
    COALESCE((_payload->>'responsibility')::public.service_case_responsibility,'unknown'),
    COALESCE((_payload->>'warranty_status')::public.service_case_warranty_status,'unknown'),
    _payload->>'description', _payload->>'customer_notes', _payload->>'internal_notes',
    COALESCE(NULLIF(_payload->>'reported_by','')::uuid, auth.uid()),
    NULLIF(_payload->>'assigned_to','')::uuid
  ) RETURNING id INTO v_id;

  PERFORM public._service_log(v_id, 'service.case.created', v_id::text,
    jsonb_build_object('case_type',_payload->>'case_type','source',_payload->>'source'));
  RETURN v_id;
END $$;

-- ----- service_case_add_item -----
CREATE OR REPLACE FUNCTION public.service_case_add_item(_case_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_sol uuid; v_pkg uuid; v_so uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.service_cases WHERE id=_case_id) THEN
    RAISE EXCEPTION 'service_case_add_item: case_not_found %', _case_id;
  END IF;
  v_sol := NULLIF(_payload->>'sale_order_line_id','')::uuid;
  v_pkg := NULLIF(_payload->>'stock_package_id','')::uuid;
  IF v_sol IS NOT NULL THEN
    SELECT sale_order_id INTO v_so FROM public.service_cases WHERE id=_case_id;
    IF v_so IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.sale_order_lines WHERE id=v_sol AND order_id=v_so) THEN
      RAISE EXCEPTION 'service_case_add_item: sale_order_line_not_in_case_so';
    END IF;
  END IF;
  IF v_pkg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stock_packages WHERE id=v_pkg) THEN
    RAISE EXCEPTION 'service_case_add_item: stock_package_not_found %', v_pkg;
  END IF;

  INSERT INTO public.service_case_items(
    service_case_id, product_id, product_variant_id, stock_package_id, sale_order_line_id,
    issue_type, required_action, qty, status, notes)
  VALUES (
    _case_id,
    NULLIF(_payload->>'product_id','')::uuid,
    NULLIF(_payload->>'product_variant_id','')::uuid,
    v_pkg, v_sol,
    COALESCE((_payload->>'issue_type')::public.service_case_item_issue_type,'other'),
    NULLIF(_payload->>'required_action','')::public.service_case_item_action,
    COALESCE((_payload->>'qty')::numeric, 1),
    'open'::public.service_case_item_status,
    _payload->>'notes'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ----- service_case_add_attachment_metadata -----
CREATE OR REPLACE FUNCTION public.service_case_add_attachment_metadata(_case_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.service_cases WHERE id=_case_id) THEN
    RAISE EXCEPTION 'service_case_add_attachment: case_not_found %', _case_id;
  END IF;
  INSERT INTO public.service_case_attachments(
    service_case_id, file_url, file_name, file_type, attachment_type, uploaded_by)
  VALUES (
    _case_id, _payload->>'file_url', _payload->>'file_name', _payload->>'file_type',
    COALESCE((_payload->>'attachment_type')::public.service_case_attachment_type,'other'),
    COALESCE(NULLIF(_payload->>'uploaded_by','')::uuid, auth.uid())
  ) RETURNING id INTO v_id;
  PERFORM public._service_log(_case_id, 'service.attachment.added', v_id::text,
    jsonb_build_object('attachment_type',_payload->>'attachment_type'));
  RETURN v_id;
END $$;

-- ----- service_case_triage -----
CREATE OR REPLACE FUNCTION public.service_case_triage(_case_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next public.service_case_status; v_action public.service_case_item_action;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.service_cases WHERE id=_case_id) THEN
    RAISE EXCEPTION 'service_case_triage: case_not_found %', _case_id;
  END IF;

  v_action := NULLIF(_payload->>'default_required_action','')::public.service_case_item_action;
  v_next := COALESCE((_payload->>'next_status')::public.service_case_status, 'triage');

  UPDATE public.service_cases
     SET priority = COALESCE((_payload->>'priority')::public.service_case_priority, priority),
         responsibility = COALESCE((_payload->>'responsibility')::public.service_case_responsibility, responsibility),
         warranty_status = COALESCE((_payload->>'warranty_status')::public.service_case_warranty_status, warranty_status),
         assigned_to = COALESCE(NULLIF(_payload->>'assigned_to','')::uuid, assigned_to),
         internal_notes = COALESCE(_payload->>'internal_notes', internal_notes),
         status = v_next
   WHERE id=_case_id;

  IF v_action IS NOT NULL THEN
    UPDATE public.service_case_items
       SET required_action = v_action
     WHERE service_case_id=_case_id AND required_action IS NULL;
  END IF;

  PERFORM public._service_log(_case_id, 'service.case.triaged', _case_id::text,
    jsonb_build_object('next_status',v_next,'default_action',v_action));
  RETURN jsonb_build_object('ok', true, 'status', v_next);
END $$;

-- ----- service_case_create_purchase_need -----
CREATE OR REPLACE FUNCTION public.service_case_create_purchase_need(_case_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record; v_need uuid; v_supplier uuid;
BEGIN
  SELECT sci.*, sc.sale_order_id AS so_id INTO v_item
    FROM public.service_case_items sci
    JOIN public.service_cases sc ON sc.id=sci.service_case_id
   WHERE sci.id=_case_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'service_case_create_purchase_need: item_not_found %', _case_item_id;
  END IF;
  IF v_item.product_id IS NULL THEN
    RAISE EXCEPTION 'service_case_create_purchase_need: item_has_no_product';
  END IF;

  -- idempotency: existing live need for this item
  SELECT id INTO v_need FROM public.purchase_needs
   WHERE service_case_item_id = _case_item_id
     AND state NOT IN ('cancelled','received')
   LIMIT 1;
  IF v_need IS NOT NULL THEN RETURN v_need; END IF;

  SELECT partner_id INTO v_supplier FROM public.product_suppliers
   WHERE product_id=v_item.product_id ORDER BY priority NULLS LAST LIMIT 1;

  INSERT INTO public.purchase_needs(
    product_id, product_variant_id, qty_needed, origin_kind,
    sale_order_id, suggested_partner_id, service_case_id, service_case_item_id,
    notes, purpose)
  VALUES (
    v_item.product_id, v_item.product_variant_id, v_item.qty,
    'service_case'::public.purchase_need_origin,
    v_item.so_id, v_supplier, v_item.service_case_id, _case_item_id,
    'service_case', 'service_case')
  RETURNING id INTO v_need;

  UPDATE public.service_case_items SET status='waiting_part' WHERE id=_case_item_id;
  UPDATE public.service_cases SET status='waiting_parts'
   WHERE id=v_item.service_case_id AND status NOT IN ('done','cancelled');

  INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, linked_purchase_need_id)
  VALUES (v_item.service_case_id, _case_item_id, 'buy_part', v_need);

  PERFORM public._service_log(v_item.service_case_id, 'service.part.purchase_needed', v_need::text,
    jsonb_build_object('product_id',v_item.product_id,'variant_id',v_item.product_variant_id,'qty',v_item.qty));
  RETURN v_need;
END $$;

-- ----- service_case_create_manufacturing_order -----
CREATE OR REPLACE FUNCTION public.service_case_create_manufacturing_order(_case_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record; v_mo uuid; v_code text; v_bom uuid; v_wh uuid; v_uom uuid;
BEGIN
  SELECT sci.* INTO v_item FROM public.service_case_items sci WHERE sci.id=_case_item_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'service_case_create_manufacturing_order: item_not_found %', _case_item_id;
  END IF;
  IF v_item.product_id IS NULL THEN
    RAISE EXCEPTION 'service_case_create_manufacturing_order: item_has_no_product';
  END IF;

  SELECT id INTO v_mo FROM public.manufacturing_orders
   WHERE service_case_item_id=_case_item_id
     AND state NOT IN ('cancelled','done')
   LIMIT 1;
  IF v_mo IS NOT NULL THEN RETURN v_mo; END IF;

  SELECT id INTO v_bom FROM public.boms WHERE product_id=v_item.product_id AND active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_wh FROM public.warehouses ORDER BY created_at LIMIT 1;
  SELECT uom_id INTO v_uom FROM public.products WHERE id=v_item.product_id;
  v_code := 'MO/SC/' || lpad(nextval('public.service_case_seq')::text, 5, '0');

  INSERT INTO public.manufacturing_orders(
    code, product_id, variant_id, bom_id, qty, uom_id, warehouse_id,
    origin, service_case_id, service_case_item_id, state, created_by)
  VALUES (
    v_code, v_item.product_id, v_item.product_variant_id, v_bom, v_item.qty, v_uom, v_wh,
    'service_case'::public.mo_origin, v_item.service_case_id, _case_item_id, 'draft', auth.uid())
  RETURNING id INTO v_mo;

  UPDATE public.service_case_items SET status='waiting_part' WHERE id=_case_item_id;
  UPDATE public.service_cases SET status='waiting_manufacturing'
   WHERE id=v_item.service_case_id AND status NOT IN ('done','cancelled');

  INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, linked_manufacturing_order_id)
  VALUES (v_item.service_case_id, _case_item_id, 'manufacture_part', v_mo);

  PERFORM public._service_log(v_item.service_case_id, 'service.part.manufacturing_needed', v_mo::text,
    jsonb_build_object('product_id',v_item.product_id,'variant_id',v_item.product_variant_id,'qty',v_item.qty));
  RETURN v_mo;
END $$;

-- ----- service_case_schedule_assistance -----
CREATE OR REPLACE FUNCTION public.service_case_schedule_assistance(
  _case_id uuid, _preferred_date date, _zone_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case record; v_sched uuid;
BEGIN
  SELECT * INTO v_case FROM public.service_cases WHERE id=_case_id;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'service_case_schedule_assistance: case_not_found %', _case_id;
  END IF;
  IF v_case.sale_order_id IS NULL THEN
    RAISE EXCEPTION 'service_case_schedule_assistance: case_without_sale_order';
  END IF;

  SELECT id INTO v_sched FROM public.delivery_schedules
   WHERE service_case_id=_case_id AND status NOT IN ('cancelled','delivered')
   LIMIT 1;
  IF v_sched IS NOT NULL THEN
    UPDATE public.service_cases SET status='scheduled', delivery_schedule_id=v_sched
     WHERE id=_case_id AND status NOT IN ('done','cancelled');
    RETURN v_sched;
  END IF;

  INSERT INTO public.delivery_schedules(
    sale_order_id, partner_id, scheduled_date, status, physical_state,
    fulfillment_type, zone_id, service_case_id, created_by, notes)
  VALUES (
    v_case.sale_order_id, v_case.customer_id, _preferred_date,
    'requested','in_stock','assistance', _zone_id, _case_id, auth.uid(),
    'Assistance for ' || v_case.case_number)
  RETURNING id INTO v_sched;

  UPDATE public.service_cases
     SET status='scheduled', delivery_schedule_id=v_sched
   WHERE id=_case_id AND status NOT IN ('done','cancelled');

  INSERT INTO public.service_tasks(service_case_id, task_type, linked_delivery_schedule_id, due_date)
  VALUES (_case_id, 'schedule_assistance', v_sched, _preferred_date);

  PERFORM public._service_log(_case_id, 'service.case.scheduled', v_sched::text,
    jsonb_build_object('preferred_date',_preferred_date,'zone_id',_zone_id));
  RETURN v_sched;
END $$;

-- ----- service_case_close -----
CREATE OR REPLACE FUNCTION public.service_case_close(_case_id uuid, _resolution text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_open_tasks int; v_sched record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.service_cases WHERE id=_case_id) THEN
    RAISE EXCEPTION 'service_case_close: case_not_found %', _case_id;
  END IF;
  IF _resolution IS NULL OR length(trim(_resolution))=0 THEN
    RAISE EXCEPTION 'service_case_close: resolution_required';
  END IF;

  SELECT count(*) INTO v_open_tasks FROM public.service_tasks
   WHERE service_case_id=_case_id AND status IN ('open','in_progress');
  IF v_open_tasks > 0 THEN
    RAISE EXCEPTION 'service_case_close: open_tasks_remaining (%)', v_open_tasks;
  END IF;

  SELECT * INTO v_sched FROM public.delivery_schedules
   WHERE service_case_id=_case_id AND status NOT IN ('cancelled')
   ORDER BY created_at DESC LIMIT 1;
  IF v_sched.id IS NOT NULL AND v_sched.status <> 'delivered' THEN
    RAISE EXCEPTION 'service_case_close: assistance_not_completed (status=%)', v_sched.status;
  END IF;

  UPDATE public.service_cases
     SET status='done', closed_at=now(), closed_resolution=_resolution
   WHERE id=_case_id;

  PERFORM public._service_log(_case_id, 'service.case.done', _case_id::text,
    jsonb_build_object('resolution',_resolution));
  RETURN jsonb_build_object('ok',true,'closed_at',now());
END $$;

-- ----- service_case_cancel -----
CREATE OR REPLACE FUNCTION public.service_case_cancel(_case_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status public.service_case_status;
BEGIN
  SELECT status INTO v_status FROM public.service_cases WHERE id=_case_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'service_case_cancel: case_not_found %', _case_id;
  END IF;
  IF v_status IN ('done','cancelled') THEN
    RAISE EXCEPTION 'service_case_cancel: case_already_terminal (%)', v_status;
  END IF;

  UPDATE public.service_tasks SET status='cancelled'
   WHERE service_case_id=_case_id AND status IN ('open','in_progress');
  UPDATE public.service_cases
     SET status='cancelled', closed_at=now(), internal_notes=COALESCE(internal_notes,'') ||
         E'\n[CANCEL] ' || COALESCE(_reason,'(no reason)')
   WHERE id=_case_id;

  PERFORM public._service_log(_case_id, 'service.case.cancelled', _case_id::text,
    jsonb_build_object('reason',_reason));
  RETURN jsonb_build_object('ok',true);
END $$;

-- ============================================================
-- Reservation hooks: PO receipt + MO output dedicated to service_case
-- ============================================================

-- Reserve qty for service_case_item on quant at given location (idempotent per move)
CREATE OR REPLACE FUNCTION public._service_reserve_quant(
  _product uuid, _variant uuid, _location uuid, _qty numeric,
  _case uuid, _item uuid, _origin_type text, _origin uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quant_id uuid; v_before numeric; v_after numeric;
BEGIN
  IF _qty IS NULL OR _qty <= 0 OR _item IS NULL OR _location IS NULL THEN RETURN; END IF;

  SELECT id, reserved_quantity INTO v_quant_id, v_before FROM public.stock_quants
   WHERE product_id=_product
     AND COALESCE(variant_id::text,'')=COALESCE(_variant::text,'')
     AND location_id=_location
   ORDER BY updated_at DESC LIMIT 1;
  IF v_quant_id IS NULL THEN
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (_product, _variant, _location, _qty, _qty)
    RETURNING id, reserved_quantity INTO v_quant_id, v_after;
    v_before := 0;
  ELSE
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + _qty, updated_at = now()
     WHERE id=v_quant_id
     RETURNING reserved_quantity INTO v_after;
  END IF;

  INSERT INTO public.stock_reservation_log(
    product_id, variant_id, location_id, qty, qty_before, qty_after,
    origin_type, origin_id, action, reserved_by,
    to_service_case_id, to_service_case_item_id, notes)
  VALUES (_product, _variant, _location, _qty, v_before, v_after,
          _origin_type, _origin, 'allocated', auth.uid(),
          _case, _item, 'service_case_dedicated');

  UPDATE public.service_case_items
     SET qty_reserved = COALESCE(qty_reserved,0) + _qty,
         qty_ready    = COALESCE(qty_ready,0)    + _qty,
         status = CASE WHEN COALESCE(qty_ready,0) + _qty >= qty THEN 'part_ready'::public.service_case_item_status
                       ELSE status END
   WHERE id=_item;
END $$;

-- Trigger on stock_moves: when an incoming move for a service_case purchase_need becomes done
CREATE OR REPLACE FUNCTION public.tg_service_reserve_on_po_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pn record;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done'
     AND NEW.purchase_need_id IS NOT NULL THEN
    SELECT service_case_id, service_case_item_id, product_variant_id INTO v_pn
      FROM public.purchase_needs WHERE id=NEW.purchase_need_id;
    IF v_pn.service_case_item_id IS NOT NULL THEN
      -- variant guard
      IF COALESCE(v_pn.product_variant_id::text,'') <> COALESCE(NEW.variant_id::text,'') THEN
        RETURN NEW;
      END IF;
      -- idempotency: skip if a log row already exists for this move
      IF EXISTS (SELECT 1 FROM public.stock_reservation_log
                  WHERE origin_type='stock_move' AND origin_id=NEW.id
                    AND to_service_case_item_id = v_pn.service_case_item_id) THEN
        RETURN NEW;
      END IF;
      PERFORM public._service_reserve_quant(
        NEW.product_id, NEW.variant_id, NEW.destination_location_id, NEW.quantity_done,
        v_pn.service_case_id, v_pn.service_case_item_id, 'stock_move', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_reserve_on_po_receipt ON public.stock_moves;
CREATE TRIGGER trg_service_reserve_on_po_receipt
  AFTER UPDATE ON public.stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_reserve_on_po_receipt();

-- Trigger on manufacturing_orders state -> done: reserve outputs for service_case
CREATE OR REPLACE FUNCTION public.tg_service_reserve_on_mo_done()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done'
     AND NEW.service_case_item_id IS NOT NULL THEN
    SELECT id INTO v_loc FROM public.stock_locations WHERE name='Stock' LIMIT 1;
    IF v_loc IS NULL THEN
      SELECT id INTO v_loc FROM public.stock_locations
        WHERE warehouse_id=NEW.warehouse_id AND usage='internal' ORDER BY created_at LIMIT 1;
    END IF;
    IF v_loc IS NULL THEN RETURN NEW; END IF;

    IF EXISTS (SELECT 1 FROM public.stock_reservation_log
                WHERE origin_type='manufacturing_order' AND origin_id=NEW.id
                  AND to_service_case_item_id=NEW.service_case_item_id) THEN
      RETURN NEW;
    END IF;
    PERFORM public._service_reserve_quant(
      NEW.product_id, NEW.variant_id, v_loc, NEW.qty,
      NEW.service_case_id, NEW.service_case_item_id, 'manufacturing_order', NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_reserve_on_mo_done ON public.manufacturing_orders;
CREATE TRIGGER trg_service_reserve_on_mo_done
  AFTER UPDATE ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_reserve_on_mo_done();

-- Grants
GRANT EXECUTE ON FUNCTION public.service_case_create(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_add_item(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_add_attachment_metadata(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_triage(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_create_purchase_need(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_create_manufacturing_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_schedule_assistance(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_close(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_cancel(uuid, text) TO authenticated;
