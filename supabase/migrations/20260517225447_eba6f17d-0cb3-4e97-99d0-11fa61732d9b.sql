-- A11 fix #1: so_classify_line agora considera reservas existentes para a própria SO como "ready".
-- Isto corrige o caso em que confirm_sale_order já reservou o produto acabado no outgoing picking
-- mas a SOL continuava marcada como waiting_components após close_mo.
CREATE OR REPLACE FUNCTION public.so_classify_line(_line_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line sale_order_lines%ROWTYPE;
  v_so sale_orders%ROWTYPE;
  v_prod products%ROWTYPE;
  v_avail numeric := 0; v_incoming numeric := 0; v_inprod numeric := 0;
  v_my_reserved numeric := 0;
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

  -- Reserva já existente para esta SO (qualquer move outgoing com origin=so.name) na location interna
  SELECT COALESCE(MAX(sm.reserved_quantity),0)
    INTO v_my_reserved
    FROM stock_moves sm
    JOIN stock_pickings sp ON sp.id = sm.picking_id
    JOIN stock_locations sl ON sl.id = sm.source_location_id
   WHERE sp.origin = v_so.name
     AND sp.kind = 'outgoing'
     AND sl.type = 'internal'
     AND sm.product_id = v_prod.id
     AND COALESCE(sm.variant_id::text,'') = COALESCE(v_line.variant_id::text,'')
     AND sm.state IN ('ready','done','assigned','partially_available');

  v_qty_ready := LEAST(v_avail + v_my_reserved, v_line.quantity);
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
    'my_reserved', v_my_reserved,
    'qty_ready', v_qty_ready, 'qty_missing', v_qty_miss, 'classification', v_class,
    'product_can_be_purchased', v_prod.can_be_purchased,
    'product_can_be_manufactured', v_prod.can_be_manufactured,
    'has_active_bom', v_has_bom);
END $function$;

-- A11 fix #2: tg_zz_mo_done_replan agora resolve root_sale_order_id primeiro.
-- Mantém compatibilidade com supply_links e fallback para sale_order_id.
CREATE OR REPLACE FUNCTION public.tg_zz_mo_done_replan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_owner_so uuid;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    -- Preferência: root_sale_order_id (cobre MOs filhas geradas por mfg_plan_components)
    v_owner_so := NEW.root_sale_order_id;

    -- Em seguida: supply_link ativo
    IF v_owner_so IS NULL THEN
      SELECT sol.order_id INTO v_owner_so
        FROM sale_order_line_supply_links sl
        JOIN sale_order_lines sol ON sol.id = sl.sale_order_line_id
       WHERE sl.manufacturing_order_id = NEW.id AND sl.state='active' LIMIT 1;
    END IF;

    -- Fallback: sale_order_id direto na MO
    IF v_owner_so IS NULL THEN
      v_owner_so := NEW.sale_order_id;
    END IF;

    UPDATE sale_order_line_supply_links
      SET state='consumed', updated_at=now()
     WHERE manufacturing_order_id = NEW.id AND state='active';

    IF v_owner_so IS NOT NULL THEN
      BEGIN PERFORM so_run_operational_plan(v_owner_so,'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN PERFORM so_emit_timeline(v_owner_so,'manufacturing.done', NULL, NEW.id::text,
        jsonb_build_object('mo_id',NEW.id), 'replan'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- A12/A13 fix: asserções restritas a locations internas (excluindo supplier/customer/transit/inventory_loss).
CREATE OR REPLACE FUNCTION public._test_phase17_golden_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seed jsonb; v_report jsonb := '[]'::jsonb; v_gaps jsonb := '[]'::jsonb;
  v_cama uuid; v_estr uuid; v_tecido uuid; v_ripa uuid; v_travessa uuid;
  v_parafuso uuid; v_espuma uuid; v_ferr uuid; v_meca uuid;
  v_customer uuid; v_wh uuid;
  v_so uuid; v_sol uuid;
  v_mo_cama uuid; v_mo_estr uuid;
  v_pn_ids uuid[]; v_po_id uuid; v_rec jsonb; v_pick uuid;
  v_op uuid; v_rid uuid;
  v_ok int := 0; v_fail int := 0;
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_pass boolean; v_obs text;
  v_leaf_count int; v_leaf_expected uuid[];
  v_dup_cama int; v_dup_estr int;
  v_estr_comp_row record; v_cama_estr_comp record;
  v_sqlstate text; v_sqlerrm text; v_ctx text;
BEGIN
  v_seed := public._seed_golden_upm();
  v_cama := (v_seed->>'cama')::uuid;
  v_estr := (v_seed->>'estrutura')::uuid;
  v_tecido := (v_seed->'components'->>'tecido')::uuid;
  v_ripa := (v_seed->'components'->>'ripa')::uuid;
  v_travessa := (v_seed->'components'->>'travessa')::uuid;
  v_parafuso := (v_seed->'components'->>'parafuso')::uuid;
  v_espuma := (v_seed->'components'->>'espuma')::uuid;
  v_ferr := (v_seed->'components'->>'ferragens')::uuid;
  v_meca := (v_seed->'components'->>'mecanismo')::uuid;
  v_customer := (v_seed->>'customer')::uuid;
  v_wh := (v_seed->>'warehouse')::uuid;
  v_leaf_expected := ARRAY[v_ripa,v_travessa,v_parafuso,v_tecido,v_espuma,v_ferr,v_meca];

  v_report := v_report || jsonb_build_object('id','SEED','label','Fixture criada','status','OK','observed','cama='||v_cama::text);
  v_ok := v_ok + 1;

  -- A01
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'SO',v_customer,v_wh,'draft','delivery',1500,1500) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
    PERFORM public.confirm_sale_order(v_so);
    v_report := v_report || jsonb_build_object('id','A01','label','Venda confirmada','status','OK','observed','so='||v_so::text);
    v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A01','severity','P0','step','confirm_sale_order','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A01','label','Venda confirmada','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
    RETURN jsonb_build_object('ok',false,'asserts_ok',v_ok,'asserts_fail',v_fail,'report',v_report,'gaps',v_gaps,'stopped_at','A01');
  END;

  -- A02
  BEGIN
    SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    IF v_mo_cama IS NULL THEN
      PERFORM public.mfg_create_orders_for_sale(v_so);
      SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    END IF;
    v_pass := v_mo_cama IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.order_id WHERE pol.product_id=v_cama AND po.partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%'));
    v_obs := 'mo='||COALESCE(v_mo_cama::text,'NULL');
    v_report := v_report || jsonb_build_object('id','A02','label','MO mãe Cama (sem PO Cama)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A02','severity','P0','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A02','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A03
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      PERFORM public.mfg_plan_components(v_mo_cama, 0);
      SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;
    END IF;
    SELECT mc.* INTO v_cama_estr_comp FROM mo_components mc WHERE mc.mo_id=v_mo_cama AND mc.product_id=v_estr LIMIT 1;
    v_pass := v_mo_estr IS NOT NULL
      AND (SELECT parent_mo_id FROM manufacturing_orders WHERE id=v_mo_estr) = v_mo_cama
      AND (SELECT root_mo_id FROM manufacturing_orders WHERE id=v_mo_estr) = v_mo_cama
      AND v_cama_estr_comp.child_mo_id = v_mo_estr;
    v_obs := format('mo_estr=%s parent=%s parent_comp=%s root=%s child_mo_on_cama_comp=%s',
      COALESCE(v_mo_estr::text,'NULL'),
      COALESCE((SELECT parent_mo_id::text FROM manufacturing_orders WHERE id=v_mo_estr),'NULL'),
      COALESCE(v_cama_estr_comp.id::text,'NULL'),
      COALESCE((SELECT root_mo_id::text FROM manufacturing_orders WHERE id=v_mo_estr),'NULL'),
      COALESCE(v_cama_estr_comp.child_mo_id::text,'NULL'));
    v_report := v_report || jsonb_build_object('id','A03','label','MO filha Estrutura (links completos)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A03','severity','P0','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A03','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A04
  BEGIN
    SELECT count(*) INTO v_leaf_count FROM purchase_needs
     WHERE product_id = ANY(v_leaf_expected) AND state IN ('pending','quoting','approved')
       AND manufacturing_order_id IS NOT NULL;
    SELECT count(*) INTO v_dup_cama FROM purchase_needs WHERE product_id=v_cama AND state NOT IN ('cancelled');
    SELECT count(*) INTO v_dup_estr FROM purchase_needs WHERE product_id=v_estr AND state NOT IN ('cancelled');
    v_pass := v_leaf_count = 7 AND v_dup_cama = 0 AND v_dup_estr = 0;
    v_obs := format('leaves=%s cama_pn=%s estr_pn=%s', v_leaf_count, v_dup_cama, v_dup_estr);
    v_report := v_report || jsonb_build_object('id','A04','label','7 purchase_needs (folhas, sem Cama/Estrutura, com vínculo MO)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A05 purchase_needs_create_po
  BEGIN
    SELECT array_agg(id) INTO v_pn_ids FROM purchase_needs
     WHERE product_id = ANY(v_leaf_expected) AND state IN ('pending','quoting','approved');
    SELECT public.purchase_needs_create_po(v_pn_ids, NULL, NULL) INTO v_rec;
    v_po_id := NULLIF((v_rec->>'order_id'),'')::uuid;
    IF v_po_id IS NULL THEN
      SELECT (v_rec->'orders'->0->>'order_id')::uuid INTO v_po_id;
    END IF;
    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM purchase_orders WHERE origin LIKE v_pfx||'%' ORDER BY created_at DESC LIMIT 1;
    END IF;
    v_pass := v_po_id IS NOT NULL;
    v_obs := 'po='||COALESCE(v_po_id::text,'NULL');
    v_report := v_report || jsonb_build_object('id','A05','label','purchase_needs_create_po','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A05','severity','P1','sqlstate',v_sqlstate,'detail',v_sqlerrm);
    v_report := v_report || jsonb_build_object('id','A05','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A06 PO recebida (confirmar + validar picking incoming)
  BEGIN
    IF v_po_id IS NOT NULL THEN
      BEGIN UPDATE purchase_orders SET state='confirmed' WHERE id=v_po_id AND state<>'confirmed'; EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT id INTO v_pick FROM stock_pickings WHERE source_document=v_po_id::text OR origin LIKE '%'||(SELECT name FROM purchase_orders WHERE id=v_po_id)||'%' AND kind='incoming' ORDER BY created_at DESC LIMIT 1;
      IF v_pick IS NULL THEN
        SELECT id INTO v_pick FROM stock_pickings WHERE kind='incoming' AND partner_id IN (SELECT partner_id FROM purchase_orders WHERE id=v_po_id) ORDER BY created_at DESC LIMIT 1;
      END IF;
      IF v_pick IS NOT NULL THEN
        BEGIN PERFORM public.validate_picking(v_pick); EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;
    v_pass := v_pick IS NOT NULL AND (SELECT state::text FROM stock_pickings WHERE id=v_pick) = 'done';
    v_obs := format('pick=%s state=%s', COALESCE(v_pick::text,'NULL'), COALESCE((SELECT state::text FROM stock_pickings WHERE id=v_pick),'?'));
    v_report := v_report || jsonb_build_object('id','A06','label','PO recebida','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A06','severity','P1','sqlstate',v_sqlstate,'detail',v_sqlerrm);
    v_report := v_report || jsonb_build_object('id','A06','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A07 reserva pós-recebimento na MO Estrutura
  BEGIN
    v_pass := (SELECT COALESCE(SUM(qty_reserved),0) FROM mo_components WHERE mo_id=v_mo_estr) > 0;
    v_obs := 'reserved_sum='||COALESCE((SELECT SUM(qty_reserved)::text FROM mo_components WHERE mo_id=v_mo_estr),'0');
    v_report := v_report || jsonb_build_object('id','A07','label','Recebimento→reserva MO','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A08 close_mo Estrutura
  BEGIN
    IF v_mo_estr IS NOT NULL THEN
      PERFORM public.mfg_materialize_work_orders(v_mo_estr);
      FOR v_op IN SELECT id FROM mo_operations WHERE mo_id=v_mo_estr ORDER BY sequence LOOP
        BEGIN PERFORM public.work_order_start(v_op, NULL, NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN PERFORM public.work_order_finish(v_op, 1, 0, 'golden'); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN
          IF EXISTS (SELECT 1 FROM bom_operations bo JOIN mo_operations mo ON mo.operation_id=bo.id WHERE mo.id=v_op AND bo.requires_quality_check) THEN
            PERFORM public.work_order_quality_check(v_op, 'pass', 'ok');
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
      BEGIN PERFORM public.close_mo(v_mo_estr, 1); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    v_pass := v_mo_estr IS NOT NULL AND (SELECT state::text FROM manufacturing_orders WHERE id=v_mo_estr) = 'done';
    v_obs := 'state='||COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_estr),'?');
    v_report := v_report || jsonb_build_object('id','A08','label','close_mo Estrutura','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A08','severity','P1','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A08','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A09 close_mo Cama
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      PERFORM public.mfg_materialize_work_orders(v_mo_cama);
      FOR v_op IN SELECT id FROM mo_operations WHERE mo_id=v_mo_cama ORDER BY sequence LOOP
        BEGIN PERFORM public.work_order_start(v_op, NULL, NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN PERFORM public.work_order_finish(v_op, 1, 0, 'golden'); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN
          IF EXISTS (SELECT 1 FROM bom_operations bo JOIN mo_operations mo ON mo.operation_id=bo.id WHERE mo.id=v_op AND bo.requires_quality_check) THEN
            PERFORM public.work_order_quality_check(v_op, 'pass', 'ok');
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
      BEGIN PERFORM public.close_mo(v_mo_cama, 1); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    v_pass := v_mo_cama IS NOT NULL AND (SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama) = 'done';
    v_obs := 'state='||COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama),'?');
    v_report := v_report || jsonb_build_object('id','A09','label','close_mo Cama','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A09','severity','P1','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A09','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A10 stock_packages
  BEGIN
    v_pass := (SELECT count(*) FROM stock_packages WHERE product_id=v_cama AND manufacturing_order_id=v_mo_cama) >= 2;
    v_obs := 'pkgs='||COALESCE((SELECT count(*)::text FROM stock_packages WHERE product_id=v_cama),'0');
    v_report := v_report || jsonb_build_object('id','A10','label','stock_packages Cama (2 colis)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    v_report := v_report || jsonb_build_object('id','A10','status','GAP_P2','observed',SQLERRM);
  END;

  -- A11 SO ready_delivery
  BEGIN
    v_obs := COALESCE((SELECT operational_status FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_obs IN ('ready_delivery','ready','available');
    v_report := v_report || jsonb_build_object('id','A11','label','SO ready_delivery','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','op_status='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A12 stock interno negativo (exclui virtuais supplier/customer/transit/inventory_loss)
  v_pass := NOT EXISTS (
    SELECT 1 FROM stock_quants q
    JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')
      AND l.type = 'internal'
      AND q.quantity < 0
  );
  v_report := v_report || jsonb_build_object('id','A12','label','Sem stock_quant negativo (internas)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A13 reserved<=quantity (apenas internas)
  v_pass := NOT EXISTS (
    SELECT 1 FROM stock_quants q
    JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')
      AND l.type = 'internal'
      AND COALESCE(q.reserved_quantity,0) > q.quantity
  );
  v_report := v_report || jsonb_build_object('id','A13','label','reserved<=quantity (internas)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A14
  v_pass := NOT EXISTS (SELECT 1 FROM stock_packages WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND current_location_id IS NULL);
  v_report := v_report || jsonb_build_object('id','A14','label','Pkgs com localização','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A15
  v_pass := NOT EXISTS (
    SELECT 1 FROM (
      SELECT manufacturing_order_id, product_id, COALESCE(product_variant_id,'00000000-0000-0000-0000-000000000000'::uuid) v, count(*) c
      FROM purchase_needs
      WHERE product_id = ANY(v_leaf_expected)
      GROUP BY 1,2,3) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A15','label','Sem purchase_need duplicado','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A16
  v_pass := NOT EXISTS (
    SELECT 1 FROM (
      SELECT sale_order_line_id, count(*) c FROM manufacturing_orders
      WHERE sale_order_line_id=v_sol AND product_id=v_cama GROUP BY 1) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A16','label','Sem MO duplicada por SOL','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_gaps := v_gaps
    || jsonb_build_object('id','G_VAR','severity','P2','detail','Sistema de atributos/variantes não exercitado; Tecido Opera 02 modelado como produto distinto.')
    || jsonb_build_object('id','G_PAY','severity','P2','detail','Apenas 1 das 3 variações financeiras coberta automaticamente; split 50/50 e pré-pago a documentar.')
    || jsonb_build_object('id','G_DELIV','severity','P1','detail','Cadeia delivery_schedule→route→deliver não exercitada nesta corrida; depende de A11 verde.');

  IF _cleanup THEN
    PERFORM public._cleanup_golden_upm();
  END IF;

  RETURN jsonb_build_object(
    'ok', v_fail = 0,
    'asserts_ok', v_ok,
    'asserts_fail', v_fail,
    'asserts_total', v_ok + v_fail,
    'report', v_report,
    'gaps', v_gaps,
    'cleaned', _cleanup
  );
END
$function$;