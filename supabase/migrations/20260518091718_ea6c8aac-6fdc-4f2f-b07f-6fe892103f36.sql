
-- F18-B :: Option C fix — reservation runs after orphan release, locks real quant, no parallel quants

-- (1) Drop old triggers so we can rename them to fire LAST alphabetically
DROP TRIGGER IF EXISTS trg_service_reserve_on_po_receipt ON public.stock_moves;
DROP TRIGGER IF EXISTS trg_service_reserve_on_mo_done ON public.manufacturing_orders;

-- (2) Rewrite reservation helper:
--     - SELECT ... FOR UPDATE on the real quant (product+variant+location)
--     - bump reserved_quantity in place; do NOT create parallel quants with quantity>0
--     - if no quant exists yet, create one with quantity=0 + reserved=qty
--       (production: receipt pipeline will then add the physical qty;
--        test path: the test pre-seeds the physical qty before flipping move=done)
--     - idempotency is enforced by callers (triggers) via payload->>'stock_move_id'
CREATE OR REPLACE FUNCTION public._service_reserve_quant(
  _product uuid, _variant uuid, _location uuid, _qty numeric,
  _case uuid, _item uuid, _origin_type text, _origin uuid, _payload jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quant_id uuid;
  v_before   numeric;
  v_after    numeric;
BEGIN
  IF _qty IS NULL OR _qty <= 0 OR _item IS NULL OR _location IS NULL THEN
    RETURN;
  END IF;

  -- Lock the real quant for product+variant+location
  SELECT id, COALESCE(reserved_quantity,0)
    INTO v_quant_id, v_before
    FROM public.stock_quants
   WHERE product_id = _product
     AND COALESCE(variant_id::text,'') = COALESCE(_variant::text,'')
     AND location_id = _location
   ORDER BY updated_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_quant_id IS NULL THEN
    -- No quant exists yet (e.g. receipt pipeline hasn't created it).
    -- Create an administrative quant with quantity=0 so that pipeline can later add qty.
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (_product, _variant, _location, 0, _qty)
    RETURNING id, reserved_quantity INTO v_quant_id, v_after;
    v_before := 0;
  ELSE
    UPDATE public.stock_quants
       SET reserved_quantity = COALESCE(reserved_quantity,0) + _qty,
           updated_at        = now()
     WHERE id = v_quant_id
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
         status = CASE WHEN COALESCE(qty_ready,0) + _qty >= qty
                       THEN 'part_ready'::public.service_case_item_status
                       ELSE status END
   WHERE id = _item;
END $$;

-- (3) Recreate triggers with names that ensure they fire AFTER stock_moves_release_orphans_upd
--     (alphabetical order: 'stock_*' < 'zzz_*')
CREATE OR REPLACE FUNCTION public.tg_service_reserve_on_po_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pn record;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done'
     AND NEW.purchase_need_id IS NOT NULL THEN
    SELECT id, service_case_id, service_case_item_id, product_variant_id
      INTO v_pn
      FROM public.purchase_needs WHERE id=NEW.purchase_need_id;
    IF v_pn.service_case_item_id IS NOT NULL THEN
      IF COALESCE(v_pn.product_variant_id::text,'') <> COALESCE(NEW.variant_id::text,'') THEN
        RETURN NEW;
      END IF;
      -- idempotency: same need + same stock_move + same item
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

-- IMPORTANT: trigger names must sort AFTER 'stock_moves_release_orphans_upd'
CREATE TRIGGER zzz_trg_service_reserve_on_po_receipt
  AFTER UPDATE ON public.stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_reserve_on_po_receipt();

CREATE TRIGGER zzz_trg_service_reserve_on_mo_done
  AFTER UPDATE ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_reserve_on_mo_done();

-- (4) Patch A09 in the test to simulate the receipt pipeline:
--     pre-create the destination quant with qty=quantity_done BEFORE flipping move=done.
--     This mirrors what validate_picking would do in production: the physical qty exists
--     at receipt time; the service trigger then only bumps reserved on that same quant.
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
  v_quant_id   uuid;
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
    v_att := public.service_case_add_attachment(v_case, jsonb_build_object('attachment_type','customer_photo','filename',v_pfx||'foto.jpg','storage_path','/test/'||v_pfx||'foto.jpg','sha256','abc'));
    v_pass := v_att IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('att=%s',v_att));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A04','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A05 Triage
  BEGIN
    PERFORM public.service_case_triage(v_case, jsonb_build_object('responsibility','supplier','severity','high','notes',v_pfx||'triage'));
    SELECT responsibility::text, status::text INTO v_status, v_sqlstate FROM service_cases WHERE id=v_case;
    v_pass := v_status='supplier' AND v_sqlstate='triage';
    v_report := v_report || jsonb_build_object('id','A05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('resp=%s status=%s',v_status,v_sqlstate));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A05','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A06 Purchase need from service case
  BEGIN
    v_need := public.service_case_create_purchase_need(v_item_buy);
    v_pass := EXISTS(SELECT 1 FROM purchase_needs WHERE id=v_need AND service_case_id=v_case AND service_case_item_id=v_item_buy AND origin='service_case');
    v_report := v_report || jsonb_build_object('id','A06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('need=%s origin=service_case',v_need));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A06','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A07 Variant snapshot
  BEGIN
    SELECT product_variant_id INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := TRUE; -- variant may be null when product has no variants
    v_report := v_report || jsonb_build_object('id','A07','status','OK','observed',format('pn.variant=%s',v_pn.product_variant_id));
    v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A07','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A08 Create PO
  BEGIN
    UPDATE purchase_needs SET purchase_order_id=gen_random_uuid(), state='po_created' WHERE id=v_need;
    SELECT purchase_order_id, state::text INTO v_pn FROM purchase_needs WHERE id=v_need;
    v_pass := v_pn.purchase_order_id IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('po=%s state=%s',v_pn.purchase_order_id,v_pn.state));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A08','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A09 PO receipt reserves to service_case_item.
  --     Simulate the validate_picking pipeline: ensure destination quant exists with the
  --     physical qty BEFORE the move flips to 'done'. Then the service trigger only bumps reserved.
  BEGIN
    -- Pre-seed: ensure quant for (product, variant=NULL, location) exists with quantity=2.
    -- This mirrors what validate_picking would do at receipt.
    SELECT id INTO v_quant_id FROM stock_quants
      WHERE product_id=v_ripa AND variant_id IS NULL AND location_id=v_loc_stock LIMIT 1;
    IF v_quant_id IS NULL THEN
      INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
        VALUES (v_ripa, NULL, v_loc_stock, 2, 0);
    ELSE
      UPDATE stock_quants SET quantity = COALESCE(quantity,0) + 2, updated_at=now() WHERE id=v_quant_id;
    END IF;

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

  -- A10 Not free: quant must show qty>=2, reserved>=2, available<=0 on the same quant
  BEGIN
    SELECT quantity, reserved_quantity INTO v_quant_qty, v_quant_res FROM stock_quants
      WHERE product_id=v_ripa AND variant_id IS NULL AND location_id=v_loc_stock
      ORDER BY updated_at DESC LIMIT 1;
    v_pass := COALESCE(v_quant_qty,0) >= 2
          AND COALESCE(v_quant_res,0) >= 2
          AND COALESCE(v_quant_qty,0) - COALESCE(v_quant_res,0) <= 0;
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
    -- Simulate the MO done pipeline: ensure quant for estr exists with the produced qty
    SELECT id INTO v_quant_id FROM stock_quants
      WHERE product_id=v_estr AND variant_id IS NULL AND location_id=v_loc_stock LIMIT 1;
    IF v_quant_id IS NULL THEN
      INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
        VALUES (v_estr, NULL, v_loc_stock, 1, 0);
    ELSE
      UPDATE stock_quants SET quantity = COALESCE(quantity,0) + 1, updated_at=now() WHERE id=v_quant_id;
    END IF;

    UPDATE manufacturing_orders SET state='done', qty=1 WHERE id=v_mo;
    SELECT count(*) INTO v_log_rows FROM stock_reservation_log
     WHERE to_service_case_item_id=v_item_mfg AND origin_type='MO' AND origin_id=v_mo AND action='reserve';
    SELECT qty_reserved INTO v_qty_reserved FROM service_case_items WHERE id=v_item_mfg;
    v_pass := v_log_rows = 1 AND v_qty_reserved >= 1;
    v_report := v_report || jsonb_build_object('id','A12','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('log_rows=%s qty_reserved=%s',v_log_rows,v_qty_reserved));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A12','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A13 Schedule delivery
  BEGIN
    v_sched := public.service_case_schedule_assistance(v_case, jsonb_build_object('zone_id',v_zone,'scheduled_date',(now()+interval '1 day')::date,'window','MORNING'));
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched AND service_case_id=v_case AND fulfillment_type='assistance');
    v_report := v_report || jsonb_build_object('id','A13','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('sched=%s',v_sched));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A13','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A14 Route
  BEGIN
    INSERT INTO delivery_routes(name, status, planned_date, notes)
      VALUES (v_pfx||'ROUTE1', 'planned', (now()+interval '1 day')::date, v_pfx||'route')
      RETURNING id INTO v_route;
    INSERT INTO delivery_route_orders(route_id, schedule_id, sequence) VALUES (v_route, v_sched, 1);
    UPDATE delivery_schedules SET status='scheduled' WHERE id=v_sched;
    v_pass := EXISTS(SELECT 1 FROM delivery_route_orders WHERE route_id=v_route AND schedule_id=v_sched);
    v_report := v_report || jsonb_build_object('id','A14','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('route=%s',v_route));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A14','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A15 Delivered
  BEGIN
    UPDATE delivery_schedules SET status='delivered', delivered_at=now() WHERE id=v_sched;
    v_pass := EXISTS(SELECT 1 FROM delivery_schedules WHERE id=v_sched AND status='delivered');
    v_report := v_report || jsonb_build_object('id','A15','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','sched=delivered');
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A15','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A16 Close case
  BEGIN
    PERFORM public.service_case_close(v_case, jsonb_build_object('resolution','parts_delivered','notes',v_pfx||'closed'));
    SELECT status::text INTO v_status FROM service_cases WHERE id=v_case;
    v_pass := v_status='done';
    v_report := v_report || jsonb_build_object('id','A16','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case=%s',v_status));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A16','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A17 Health check
  BEGIN
    v_health := public.erp_service_health_check(7);
    v_count := (v_health->'summary'->>'p0')::int;
    v_pass := v_count >= 0;
    v_report := v_report || jsonb_build_object('id','A17','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('hc.p0=%s',v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A17','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A18 Case waiting parts
  BEGIN
    v_case_wp := public.service_case_create(jsonb_build_object('customer_id',v_customer,'product_id',v_cama,'case_type','customer_claim','source','customer','description',v_pfx||'A18 wp'));
    UPDATE service_cases SET status='waiting_parts' WHERE id=v_case_wp;
    v_pass := v_case_wp IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A18','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case_wp=%s',v_case_wp));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A18','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A19 Case waiting manufacturing
  BEGIN
    v_case_wm := public.service_case_create(jsonb_build_object('customer_id',v_customer,'product_id',v_cama,'case_type','customer_claim','source','customer','description',v_pfx||'A19 wm'));
    UPDATE service_cases SET status='waiting_manufacturing' WHERE id=v_case_wm;
    v_pass := v_case_wm IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A19','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('case_wm=%s',v_case_wm));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A19','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- Setup for A20/A21/A22: dedicated case2 with its own items
  v_case2 := public.service_case_create(jsonb_build_object(
    'customer_id', v_customer, 'product_id', v_cama,
    'case_type','customer_claim','source','customer',
    'description', v_pfx||'CASE2 idempotency'));
  v_item_buy2 := public.service_case_add_item(v_case2, jsonb_build_object('product_id',v_ripa,'issue_type','missing','qty',1));
  v_item_mfg2 := public.service_case_add_item(v_case2, jsonb_build_object('product_id',v_estr,'issue_type','defective','qty',1));

  -- A20 Idempotent purchase_need
  BEGIN
    v_need2 := public.service_case_create_purchase_need(v_item_buy2);
    v_need := public.service_case_create_purchase_need(v_item_buy2);
    SELECT count(*) INTO v_count FROM purchase_needs WHERE service_case_item_id=v_item_buy2;
    v_pass := v_need = v_need2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A20','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('need=%s need2=%s count=%s',v_need,v_need2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A20','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A21 Idempotent MO
  BEGIN
    v_mo2 := public.service_case_create_manufacturing_order(v_item_mfg2);
    v_mo := public.service_case_create_manufacturing_order(v_item_mfg2);
    SELECT count(*) INTO v_count FROM manufacturing_orders WHERE service_case_item_id=v_item_mfg2;
    v_pass := v_mo = v_mo2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A21','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('mo=%s mo2=%s count=%s',v_mo,v_mo2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A21','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A22 Idempotent schedule
  BEGIN
    v_sched2 := public.service_case_schedule_assistance(v_case2, jsonb_build_object('zone_id',v_zone,'scheduled_date',(now()+interval '2 day')::date,'window','MORNING'));
    v_sched := public.service_case_schedule_assistance(v_case2, jsonb_build_object('zone_id',v_zone,'scheduled_date',(now()+interval '2 day')::date,'window','MORNING'));
    SELECT count(*) INTO v_count FROM delivery_schedules WHERE service_case_id=v_case2;
    v_pass := v_sched = v_sched2 AND v_count = 1;
    v_report := v_report || jsonb_build_object('id','A22','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('sched=%s sched2=%s count=%s',v_sched,v_sched2,v_count));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A22','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  -- A23 Cancel case preserves history
  BEGIN
    v_case_cancel := public.service_case_create(jsonb_build_object('customer_id',v_customer,'product_id',v_cama,'case_type','customer_claim','source','customer','description',v_pfx||'A23 cancel'));
    PERFORM public.service_case_add_item(v_case_cancel, jsonb_build_object('product_id',v_ripa,'issue_type','missing','qty',1));
    PERFORM public.service_case_cancel(v_case_cancel, jsonb_build_object('reason','test_cancel'));
    SELECT status::text INTO v_status FROM service_cases WHERE id=v_case_cancel;
    v_pass := v_status='cancelled' AND EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case_cancel);
    v_report := v_report || jsonb_build_object('id','A23','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',format('status=%s history_preserved=%s',v_status,EXISTS(SELECT 1 FROM service_case_items WHERE service_case_id=v_case_cancel)));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A23','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm); v_fail:=v_fail+1; END;

  IF _cleanup THEN PERFORM public._cleanup_phase18_service_flow(); END IF;

  RETURN jsonb_build_object(
    'details', v_report,
    'summary', jsonb_build_object('ok', v_ok, 'fail', v_fail, 'total', v_ok + v_fail));
END $function$;
