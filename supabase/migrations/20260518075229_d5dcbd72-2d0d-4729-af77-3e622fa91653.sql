
-- ============================================================
-- F18-B :: minimal fix migration (post-test diagnosis)
-- ============================================================

-- (A) Widen purchase_needs.purpose to include service_case
ALTER TABLE public.purchase_needs DROP CONSTRAINT IF EXISTS purchase_needs_purpose_chk;
ALTER TABLE public.purchase_needs ADD CONSTRAINT purchase_needs_purpose_chk
  CHECK (purpose IS NULL OR purpose IN ('mo_specific','stock_replenishment','sales_allocation','service_case'));

-- (B) Reservation helper: accept optional payload (jsonb)
CREATE OR REPLACE FUNCTION public._service_reserve_quant(
  _product uuid, _variant uuid, _location uuid, _qty numeric,
  _case uuid, _item uuid, _origin_type text, _origin uuid, _payload jsonb DEFAULT NULL)
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
    to_service_case_id, to_service_case_item_id, notes, payload)
  VALUES (_product, _variant, _location, _qty, v_before, v_after,
          _origin_type, _origin, 'reserve', auth.uid(),
          _case, _item, 'service_case_dedicated', _payload);

  UPDATE public.service_case_items
     SET qty_reserved = COALESCE(qty_reserved,0) + _qty,
         qty_ready    = COALESCE(qty_ready,0)    + _qty,
         status = CASE WHEN COALESCE(qty_ready,0) + _qty >= qty THEN 'part_ready'::public.service_case_item_status
                       ELSE status END
   WHERE id=_item;
END $$;

-- (C) PO receipt trigger -> origin_type='PURCHASE', origin_id=purchase_need_id
CREATE OR REPLACE FUNCTION public.tg_service_reserve_on_po_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pn record;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done'
     AND NEW.purchase_need_id IS NOT NULL THEN
    SELECT id, service_case_id, service_case_item_id, product_variant_id INTO v_pn
      FROM public.purchase_needs WHERE id=NEW.purchase_need_id;
    IF v_pn.service_case_item_id IS NOT NULL THEN
      IF COALESCE(v_pn.product_variant_id::text,'') <> COALESCE(NEW.variant_id::text,'') THEN
        RETURN NEW;
      END IF;
      -- idempotency: same need + same stock_move (payload-stamped) + same item
      IF EXISTS (
        SELECT 1 FROM public.stock_reservation_log
         WHERE origin_type='PURCHASE' AND origin_id=v_pn.id
           AND to_service_case_item_id = v_pn.service_case_item_id
           AND (payload->>'stock_move_id') = NEW.id::text) THEN
        RETURN NEW;
      END IF;
      PERFORM public._service_reserve_quant(
        NEW.product_id, NEW.variant_id, NEW.destination_location_id, NEW.quantity_done,
        v_pn.service_case_id, v_pn.service_case_item_id,
        'PURCHASE', v_pn.id,
        jsonb_build_object('stock_move_id', NEW.id, 'purchase_need_id', v_pn.id));
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- (D) MO done trigger -> origin_type='MO', origin_id=manufacturing_order_id
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

    IF EXISTS (
      SELECT 1 FROM public.stock_reservation_log
       WHERE origin_type='MO' AND origin_id=NEW.id
         AND to_service_case_item_id=NEW.service_case_item_id
         AND action='reserve') THEN
      RETURN NEW;
    END IF;
    PERFORM public._service_reserve_quant(
      NEW.product_id, NEW.variant_id, v_loc, NEW.qty,
      NEW.service_case_id, NEW.service_case_item_id,
      'MO', NEW.id,
      jsonb_build_object('manufacturing_order_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;

-- (E) Health check: use real package_damage_status enum values
CREATE OR REPLACE FUNCTION public.erp_service_health_check(_threshold_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_row record;
  v_threshold timestamptz := now() - make_interval(days => _threshold_days);
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
BEGIN
  -- P0: damaged_package_without_service_case (active = reported/in_quarantine/in_repair)
  FOR v_row IN
    SELECT pdr.id, pdr.stock_package_id
      FROM public.package_damage_reports pdr
     WHERE pdr.status IN ('reported','in_quarantine','in_repair')
       AND NOT EXISTS (SELECT 1 FROM public.service_cases sc
                         WHERE sc.stock_package_id = pdr.stock_package_id
                           AND sc.status NOT IN ('cancelled','rejected'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','damaged_package_without_service_case','severity','P0','entity','package_damage_report','entity_id',v_row.id,
      'detail', format('Damage report %s (pkg=%s) sem service_case', v_row.id, v_row.stock_package_id));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sc.id, sc.case_number,
           (SELECT count(*) FROM public.service_tasks st WHERE st.service_case_id=sc.id AND st.status IN ('open','in_progress')) AS open_tasks
      FROM public.service_cases sc WHERE sc.status='done'
  LOOP
    IF v_row.open_tasks > 0 THEN
      v_findings := v_findings || jsonb_build_object('category','service','code','service_case_done_with_open_tasks','severity','P0','entity','service_case','entity_id',v_row.id,
        'detail', format('Case %s done com %s tarefas abertas', v_row.case_number, v_row.open_tasks));
      v_p0 := v_p0+1;
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT sc.id, sc.case_number
      FROM public.service_cases sc
     WHERE sc.status IN ('scheduled','in_route')
       AND EXISTS (SELECT 1 FROM public.service_case_items sci
                    WHERE sci.service_case_id=sc.id
                      AND sci.required_action IN ('replace','send_part','buy_part','manufacture_part','repair')
                      AND sci.status NOT IN ('part_ready','done','cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_scheduled_without_ready_parts','severity','P0','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s scheduled mas itens sem peça pronta', v_row.case_number));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE status='done' AND (closed_resolution IS NULL OR length(trim(closed_resolution))=0)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_closed_without_resolution','severity','P0','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s done sem resolution', v_row.case_number));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT id, case_number, status, reported_at FROM public.service_cases
     WHERE status NOT IN ('done','cancelled','rejected') AND reported_at < v_threshold
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_open_too_long','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s aberto há mais de %s dias (status=%s)', v_row.case_number, _threshold_days, v_row.status));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.status='waiting_parts'
       AND NOT EXISTS (SELECT 1 FROM public.purchase_needs pn
                        WHERE pn.service_case_id=sc.id
                          AND pn.state NOT IN ('cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_waiting_parts_without_purchase_need','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s waiting_parts sem purchase_need ativa', v_row.case_number));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.status='waiting_manufacturing'
       AND NOT EXISTS (SELECT 1 FROM public.manufacturing_orders mo
                        WHERE mo.service_case_id=sc.id
                          AND mo.state NOT IN ('cancelled'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_waiting_manufacturing_without_mo','severity','P1','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s waiting_manufacturing sem MO ativa', v_row.case_number));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT id FROM public.delivery_schedules
     WHERE fulfillment_type='assistance' AND service_case_id IS NULL
       AND status NOT IN ('cancelled','delivered')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','assistance_schedule_without_service_case','severity','P1','entity','delivery_schedule','entity_id',v_row.id,
      'detail', format('Schedule %s fulfillment=assistance sem service_case', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT sci.id, sci.service_case_id
      FROM public.service_case_items sci
      JOIN public.service_cases sc ON sc.id=sci.service_case_id
     WHERE sci.required_action IS NULL
       AND sc.status NOT IN ('new','triage','cancelled','rejected','done')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_item_without_action','severity','P1','entity','service_case_item','entity_id',v_row.id,
      'detail', format('Item %s sem required_action', v_row.id));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE assigned_to IS NULL AND status NOT IN ('new','cancelled','rejected','done')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_without_assignment','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s ativo sem assigned_to', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN
    SELECT id, case_number FROM public.service_cases
     WHERE case_type IN ('delivery_issue','customer_claim','damaged_return','warranty')
       AND status NOT IN ('new','cancelled','rejected')
       AND NOT EXISTS (SELECT 1 FROM public.service_case_attachments sca
                        WHERE sca.service_case_id=service_cases.id
                          AND sca.attachment_type IN ('customer_photo','delivery_photo','warehouse_photo','supplier_evidence'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','service_case_without_photos_when_required','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s sem fotos exigidas', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN
    SELECT sc.id, sc.case_number FROM public.service_cases sc
     WHERE sc.case_type='supplier_defect'
       AND sc.status NOT IN ('cancelled','rejected')
       AND NOT EXISTS (SELECT 1 FROM public.service_tasks st
                        WHERE st.service_case_id=sc.id AND st.task_type='supplier_claim')
  LOOP
    v_findings := v_findings || jsonb_build_object('category','service','code','supplier_defect_without_supplier_claim','severity','P2','entity','service_case','entity_id',v_row.id,
      'detail', format('Case %s supplier_defect sem supplier_claim task', v_row.case_number));
    v_p2 := v_p2+1;
  END LOOP;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'total',v_p0+v_p1+v_p2),
    'findings', v_findings);
END $$;

-- (F) Reorganised test: A09/A12 use new vocabulary; A20/A21/A22 share a setup outside the failing block
CREATE OR REPLACE FUNCTION public._test_phase18_service_assistance_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_pfx        text := 'TESTE_F18B_';
  v_seed       jsonb;
  v_report     jsonb := '[]'::jsonb;
  v_ok         int := 0;
  v_fail       int := 0;
  v_user       uuid;
  v_customer   uuid;
  v_wh         uuid;
  v_cama       uuid;
  v_ripa       uuid;
  v_estr       uuid;
  v_zone       uuid;
  v_loc_stock  uuid;
  v_so         uuid;
  v_sol        uuid;
  v_so2        uuid;
  v_pkg        uuid;
  v_pkg_orphan uuid;
  v_case       uuid;
  v_case2      uuid;
  v_case_cancel uuid;
  v_case_wp    uuid;
  v_case_wm    uuid;
  v_item_buy   uuid;
  v_item_buy2  uuid;
  v_item_mfg   uuid;
  v_item_mfg2  uuid;
  v_item_pkg   uuid;
  v_att        uuid;
  v_need       uuid;
  v_need2      uuid;
  v_mo         uuid;
  v_mo2        uuid;
  v_sched      uuid;
  v_sched2     uuid;
  v_route      uuid;
  v_move       uuid;
  v_quant_qty  numeric;
  v_quant_res  numeric;
  v_log_rows   int;
  v_qty_reserved numeric;
  v_status     text;
  v_count      int;
  v_health     jsonb;
  v_pass       boolean;
  v_sqlstate   text;
  v_sqlerrm    text;
  v_pn         record;
BEGIN
  PERFORM public._cleanup_phase18_service_flow();
  v_seed     := public._seed_golden_upm();
  v_customer := (v_seed->>'customer')::uuid;
  v_wh       := (v_seed->>'warehouse')::uuid;
  v_cama     := (v_seed->>'cama')::uuid;
  v_estr     := (v_seed->>'estrutura')::uuid;
  v_ripa     := (v_seed->'components'->>'ripa')::uuid;
  v_zone     := (v_seed->'logistics'->>'zone_id')::uuid;
  SELECT id INTO v_loc_stock FROM stock_locations WHERE name='Stock' LIMIT 1;

  SELECT ug.user_id INTO v_user
    FROM user_groups ug JOIN groups g ON g.id=ug.group_id
   WHERE g.code='inventory_user' ORDER BY ug.user_id LIMIT 1;
  IF v_user IS NULL THEN
    SELECT ug.user_id INTO v_user FROM user_groups ug JOIN groups g ON g.id=ug.group_id
     WHERE g.code='system_admin' ORDER BY ug.user_id LIMIT 1;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: no test user available';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
    VALUES (v_pfx||'SO',v_customer,v_wh,'confirmed','delivery',1500,1500) RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
    VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
  INSERT INTO stock_packages(product_id, current_location_id, package_ref, qty, status)
    VALUES (v_cama, v_loc_stock, v_pfx||'PKG1', 1, 'available') RETURNING id INTO v_pkg;

  v_report := v_report || jsonb_build_object('id','SETUP','status','OK','observed',
    format('so=%s sol=%s pkg=%s user=%s', v_so, v_sol, v_pkg, v_user));
  v_ok := v_ok+1;

  -- A01 Create case
  BEGIN
    v_case := public.service_case_create(jsonb_build_object(
      'sale_order_id', v_so, 'sale_order_line_id', v_sol,
      'customer_id', v_customer, 'product_id', v_cama,
      'case_type','customer_claim','source','customer',
      'priority','high','description', v_pfx||'A01 main case'));
    v_pass := v_case IS NOT NULL AND EXISTS(SELECT 1 FROM service_cases WHERE id=v_case AND status='new');
    v_report := v_report || jsonb_build_object('id','A01','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case=%s',v_case));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A01','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1;
    RAISE EXCEPTION 'A01 hard fail: %', v_sqlerrm; END;

  -- A02 Add item by SOL
  BEGIN
    v_item_buy := public.service_case_add_item(v_case, jsonb_build_object('product_id',v_ripa,'sale_order_line_id',v_sol,'issue_type','missing','qty',2));
    v_pass := EXISTS(SELECT 1 FROM service_case_items WHERE id=v_item_buy AND sale_order_line_id=v_sol);
    v_report := v_report || jsonb_build_object('id','A02','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('item_buy=%s',v_item_buy));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A02','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A03 Add item by pkg
  BEGIN
    v_item_pkg := public.service_case_add_item(v_case, jsonb_build_object('product_id',v_cama,'stock_package_id',v_pkg,'issue_type','damaged','qty',1));
    v_pass := EXISTS(SELECT 1 FROM service_case_items WHERE id=v_item_pkg AND stock_package_id=v_pkg);
    v_report := v_report || jsonb_build_object('id','A03','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('item_pkg=%s',v_item_pkg));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A03','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A04 Attachment
  BEGIN
    v_att := public.service_case_add_attachment_metadata(v_case, jsonb_build_object('file_url','https://example.test/f.jpg','file_name','f.jpg','file_type','image/jpeg','attachment_type','customer_photo'));
    v_pass := EXISTS(SELECT 1 FROM service_case_attachments WHERE id=v_att AND service_case_id=v_case);
    v_report := v_report || jsonb_build_object('id','A04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('att=%s',v_att));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A04','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A05 Triage
  BEGIN
    PERFORM public.service_case_triage(v_case, jsonb_build_object('responsibility','supplier','warranty_status','in_warranty','default_required_action','send_part','next_status','triage'));
    SELECT responsibility::text, status::text INTO v_status, v_sqlerrm FROM service_cases WHERE id=v_case;
    v_pass := v_status='supplier' AND EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case AND required_action='send_part');
    v_report := v_report || jsonb_build_object('id','A05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('resp=%s status=%s',v_status,v_sqlerrm));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A05','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A06 create purchase_need
  BEGIN
    v_need := public.service_case_create_purchase_need(v_item_buy);
    SELECT * INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := v_pn.id IS NOT NULL AND v_pn.service_case_id=v_case AND v_pn.service_case_item_id=v_item_buy AND v_pn.origin_kind='service_case';
    v_report := v_report || jsonb_build_object('id','A06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('need=%s origin=%s',v_need,v_pn.origin_kind));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A06','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A07 preserve variant
  BEGIN
    SELECT * INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := COALESCE(v_pn.product_variant_id::text,'') = COALESCE((SELECT product_variant_id::text FROM service_case_items WHERE id=v_item_buy),'');
    v_report := v_report || jsonb_build_object('id','A07','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('pn.variant=%s',v_pn.product_variant_id));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A07','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A08 create PO
  BEGIN
    PERFORM public.purchase_needs_create_po(ARRAY[v_need], NULL, NULL);
    SELECT purchase_order_id, state::text INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := v_pn.purchase_order_id IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('po=%s state=%s',v_pn.purchase_order_id,v_pn.state));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A08','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A09 PO receipt reserves to service_case_item (origin_type='PURCHASE', payload.stock_move_id)
  BEGIN
    INSERT INTO stock_moves(product_id, source_location_id, destination_location_id, quantity, quantity_done, state, purchase_need_id, reference)
      VALUES (v_ripa, v_loc_stock, v_loc_stock, 2, 0, 'draft', v_need, v_pfx||'A09_MOVE') RETURNING id INTO v_move;
    UPDATE stock_moves SET state='done', quantity_done=2 WHERE id=v_move;

    SELECT count(*) INTO v_log_rows FROM stock_reservation_log
     WHERE to_service_case_item_id=v_item_buy AND origin_type='PURCHASE' AND origin_id=v_need
       AND (payload->>'stock_move_id')=v_move::text AND action='reserve';
    SELECT qty_reserved INTO v_qty_reserved FROM service_case_items WHERE id=v_item_buy;
    v_pass := v_log_rows = 1 AND v_qty_reserved >= 2;
    v_report := v_report || jsonb_build_object('id','A09','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('log_rows=%s qty_reserved=%s',v_log_rows,v_qty_reserved));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A09','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A10 Not free
  BEGIN
    SELECT quantity, reserved_quantity INTO v_quant_qty, v_quant_res FROM stock_quants
      WHERE product_id=v_ripa AND location_id=v_loc_stock ORDER BY updated_at DESC LIMIT 1;
    v_pass := COALESCE(v_quant_qty,0) >= 2 AND COALESCE(v_quant_res,0) >= 2 AND COALESCE(v_quant_qty,0)-COALESCE(v_quant_res,0) <= 0;
    v_report := v_report || jsonb_build_object('id','A10','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('qty=%s reserved=%s available=%s',v_quant_qty,v_quant_res,COALESCE(v_quant_qty,0)-COALESCE(v_quant_res,0)));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A10','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A11 MO creation
  BEGIN
    v_item_mfg := public.service_case_add_item(v_case, jsonb_build_object('product_id',v_estr,'issue_type','defective','qty',1));
    v_mo := public.service_case_create_manufacturing_order(v_item_mfg);
    v_pass := EXISTS(SELECT 1 FROM manufacturing_orders WHERE id=v_mo AND service_case_id=v_case AND service_case_item_id=v_item_mfg AND origin='service_case');
    v_report := v_report || jsonb_build_object('id','A11','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('mo=%s item_mfg=%s',v_mo,v_item_mfg));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A11','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A12 MO done -> reserve (origin_type='MO', origin_id=mo_id)
  BEGIN
    UPDATE manufacturing_orders SET state='done', qty=1 WHERE id=v_mo;
    SELECT count(*) INTO v_log_rows FROM stock_reservation_log
      WHERE to_service_case_item_id=v_item_mfg AND origin_type='MO' AND origin_id=v_mo AND action='reserve';
    SELECT qty_reserved INTO v_qty_reserved FROM service_case_items WHERE id=v_item_mfg;
    v_pass := v_log_rows = 1 AND COALESCE(v_qty_reserved,0) >= 1;
    v_report := v_report || jsonb_build_object('id','A12','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('log_rows=%s qty_reserved=%s',v_log_rows,v_qty_reserved));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A12','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A13 Schedule
  BEGIN
    v_sched := public.service_case_schedule_assistance(v_case, CURRENT_DATE + 5, v_zone);
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched AND fulfillment_type='assistance' AND service_case_id=v_case);
    v_report := v_report || jsonb_build_object('id','A13','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('sched=%s',v_sched));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A13','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A14 Route assignment
  BEGIN
    INSERT INTO delivery_routes(zone_id, route_date, state, notes) VALUES (v_zone, CURRENT_DATE+5, 'planned', v_pfx||'ROUTE_A14') RETURNING id INTO v_route;
    INSERT INTO delivery_route_orders(route_id, schedule_id, sequence, status) VALUES (v_route, v_sched, 1, 'planned');
    UPDATE delivery_schedules SET route_id=v_route, status='assigned' WHERE id=v_sched;
    v_pass := EXISTS(SELECT 1 FROM delivery_route_orders WHERE route_id=v_route AND schedule_id=v_sched);
    v_report := v_report || jsonb_build_object('id','A14','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('route=%s',v_route));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A14','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A15 Execute
  BEGIN
    UPDATE delivery_route_orders SET status='delivered', delivered_at=now() WHERE route_id=v_route AND schedule_id=v_sched;
    UPDATE delivery_schedules SET status='delivered', physical_state='delivered' WHERE id=v_sched;
    UPDATE service_tasks SET status='done' WHERE service_case_id=v_case AND status IN ('open','in_progress');
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched AND status='delivered');
    v_report := v_report || jsonb_build_object('id','A15','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','sched=delivered');
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A15','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A16 Close
  BEGIN
    PERFORM public.service_case_close(v_case, 'Resolved in test');
    v_pass := EXISTS(SELECT 1 FROM service_cases WHERE id=v_case AND status='done' AND closed_resolution='Resolved in test');
    v_report := v_report || jsonb_build_object('id','A16','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','case=done');
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A16','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A17 Damaged pkg w/o case (status='reported')
  BEGIN
    INSERT INTO stock_packages(product_id, current_location_id, package_ref, qty, status)
      VALUES (v_cama, v_loc_stock, v_pfx||'PKG_ORPHAN', 1, 'available') RETURNING id INTO v_pkg_orphan;
    INSERT INTO package_damage_reports(stock_package_id, damage_type, description, status)
      VALUES (v_pkg_orphan, 'broken', v_pfx||'orphan damage', 'reported');
    v_health := public.erp_service_health_check(30);
    v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f
       WHERE f->>'code'='damaged_package_without_service_case'
         AND (f->>'entity_id')::uuid IN (SELECT id FROM package_damage_reports WHERE stock_package_id=v_pkg_orphan));
    v_report := v_report || jsonb_build_object('id','A17','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('hc.p0=%s',(v_health->'summary'->>'p0')));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A17','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A18 waiting_parts w/o pn
  BEGIN
    INSERT INTO service_cases(case_number, customer_id, case_type, source, status, description)
      VALUES (public.next_service_case_number(), v_customer, 'other', 'internal', 'waiting_parts', v_pfx||'A18 wp') RETURNING id INTO v_case_wp;
    v_health := public.erp_service_health_check(30);
    v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f
       WHERE f->>'code'='service_case_waiting_parts_without_purchase_need' AND (f->>'entity_id')::uuid = v_case_wp);
    v_report := v_report || jsonb_build_object('id','A18','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case_wp=%s',v_case_wp));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A18','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A19 waiting_manufacturing w/o mo
  BEGIN
    INSERT INTO service_cases(case_number, customer_id, case_type, source, status, description)
      VALUES (public.next_service_case_number(), v_customer, 'other', 'internal', 'waiting_manufacturing', v_pfx||'A19 wm') RETURNING id INTO v_case_wm;
    v_health := public.erp_service_health_check(30);
    v_pass := EXISTS(SELECT 1 FROM jsonb_array_elements(v_health->'findings') f
       WHERE f->>'code'='service_case_waiting_manufacturing_without_mo' AND (f->>'entity_id')::uuid = v_case_wm);
    v_report := v_report || jsonb_build_object('id','A19','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case_wm=%s',v_case_wm));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A19','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- ====== SETUP for A20/A21/A22 (outside failing subtransactions) ======
  INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
    VALUES (v_pfx||'SO2',v_customer,v_wh,'confirmed','delivery',100,100) RETURNING id INTO v_so2;
  v_case2 := public.service_case_create(jsonb_build_object(
    'sale_order_id', v_so2, 'customer_id', v_customer,
    'case_type','customer_claim','source','customer',
    'description', v_pfx||'A20-22 dup-tests'));
  v_item_buy2 := public.service_case_add_item(v_case2, jsonb_build_object('product_id',v_ripa,'issue_type','missing','qty',1));
  v_item_mfg2 := public.service_case_add_item(v_case2, jsonb_build_object('product_id',v_estr,'issue_type','defective','qty',1));

  -- A20 idempotent purchase_need
  BEGIN
    v_need  := public.service_case_create_purchase_need(v_item_buy2);
    v_need2 := public.service_case_create_purchase_need(v_item_buy2);
    SELECT count(*) INTO v_count FROM purchase_needs WHERE service_case_item_id=v_item_buy2;
    v_pass := v_need = v_need2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A20','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('need=%s need2=%s count=%s',v_need,v_need2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A20','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A21 idempotent MO
  BEGIN
    v_mo  := public.service_case_create_manufacturing_order(v_item_mfg2);
    v_mo2 := public.service_case_create_manufacturing_order(v_item_mfg2);
    SELECT count(*) INTO v_count FROM manufacturing_orders WHERE service_case_item_id=v_item_mfg2;
    v_pass := v_mo = v_mo2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A21','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('mo=%s mo2=%s count=%s',v_mo,v_mo2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A21','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A22 idempotent schedule
  BEGIN
    v_sched  := public.service_case_schedule_assistance(v_case2, CURRENT_DATE + 7, v_zone);
    v_sched2 := public.service_case_schedule_assistance(v_case2, CURRENT_DATE + 7, v_zone);
    SELECT count(*) INTO v_count FROM delivery_schedules WHERE service_case_id=v_case2 AND status NOT IN ('cancelled','delivered','rescheduled');
    v_pass := v_sched = v_sched2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A22','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('sched=%s sched2=%s count=%s',v_sched,v_sched2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A22','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A23 Cancel preserves history
  BEGIN
    v_case_cancel := public.service_case_create(jsonb_build_object('customer_id',v_customer,'case_type','other','source','internal','description',v_pfx||'A23 to cancel'));
    PERFORM public.service_case_add_item(v_case_cancel, jsonb_build_object('product_id',v_ripa,'issue_type','other','qty',1));
    PERFORM public.service_case_cancel(v_case_cancel, 'test-cancel');
    SELECT status::text, internal_notes INTO v_status, v_sqlerrm FROM service_cases WHERE id=v_case_cancel;
    v_pass := v_status='cancelled' AND v_sqlerrm ILIKE '%[CANCEL]%' AND EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case_cancel);
    v_report := v_report || jsonb_build_object('id','A23','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('status=%s history_preserved=true',v_status));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A23','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  IF _cleanup THEN PERFORM public._cleanup_phase18_service_flow(); END IF;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('ok',v_ok,'fail',v_fail,'total',v_ok+v_fail),
    'details', v_report);
END $function$;
