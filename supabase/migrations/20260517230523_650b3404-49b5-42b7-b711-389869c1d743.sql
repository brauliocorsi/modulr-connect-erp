
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
  v_ok int := 0; v_fail int := 0;
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_pass boolean; v_obs text;
  v_leaf_count int; v_leaf_expected uuid[];
  v_dup_cama int; v_dup_estr int;
  v_estr_comp_row record; v_cama_estr_comp record;
  v_sqlstate text; v_sqlerrm text;
  v_cls jsonb;
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

  v_report := v_report || jsonb_build_object('id','SEED','status','OK','observed','cama='||v_cama::text);
  v_ok := v_ok + 1;

  -- A01
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'SO',v_customer,v_wh,'draft','delivery',1500,1500) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
    PERFORM public.confirm_sale_order(v_so);
    v_report := v_report || jsonb_build_object('id','A01','status','OK','observed','so='||v_so::text);
    v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A01','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A02
  BEGIN
    SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    v_pass := v_mo_cama IS NOT NULL
              AND NOT EXISTS(SELECT 1 FROM purchase_needs WHERE product_id=v_cama AND state<>'cancelled');
    v_report := v_report || jsonb_build_object('id','A02','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','mo='||COALESCE(v_mo_cama::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A03 MO filha Estrutura
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      BEGIN PERFORM public.mfg_plan_components(v_mo_cama, 0); EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;
    END IF;
    SELECT mc.* INTO v_cama_estr_comp FROM mo_components mc WHERE mc.mo_id=v_mo_cama AND mc.product_id=v_estr LIMIT 1;
    SELECT mo.* INTO v_estr_comp_row FROM manufacturing_orders mo WHERE mo.id=v_mo_estr;
    v_pass := v_mo_estr IS NOT NULL
              AND v_estr_comp_row.parent_mo_id = v_mo_cama
              AND v_estr_comp_row.root_mo_id = v_mo_cama
              AND v_cama_estr_comp.child_mo_id = v_mo_estr;
    v_obs := format('mo_estr=%s parent=%s root=%s child_mo_on_cama_comp=%s',
              COALESCE(v_mo_estr::text,'NULL'), v_estr_comp_row.parent_mo_id,
              v_estr_comp_row.root_mo_id, v_cama_estr_comp.child_mo_id);
    v_report := v_report || jsonb_build_object('id','A03','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_report := v_report || jsonb_build_object('id','A03','status','FAIL','observed',v_sqlstate||':'||v_sqlerrm);
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
    v_report := v_report || jsonb_build_object('id','A04','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A05
  BEGIN
    SELECT array_agg(id) INTO v_pn_ids FROM purchase_needs
     WHERE product_id = ANY(v_leaf_expected) AND state IN ('pending','quoting','approved');
    SELECT public.purchase_needs_create_po(v_pn_ids, NULL, NULL) INTO v_rec;
    SELECT (v_rec->'created'->0->>'purchase_order_id')::uuid INTO v_po_id;
    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM purchase_orders
       WHERE id IN (SELECT purchase_order_id FROM purchase_needs WHERE id = ANY(v_pn_ids) AND purchase_order_id IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1;
    END IF;
    v_pass := v_po_id IS NOT NULL;
    v_obs := 'po='||COALESCE(v_po_id::text,'NULL');
    v_report := v_report || jsonb_build_object('id','A05','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE, v_sqlerrm=MESSAGE_TEXT;
    v_gaps := v_gaps || jsonb_build_object('id','A05','severity','P1','sqlstate',v_sqlstate,'detail',v_sqlerrm);
    v_report := v_report || jsonb_build_object('id','A05','status','GAP_P1','observed',v_sqlstate||':'||v_sqlerrm);
    v_fail := v_fail + 1;
  END;

  -- A06
  BEGIN
    IF v_po_id IS NOT NULL THEN
      BEGIN UPDATE purchase_orders SET state='confirmed' WHERE id=v_po_id AND state<>'confirmed'; EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT id INTO v_pick FROM stock_pickings
        WHERE kind='incoming'
          AND (source_document=v_po_id::text OR origin = (SELECT name FROM purchase_orders WHERE id=v_po_id))
        ORDER BY created_at DESC LIMIT 1;
      IF v_pick IS NULL THEN
        SELECT id INTO v_pick FROM stock_pickings
          WHERE kind='incoming' AND partner_id=(SELECT partner_id FROM purchase_orders WHERE id=v_po_id)
          ORDER BY created_at DESC LIMIT 1;
      END IF;
      IF v_pick IS NOT NULL THEN
        BEGIN
          UPDATE stock_moves SET quantity_done = quantity WHERE picking_id=v_pick AND state<>'done';
          PERFORM public.validate_picking(v_pick);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;
    v_pass := v_pick IS NOT NULL AND (SELECT state FROM stock_pickings WHERE id=v_pick) = 'done';
    v_obs := 'pick='||COALESCE(v_pick::text,'NULL')||' state='||COALESCE((SELECT state::text FROM stock_pickings WHERE id=v_pick),'?');
    v_report := v_report || jsonb_build_object('id','A06','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A07
  BEGIN
    v_obs := (SELECT COALESCE(SUM(qty_reserved),0)::text FROM mo_components WHERE mo_id=v_mo_estr);
    v_pass := v_obs::numeric > 0;
    v_report := v_report || jsonb_build_object('id','A07','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','reserved_sum='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A08 Estrutura
  BEGIN
    BEGIN PERFORM public.close_manufacturing_order(v_mo_estr); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_estr),'?');
    v_pass := v_obs = 'done';
    v_report := v_report || jsonb_build_object('id','A08','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','state='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A09 Cama
  BEGIN
    BEGIN PERFORM public.close_manufacturing_order(v_mo_cama); EXCEPTION WHEN OTHERS THEN NULL; END;
    v_obs := COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama),'?');
    v_pass := v_obs = 'done';
    v_report := v_report || jsonb_build_object('id','A09','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','state='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A10
  BEGIN
    v_pass := (SELECT count(*) FROM stock_packages WHERE product_id=v_cama AND manufacturing_order_id=v_mo_cama) >= 2;
    v_obs := 'pkgs='||COALESCE((SELECT count(*)::text FROM stock_packages WHERE product_id=v_cama),'0');
    v_report := v_report || jsonb_build_object('id','A10','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    v_report := v_report || jsonb_build_object('id','A10','status','GAP_P2','observed',SQLERRM);
  END;

  -- A11
  BEGIN
    v_obs := COALESCE((SELECT operational_status FROM sale_orders WHERE id=v_so),'?');
    v_pass := v_obs IN ('ready_delivery','ready','available');
    v_report := v_report || jsonb_build_object('id','A11','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','op_status='||v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A12
  v_pass := NOT EXISTS (
    SELECT 1 FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')
      AND l.type = 'internal' AND q.quantity < 0);
  v_report := v_report || jsonb_build_object('id','A12','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A13
  v_pass := NOT EXISTS (
    SELECT 1 FROM stock_quants q JOIN stock_locations l ON l.id=q.location_id
    WHERE q.product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')
      AND l.type = 'internal' AND COALESCE(q.reserved_quantity,0) > q.quantity);
  v_report := v_report || jsonb_build_object('id','A13','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A14
  v_pass := NOT EXISTS (SELECT 1 FROM stock_packages WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') AND current_location_id IS NULL);
  v_report := v_report || jsonb_build_object('id','A14','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A15
  v_pass := NOT EXISTS (
    SELECT 1 FROM (
      SELECT manufacturing_order_id, product_id, COALESCE(product_variant_id,'00000000-0000-0000-0000-000000000000'::uuid) v, count(*) c
      FROM purchase_needs WHERE product_id = ANY(v_leaf_expected)
      GROUP BY 1,2,3) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A15','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A16
  v_pass := NOT EXISTS (
    SELECT 1 FROM (SELECT sale_order_line_id, count(*) c FROM manufacturing_orders
      WHERE sale_order_line_id=v_sol AND product_id=v_cama GROUP BY 1) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A16','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- A17 invariant defensivo
  BEGIN
    v_cls := public.so_classify_line(v_sol);
    v_pass := COALESCE((v_cls->>'my_reserved_backed')::numeric,0) <= COALESCE((v_cls->>'physical_internal_qty')::numeric,0);
    v_obs := format('mr_raw=%s mr_backed=%s phys_int=%s qty_ready=%s cls=%s',
              v_cls->>'my_reserved_raw', v_cls->>'my_reserved_backed',
              v_cls->>'physical_internal_qty', v_cls->>'qty_ready', v_cls->>'classification');
    v_report := v_report || jsonb_build_object('id','A17','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  -- A18
  BEGIN
    v_cls := public.so_classify_line(v_sol);
    v_pass := NOT (
      (v_cls->>'classification') = 'ready_stock'
      AND COALESCE((v_cls->>'physical_internal_qty')::numeric,0) <= 0
      AND COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama),'?') <> 'done'
    );
    v_obs := format('cls=%s phys=%s mo_cama=%s', v_cls->>'classification',
              v_cls->>'physical_internal_qty',
              COALESCE((SELECT state::text FROM manufacturing_orders WHERE id=v_mo_cama),'?'));
    v_report := v_report || jsonb_build_object('id','A18','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN v_fail:=v_fail+1; END;

  v_gaps := v_gaps
    || jsonb_build_object('id','G_VAR','severity','P2','detail','Sistema de atributos/variantes não exercitado.')
    || jsonb_build_object('id','G_PAY','severity','P2','detail','Split 50/50 e pré-pago a documentar.')
    || jsonb_build_object('id','G_DELIV','severity','P1','detail','Cadeia delivery_schedule→route→deliver não exercitada; depende A11 verde.');

  IF _cleanup THEN PERFORM public._cleanup_golden_upm(); END IF;

  RETURN jsonb_build_object(
    'ok', v_fail = 0, 'asserts_ok', v_ok, 'asserts_fail', v_fail,
    'asserts_total', v_ok + v_fail, 'report', v_report, 'gaps', v_gaps, 'cleaned', _cleanup);
END
$function$;
