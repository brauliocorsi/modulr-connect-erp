-- ============================================================
-- Phase 17 — Golden Flow Operacional UP Móveis
-- ============================================================

-- ---------- 1. FK-ordered cleanup ----------
CREATE OR REPLACE FUNCTION public._cleanup_golden_upm()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_pfx text := 'TESTE_GOLDEN_UPM_';
BEGIN
  BEGIN DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM customer_payments WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM cash_sessions WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_route_orders WHERE schedule_id IN (SELECT id FROM delivery_schedules WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM delivery_schedules WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_packages WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%') OR manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_package_templates WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_workorder_logs WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_issues WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_quality_checks WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%')); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_orders WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_needs WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_order_lines WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM purchase_orders WHERE partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_moves WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_pickings WHERE origin LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_payment_schedules WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM sale_orders WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM bom_operations WHERE bom_id IN (SELECT id FROM boms WHERE code LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM boms WHERE code LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM manufacturing_machines WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM work_centers WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM product_suppliers WHERE product_id IN (SELECT id FROM products WHERE name LIKE v_pfx||'%') OR partner_id IN (SELECT id FROM partners WHERE name LIKE v_pfx||'%'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM products WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM partners WHERE name LIKE v_pfx||'%'; EXCEPTION WHEN OTHERS THEN NULL; END;
END
$fn$;

GRANT EXECUTE ON FUNCTION public._cleanup_golden_upm() TO service_role;

-- ---------- 2. Seed fixture ----------
CREATE OR REPLACE FUNCTION public._seed_golden_upm()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_wh uuid; v_uom uuid; v_cat uuid; v_loc_stock uuid;
  v_cama uuid; v_estr uuid; v_tecido uuid; v_ripa uuid; v_espuma uuid;
  v_ferr uuid; v_meca uuid; v_travessa uuid; v_parafuso uuid;
  v_fornA uuid; v_fornB uuid; v_customer uuid;
  v_bom_cama uuid; v_bom_estr uuid;
  v_wc_corte uuid; v_wc_mont uuid; v_wc_estof uuid; v_wc_emb uuid; v_wc_qa uuid;
  v_mach_corte uuid;
BEGIN
  PERFORM public._cleanup_golden_upm();

  SELECT id INTO v_wh FROM warehouses LIMIT 1;
  SELECT id INTO v_uom FROM product_uom LIMIT 1;
  SELECT id INTO v_cat FROM product_categories LIMIT 1;
  SELECT id INTO v_loc_stock FROM stock_locations WHERE name='Stock' LIMIT 1;

  INSERT INTO partners(name,kind,is_supplier,active) VALUES (v_pfx||'FORN_TECIDOS','company',true,true) RETURNING id INTO v_fornA;
  INSERT INTO partners(name,kind,is_supplier,active) VALUES (v_pfx||'FORN_MADEIRAS','company',true,true) RETURNING id INTO v_fornB;
  INSERT INTO partners(name,kind,is_customer,active) VALUES (v_pfx||'CLIENTE','individual',true,true) RETURNING id INTO v_customer;

  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'TECIDO_OPERA','storable',v_cat,v_uom,15,8,false,true,false,'none',true) RETURNING id INTO v_tecido;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'RIPA_MADEIRA','storable',v_cat,v_uom,3,1,false,true,false,'none',true) RETURNING id INTO v_ripa;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'TRAVESSA','storable',v_cat,v_uom,5,2,false,true,false,'none',true) RETURNING id INTO v_travessa;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'PARAFUSO','storable',v_cat,v_uom,1,0.2,false,true,false,'none',true) RETURNING id INTO v_parafuso;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'ESPUMA','storable',v_cat,v_uom,20,10,false,true,false,'none',true) RETURNING id INTO v_espuma;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'FERRAGENS','storable',v_cat,v_uom,8,3,false,true,false,'none',true) RETURNING id INTO v_ferr;
  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,tracking,active)
    VALUES (v_pfx||'MECANISMO','storable',v_cat,v_uom,50,25,false,true,false,'none',true) RETURNING id INTO v_meca;

  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,requires_bom,supply_route,tracking,active)
    VALUES (v_pfx||'ESTRUTURA_160','storable',v_cat,v_uom,80,30,false,false,true,true,'manufacture','none',true) RETURNING id INTO v_estr;

  INSERT INTO products(name,type,category_id,uom_id,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,requires_bom,supply_route,package_tracking_enabled,tracking,active)
    VALUES (v_pfx||'CAMA_ARMANI','storable',v_cat,v_uom,1500,400,true,false,true,true,'manufacture',true,'none',true) RETURNING id INTO v_cama;

  INSERT INTO product_suppliers(product_id,partner_id,price,min_qty,lead_time_days,priority) VALUES
    (v_tecido,v_fornA,15,1,5,1),(v_espuma,v_fornA,20,1,5,1),
    (v_ripa,v_fornB,3,1,7,1),(v_travessa,v_fornB,5,1,7,1),(v_parafuso,v_fornB,1,1,7,1),
    (v_ferr,v_fornB,8,1,7,1),(v_meca,v_fornA,50,1,10,1);

  INSERT INTO work_centers(name,code,warehouse_id,active) VALUES (v_pfx||'WC_CORTE','GUPM_CORTE',v_wh,true) RETURNING id INTO v_wc_corte;
  INSERT INTO work_centers(name,code,warehouse_id,active) VALUES (v_pfx||'WC_MONT','GUPM_MONT',v_wh,true) RETURNING id INTO v_wc_mont;
  INSERT INTO work_centers(name,code,warehouse_id,active) VALUES (v_pfx||'WC_ESTOF','GUPM_ESTOF',v_wh,true) RETURNING id INTO v_wc_estof;
  INSERT INTO work_centers(name,code,warehouse_id,active) VALUES (v_pfx||'WC_EMB','GUPM_EMB',v_wh,true) RETURNING id INTO v_wc_emb;
  INSERT INTO work_centers(name,code,warehouse_id,active) VALUES (v_pfx||'WC_QA','GUPM_QA',v_wh,true) RETURNING id INTO v_wc_qa;

  INSERT INTO manufacturing_machines(work_center_id,name,code,status,active)
    VALUES (v_wc_corte,v_pfx||'MACH_CORTE','GUPM_M1','available',true) RETURNING id INTO v_mach_corte;

  INSERT INTO boms(product_id,type,quantity,uom_id,active,code)
    VALUES (v_estr,'normal',1,v_uom,true,v_pfx||'BOM_ESTR') RETURNING id INTO v_bom_estr;
  INSERT INTO bom_operations(bom_id,sequence,name,work_center_id,duration_minutes)
    VALUES (v_bom_estr,10,'Corte',v_wc_corte,15);
  INSERT INTO bom_operations(bom_id,sequence,name,work_center_id,duration_minutes,requires_quality_check)
    VALUES (v_bom_estr,20,'Montagem Estrutura',v_wc_mont,30,true);
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,uom_id,is_critical) VALUES
    (v_bom_estr,v_ripa,8,v_uom,true),(v_bom_estr,v_travessa,4,v_uom,true),(v_bom_estr,v_parafuso,40,v_uom,false);

  INSERT INTO boms(product_id,type,quantity,uom_id,active,code)
    VALUES (v_cama,'normal',1,v_uom,true,v_pfx||'BOM_CAMA') RETURNING id INTO v_bom_cama;
  INSERT INTO bom_operations(bom_id,sequence,name,work_center_id,duration_minutes) VALUES
    (v_bom_cama,10,'Estofamento',v_wc_estof,45),
    (v_bom_cama,20,'Montagem Final',v_wc_mont,30);
  INSERT INTO bom_operations(bom_id,sequence,name,work_center_id,duration_minutes,requires_quality_check)
    VALUES (v_bom_cama,30,'Qualidade',v_wc_qa,10,true);
  INSERT INTO bom_operations(bom_id,sequence,name,work_center_id,duration_minutes)
    VALUES (v_bom_cama,40,'Embalagem',v_wc_emb,20);
  INSERT INTO bom_lines(bom_id,component_product_id,quantity,uom_id,is_critical) VALUES
    (v_bom_cama,v_estr,1,v_uom,true),(v_bom_cama,v_tecido,6,v_uom,true),
    (v_bom_cama,v_espuma,2,v_uom,true),(v_bom_cama,v_ferr,1,v_uom,false),
    (v_bom_cama,v_meca,1,v_uom,true);

  INSERT INTO product_package_templates(product_id,name,package_sequence,package_total,default_weight_kg,default_volume_m3,default_assembly_minutes,requires_assembly,is_required,active) VALUES
    (v_cama,'Colis 1/2 Cabeceira',1,2,15,0.20,30,true,true,true),
    (v_cama,'Colis 2/2 Base',2,2,40,0.60,30,true,true,true);

  RETURN jsonb_build_object(
    'ok',true,'pfx',v_pfx,
    'cama',v_cama,'estrutura',v_estr,
    'components', jsonb_build_object(
      'tecido',v_tecido,'ripa',v_ripa,'travessa',v_travessa,
      'parafuso',v_parafuso,'espuma',v_espuma,'ferragens',v_ferr,'mecanismo',v_meca),
    'suppliers', jsonb_build_object('tecidos',v_fornA,'madeiras',v_fornB),
    'customer',v_customer,
    'bom_cama',v_bom_cama,'bom_estrutura',v_bom_estr,
    'warehouse',v_wh,'stock_location',v_loc_stock);
END
$fn$;

GRANT EXECUTE ON FUNCTION public._seed_golden_upm() TO service_role;

-- ---------- 3. Golden flow runner ----------
CREATE OR REPLACE FUNCTION public._test_phase17_golden_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    v_gaps := v_gaps || jsonb_build_object('id','A01','severity','P0','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A01','label','Venda confirmada','status','GAP_P0','observed',SQLERRM);
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
    v_gaps := v_gaps || jsonb_build_object('id','A02','severity','P0','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A02','status','GAP_P0','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A03 MO filha
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      BEGIN PERFORM public.mfg_plan_components(v_mo_cama, 3); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN PERFORM public._mfg_materialize_child_components(v_mo_cama); EXCEPTION WHEN OTHERS THEN NULL; END;
      SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;
    END IF;
    v_pass := v_mo_estr IS NOT NULL;
    v_report := v_report || jsonb_build_object('id','A03','label','MO filha Estrutura','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','mo_estr='||COALESCE(v_mo_estr::text,'NULL'));
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_gaps := v_gaps || jsonb_build_object('id','A03','severity','P1','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A03','status','GAP_P1','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A04 purchase_needs
  BEGIN
    IF v_mo_cama IS NOT NULL THEN BEGIN PERFORM public.mfg_create_needs_for_mo(v_mo_cama); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
    IF v_mo_estr IS NOT NULL THEN BEGIN PERFORM public.mfg_create_needs_for_mo(v_mo_estr); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
    v_pass := EXISTS (SELECT 1 FROM purchase_needs WHERE product_id IN (v_tecido,v_ripa,v_travessa,v_parafuso,v_espuma,v_ferr,v_meca));
    v_obs := 'count='||(SELECT count(*)::text FROM purchase_needs WHERE product_id IN (v_tecido,v_ripa,v_travessa,v_parafuso,v_espuma,v_ferr,v_meca));
    v_report := v_report || jsonb_build_object('id','A04','label','purchase_needs criadas','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_gaps := v_gaps || jsonb_build_object('id','A04','severity','P0','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A04','status','GAP_P0','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A05 purchase_needs_create_po
  BEGIN
    SELECT array_agg(id) INTO v_pn_ids FROM purchase_needs
      WHERE product_id IN (v_tecido,v_ripa,v_travessa,v_parafuso,v_espuma,v_ferr,v_meca);
    IF v_pn_ids IS NOT NULL AND array_length(v_pn_ids,1) > 0 THEN
      v_rec := public.purchase_needs_create_po(v_pn_ids, (v_seed->'suppliers'->>'tecidos')::uuid, CURRENT_DATE + 7);
      v_po_id := COALESCE((v_rec->>'purchase_order_id')::uuid, (v_rec->>'po_id')::uuid, (v_rec->>'id')::uuid);
      IF v_po_id IS NULL THEN
        SELECT id INTO v_po_id FROM purchase_orders WHERE partner_id=(v_seed->'suppliers'->>'tecidos')::uuid ORDER BY created_at DESC LIMIT 1;
      END IF;
    END IF;
    v_pass := v_po_id IS NOT NULL AND EXISTS (SELECT 1 FROM purchase_needs WHERE id = ANY(v_pn_ids) AND purchase_order_id IS NOT NULL);
    v_obs := 'po='||COALESCE(v_po_id::text,'NULL')||' rpc_keys='||COALESCE((SELECT string_agg(k,',') FROM jsonb_object_keys(v_rec) k),'?');
    v_report := v_report || jsonb_build_object('id','A05','label','purchase_needs_create_po','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_gaps := v_gaps || jsonb_build_object('id','A05','severity','P0','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A05','status','GAP_P0','observed',SQLERRM);
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
    v_gaps := v_gaps || jsonb_build_object('id','A06','severity','P1','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A06','status','GAP_P1','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A07 reserva componentes
  BEGIN
    IF v_mo_estr IS NOT NULL THEN
      FOR v_rid IN SELECT id FROM mo_components WHERE mo_id=v_mo_estr LOOP
        BEGIN PERFORM public.mfg_refresh_component(v_rid); EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
    END IF;
    IF v_mo_cama IS NOT NULL THEN
      FOR v_rid IN SELECT id FROM mo_components WHERE mo_id=v_mo_cama LOOP
        BEGIN PERFORM public.mfg_refresh_component(v_rid); EXCEPTION WHEN OTHERS THEN NULL; END;
      END LOOP;
    END IF;
    v_pass := COALESCE((SELECT bool_or(qty_reserved>0) FROM mo_components WHERE mo_id IN (v_mo_estr,v_mo_cama)),false);
    v_obs := 'reserved_sum='||COALESCE((SELECT sum(qty_reserved)::text FROM mo_components WHERE mo_id IN (v_mo_estr,v_mo_cama)),'0');
    v_report := v_report || jsonb_build_object('id','A07','label','Recebimento→reserva MO','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed',v_obs);
    IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_gaps := v_gaps || jsonb_build_object('id','A07','severity','P1','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A07','status','GAP_P1','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A08 close_mo Estrutura
  BEGIN
    IF v_mo_estr IS NOT NULL THEN
      BEGIN PERFORM public.mfg_materialize_work_orders(v_mo_estr); EXCEPTION WHEN OTHERS THEN NULL; END;
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
    v_gaps := v_gaps || jsonb_build_object('id','A08','severity','P1','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A08','status','GAP_P1','observed',SQLERRM);
    v_fail := v_fail + 1;
  END;

  -- A09 close_mo Cama
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      BEGIN PERFORM public.mfg_materialize_work_orders(v_mo_cama); EXCEPTION WHEN OTHERS THEN NULL; END;
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
    v_gaps := v_gaps || jsonb_build_object('id','A09','severity','P1','detail',SQLERRM);
    v_report := v_report || jsonb_build_object('id','A09','status','GAP_P1','observed',SQLERRM);
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
      WHERE product_id IN (v_tecido,v_ripa,v_travessa,v_parafuso,v_espuma,v_ferr,v_meca)
      GROUP BY 1,2,3) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A15','label','Sem purchase_need duplicado','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  v_pass := NOT EXISTS (
    SELECT 1 FROM (
      SELECT sale_order_line_id, count(*) c FROM manufacturing_orders
      WHERE sale_order_line_id=v_sol AND product_id=v_cama GROUP BY 1) x WHERE c > 1);
  v_report := v_report || jsonb_build_object('id','A16','label','Sem MO duplicada por SOL','status',CASE WHEN v_pass THEN 'OK' ELSE 'FAIL' END,'observed','');
  IF v_pass THEN v_ok:=v_ok+1; ELSE v_fail:=v_fail+1; END IF;

  -- Documented gaps (out-of-scope nesta corrida)
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
$fn$;

GRANT EXECUTE ON FUNCTION public._test_phase17_golden_flow(boolean) TO service_role;