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

  -- A01 SO + confirm
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

  -- A02 MO mãe
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
    v_gaps := v_gaps || jsonb_build_object('id','A02','severity','P0','step','mfg_create_orders_for_sale','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A02','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A03 MO filha (depth=0, sem swallow)
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      PERFORM public.mfg_plan_components(v_mo_cama, 0);
      SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;
      SELECT mc.* INTO v_cama_estr_comp FROM mo_components mc WHERE mc.mo_id=v_mo_cama AND mc.product_id=v_estr LIMIT 1;
      SELECT mo.* INTO v_estr_comp_row FROM manufacturing_orders mo WHERE mo.id=v_mo_estr;
    END IF;
    v_pass := v_mo_estr IS NOT NULL
      AND v_estr_comp_row.parent_mo_id = v_mo_cama
      AND v_estr_comp_row.parent_mo_component_id IS NOT NULL
      AND v_estr_comp_row.root_mo_id IS NOT NULL
      AND v_cama_estr_comp.child_mo_id = v_mo_estr;
    v_obs := 'mo_estr='||COALESCE(v_mo_estr::text,'NULL')
      ||' parent='||COALESCE(v_estr_comp_row.parent_mo_id::text,'NULL')
      ||' parent_comp='||COALESCE(v_estr_comp_row.parent_mo_component_id::text,'NULL')
      ||' root='||COALESCE(v_estr_comp_row.root_mo_id::text,'NULL')
      ||' child_mo_on_cama_comp='||COALESCE(v_cama_estr_comp.child_mo_id::text,'NULL');
    v_report := v_report || jsonb_build_object('id','A03','label','MO filha Estrutura (links completos)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A03','severity','P0','step','mfg_plan_components','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A03','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A04 purchase_needs: exatamente 7 folhas, zero p/ Cama ou Estrutura, vínculos corretos
  BEGIN
    SELECT count(*) INTO v_dup_cama FROM purchase_needs WHERE product_id = v_cama;
    SELECT count(*) INTO v_dup_estr FROM purchase_needs WHERE product_id = v_estr;
    SELECT count(*) INTO v_leaf_count FROM purchase_needs WHERE product_id = ANY(v_leaf_expected);
    v_pass := v_leaf_count = 7
      AND v_dup_cama = 0
      AND v_dup_estr = 0
      AND NOT EXISTS (
        SELECT 1 FROM purchase_needs pn
        WHERE pn.product_id = ANY(v_leaf_expected)
          AND (pn.manufacturing_order_id IS NULL OR pn.mo_component_id IS NULL)
      );
    v_obs := 'leaves='||v_leaf_count||' cama_pn='||v_dup_cama||' estr_pn='||v_dup_estr;
    v_report := v_report || jsonb_build_object('id','A04','label','7 purchase_needs (folhas, sem Cama/Estrutura, com vínculo MO)','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A04','severity','P0','step','purchase_needs_check','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A04','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A05 purchase_needs_create_po
  BEGIN
    SELECT array_agg(id) INTO v_pn_ids FROM purchase_needs
      WHERE product_id = ANY(v_leaf_expected);
    IF v_pn_ids IS NOT NULL AND array_length(v_pn_ids,1) > 0 THEN
      v_rec := public.purchase_needs_create_po(v_pn_ids, (v_seed->'suppliers'->>'tecidos')::uuid, CURRENT_DATE + 7);
      v_po_id := COALESCE((v_rec->>'purchase_order_id')::uuid, (v_rec->>'po_id')::uuid, (v_rec->>'id')::uuid);
      IF v_po_id IS NULL THEN
        SELECT id INTO v_po_id FROM purchase_orders WHERE partner_id=(v_seed->'suppliers'->>'tecidos')::uuid ORDER BY created_at DESC LIMIT 1;
      END IF;
    END IF;
    v_pass := v_po_id IS NOT NULL AND EXISTS (SELECT 1 FROM purchase_needs WHERE id = ANY(v_pn_ids) AND purchase_order_id IS NOT NULL);
    v_obs := 'po='||COALESCE(v_po_id::text,'NULL');
    v_report := v_report || jsonb_build_object('id','A05','label','purchase_needs_create_po','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A05','severity','P0','step','purchase_needs_create_po','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A05','status','GAP_P0','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A06 confirm + receive
  BEGIN
    IF v_po_id IS NOT NULL THEN
      PERFORM public.confirm_purchase_order(v_po_id);
      SELECT sp.id INTO v_pick FROM stock_pickings sp JOIN purchase_orders po ON po.name=sp.origin WHERE po.id=v_po_id AND sp.kind='incoming' LIMIT 1;
      IF v_pick IS NOT NULL THEN
        UPDATE stock_moves SET quantity_done = quantity WHERE picking_id=v_pick AND state <> 'cancelled';
        PERFORM public.validate_picking(v_pick);
      END IF;
      v_pass := v_pick IS NOT NULL AND (SELECT state::text FROM stock_pickings WHERE id=v_pick) = 'done';
      v_obs := 'pick='||COALESCE(v_pick::text,'NULL')||' state='||COALESCE((SELECT state::text FROM stock_pickings WHERE id=v_pick),'?');
    ELSE
      v_pass := false; v_obs := 'sem PO';
    END IF;
    v_report := v_report || jsonb_build_object('id','A06','label','PO recebida','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A06','severity','P1','step','validate_picking','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A06','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A07 reserva componentes
  BEGIN
    IF v_mo_estr IS NOT NULL THEN
      FOR v_rid IN SELECT id FROM mo_components WHERE mo_id=v_mo_estr LOOP
        PERFORM public.mfg_refresh_component(v_rid);
      END LOOP;
    END IF;
    IF v_mo_cama IS NOT NULL THEN
      FOR v_rid IN SELECT id FROM mo_components WHERE mo_id=v_mo_cama LOOP
        PERFORM public.mfg_refresh_component(v_rid);
      END LOOP;
    END IF;
    v_pass := COALESCE((SELECT bool_or(qty_reserved>0) FROM mo_components WHERE mo_id IN (v_mo_estr,v_mo_cama)),false);
    v_obs := 'reserved_sum='||COALESCE((SELECT sum(qty_reserved)::text FROM mo_components WHERE mo_id IN (v_mo_estr,v_mo_cama)),'0');
    v_report := v_report || jsonb_build_object('id','A07','label','Recebimento→reserva MO','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A07','severity','P1','step','mfg_refresh_component','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
    v_report := v_report || jsonb_build_object('id','A07','status','GAP_P1','observed',v_sqlerrm);
    v_fail := v_fail + 1;
  END;

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
    v_gaps := v_gaps || jsonb_build_object('id','A08','severity','P1','step','close_mo_estr','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
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
    v_gaps := v_gaps || jsonb_build_object('id','A09','severity','P1','step','close_mo_cama','sqlstate',v_sqlstate,'detail',v_sqlerrm,'context',v_ctx);
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

  -- A12..A16 invariantes
  v_pass := NOT EXISTS (SELECT 1 FROM stock_quants q WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND q.quantity < 0);
  v_report := v_report || jsonb_build_object('id','A12','label','Sem stock_quant negativo','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_quants q WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND COALESCE(q.reserved_quantity,0) > q.quantity);
  v_report := v_report || jsonb_build_object('id','A13','label','reserved<=quantity','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (SELECT 1 FROM stock_packages WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND current_location_id IS NULL);
  v_report := v_report || jsonb_build_object('id','A14','label','Pkgs com localização','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (
    SELECT 1 FROM (
      SELECT manufacturing_order_id, product_id, COALESCE(product_variant_id,'00000000-0000-0000-0000-000000000000'::uuid) v, count(*) c
      FROM purchase_needs
      WHERE product_id = ANY(v_leaf_expected)
      GROUP BY 1,2,3) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A15','label','Sem purchase_need duplicado','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

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