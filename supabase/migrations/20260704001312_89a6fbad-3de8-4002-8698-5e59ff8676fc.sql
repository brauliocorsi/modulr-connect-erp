
CREATE OR REPLACE FUNCTION public._test_costing_mfg()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wh uuid; v_loc_int uuid; v_loc_cust uuid;
  v_comp1 uuid; v_comp2 uuid; v_finished uuid; v_semi uuid;
  v_wc uuid; v_partner uuid;
  v_mo uuid; v_mo_child uuid; v_mo_parent uuid;
  v_comp1_id uuid; v_comp2_id uuid;
  v_mo_row record; v_prod record; v_margin record;
  v_so uuid; v_pick uuid; v_out_sm uuid;
  a_ok boolean; b_ok boolean; c_ok boolean; d_ok boolean; e_ok boolean;
  v_results jsonb := '{}'::jsonb;
  v_del_prod uuid;
  v_rr jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_wh FROM public.warehouses LIMIT 1;
  IF v_wh IS NULL THEN INSERT INTO public.warehouses(name,code) VALUES ('TC-WH','TCWH') RETURNING id INTO v_wh; END IF;
  SELECT id INTO v_loc_int FROM public.stock_locations WHERE type='internal' AND warehouse_id=v_wh LIMIT 1;
  IF v_loc_int IS NULL THEN INSERT INTO public.stock_locations(name,type,warehouse_id) VALUES ('TC-INT','internal',v_wh) RETURNING id INTO v_loc_int; END IF;
  SELECT id INTO v_loc_cust FROM public.stock_locations WHERE type='customer' LIMIT 1;
  IF v_loc_cust IS NULL THEN INSERT INTO public.stock_locations(name,type) VALUES ('TC-CUST','customer') RETURNING id INTO v_loc_cust; END IF;
  INSERT INTO public.stock_locations(name,type,warehouse_id)
  SELECT 'FinishedGoods','internal',v_wh
   WHERE NOT EXISTS (SELECT 1 FROM public.stock_locations WHERE warehouse_id=v_wh AND name='FinishedGoods');

  INSERT INTO public.work_centers(name,code,type,cost_per_hour,active)
  VALUES ('TC-WC-'||substr(gen_random_uuid()::text,1,6),'TCWC-'||substr(gen_random_uuid()::text,1,4),'assembly',30,true) RETURNING id INTO v_wc;

  INSERT INTO public.products(name,internal_ref,type,active,standard_cost,last_cost)
  VALUES ('TC-C1-'||substr(gen_random_uuid()::text,1,6),'C1-'||substr(gen_random_uuid()::text,1,6),'storable',true,0,10) RETURNING id INTO v_comp1;
  INSERT INTO public.products(name,internal_ref,type,active,standard_cost,last_cost)
  VALUES ('TC-C2-'||substr(gen_random_uuid()::text,1,6),'C2-'||substr(gen_random_uuid()::text,1,6),'storable',true,0,5) RETURNING id INTO v_comp2;
  INSERT INTO public.products(name,internal_ref,type,active,standard_cost,list_price)
  VALUES ('TC-FIN-'||substr(gen_random_uuid()::text,1,6),'F-'||substr(gen_random_uuid()::text,1,6),'storable',true,0,200) RETURNING id INTO v_finished;

  INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity)
  VALUES (v_comp1,v_loc_int,100,0),(v_comp2,v_loc_int,100,0);

  -- a) simple MO
  INSERT INTO public.manufacturing_orders(code,product_id,qty,warehouse_id,state)
  VALUES ('MO-TC-'||substr(gen_random_uuid()::text,1,6),v_finished,1,v_wh,'in_progress') RETURNING id INTO v_mo;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required,qty_reserved,sequence) VALUES (v_mo,v_comp1,2,2,1) RETURNING id INTO v_comp1_id;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required,qty_reserved,sequence) VALUES (v_mo,v_comp2,3,3,2) RETURNING id INTO v_comp2_id;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+2 WHERE product_id=v_comp1 AND location_id=v_loc_int;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+3 WHERE product_id=v_comp2 AND location_id=v_loc_int;
  INSERT INTO public.stock_moves(product_id,source_location_id,destination_location_id,quantity,reserved_quantity,state,mo_component_id)
  VALUES (v_comp1,v_loc_int,v_loc_int,2,2,'ready',v_comp1_id);
  INSERT INTO public.stock_moves(product_id,source_location_id,destination_location_id,quantity,reserved_quantity,state,mo_component_id)
  VALUES (v_comp2,v_loc_int,v_loc_int,3,3,'ready',v_comp2_id);
  INSERT INTO public.mo_operations(mo_id,sequence,name,planned_minutes,state,work_center_id) VALUES (v_mo,1,'Assembly',60,'done',v_wc);
  PERFORM public.close_mo(v_mo);
  SELECT * INTO v_mo_row FROM public.manufacturing_orders WHERE id=v_mo;
  a_ok := (v_mo_row.material_cost=35 AND v_mo_row.labor_cost=30 AND v_mo_row.total_cost=65 AND v_mo_row.unit_cost=65);
  v_results := v_results || jsonb_build_object('a_simple_mo', jsonb_build_object(
    'ok',a_ok,'material',v_mo_row.material_cost,'labor',v_mo_row.labor_cost,'total',v_mo_row.total_cost,'unit',v_mo_row.unit_cost));

  -- c) product updated
  SELECT last_cost, average_cost INTO v_prod FROM public.products WHERE id=v_finished;
  c_ok := (v_prod.last_cost=65);
  v_results := v_results || jsonb_build_object('c_product_updated', jsonb_build_object(
    'ok',c_ok,'last_cost',v_prod.last_cost,'average_cost',v_prod.average_cost));

  -- d) delivery ANTES da chain (para não sobrepor last_cost do finished)
  INSERT INTO public.partners(name,is_customer) VALUES ('TC-CP-'||substr(gen_random_uuid()::text,1,6),true) RETURNING id INTO v_partner;
  INSERT INTO public.sale_orders(name,partner_id,state,amount_untaxed)
  VALUES ('SO-TC-'||substr(gen_random_uuid()::text,1,6),v_partner,'confirmed',200) RETURNING id INTO v_so;
  INSERT INTO public.stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin,scheduled_at)
  VALUES ('OUT-TC-'||substr(gen_random_uuid()::text,1,6),'outgoing','ready',v_wh,v_loc_int,v_loc_cust,v_partner,(SELECT name FROM sale_orders WHERE id=v_so),now()) RETURNING id INTO v_pick;
  INSERT INTO public.stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,quantity_done,state)
  VALUES (v_pick,v_finished,v_loc_int,v_loc_cust,1,1,'ready') RETURNING id INTO v_out_sm;
  UPDATE public.stock_moves SET state='done' WHERE id=v_out_sm;
  UPDATE public.stock_pickings SET state='done',done_at=now() WHERE id=v_pick;
  SELECT unit_cost INTO v_prod.last_cost FROM public.stock_moves WHERE id=v_out_sm;
  SELECT * INTO v_margin FROM public.v_sale_margin WHERE sale_order_id=v_so;
  d_ok := (v_prod.last_cost=65 AND v_margin.revenue=200 AND v_margin.cogs=65 AND v_margin.margin_value=135);
  v_results := v_results || jsonb_build_object('d_delivery_margin', jsonb_build_object(
    'ok',d_ok,'move_unit_cost',v_prod.last_cost,'revenue',v_margin.revenue,'cogs',v_margin.cogs,'margin',v_margin.margin_value));

  -- b) chain (depois de d)
  INSERT INTO public.products(name,internal_ref,type,active,standard_cost)
  VALUES ('TC-SEMI-'||substr(gen_random_uuid()::text,1,6),'S-'||substr(gen_random_uuid()::text,1,6),'storable',true,0) RETURNING id INTO v_semi;
  INSERT INTO public.manufacturing_orders(code,product_id,qty,warehouse_id,state)
  VALUES ('MO-CH-'||substr(gen_random_uuid()::text,1,6),v_semi,1,v_wh,'in_progress') RETURNING id INTO v_mo_child;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required,qty_reserved,sequence) VALUES (v_mo_child,v_comp1,1,1,1) RETURNING id INTO v_comp1_id;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+1 WHERE product_id=v_comp1 AND location_id=v_loc_int;
  INSERT INTO public.stock_moves(product_id,source_location_id,destination_location_id,quantity,reserved_quantity,state,mo_component_id)
  VALUES (v_comp1,v_loc_int,v_loc_int,1,1,'ready',v_comp1_id);
  PERFORM public.close_mo(v_mo_child);

  INSERT INTO public.manufacturing_orders(code,product_id,qty,warehouse_id,state)
  VALUES ('MO-PA-'||substr(gen_random_uuid()::text,1,6),v_finished,1,v_wh,'in_progress') RETURNING id INTO v_mo_parent;
  INSERT INTO public.mo_components(mo_id,product_id,qty_required,qty_reserved,sequence) VALUES (v_mo_parent,v_semi,1,1,1) RETURNING id INTO v_comp1_id;
  UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+1 WHERE product_id=v_semi;
  INSERT INTO public.stock_moves(product_id,source_location_id,destination_location_id,quantity,reserved_quantity,state,mo_component_id)
  SELECT v_semi,sq.location_id,sq.location_id,1,1,'ready',v_comp1_id FROM public.stock_quants sq WHERE sq.product_id=v_semi LIMIT 1;
  PERFORM public.close_mo(v_mo_parent);
  SELECT * INTO v_mo_row FROM public.manufacturing_orders WHERE id=v_mo_parent;
  b_ok := (v_mo_row.material_cost=10);
  v_results := v_results || jsonb_build_object('b_chain_semi', jsonb_build_object(
    'ok',b_ok,'child_unit',(SELECT unit_cost FROM manufacturing_orders WHERE id=v_mo_child),'parent_material',v_mo_row.material_cost));

  -- e) zero-cost
  DECLARE v_zero_prod uuid; v_zero_comp uuid; v_zero_mo uuid; v_zero_last numeric;
  BEGIN
    INSERT INTO public.products(name,internal_ref,type,active,standard_cost)
    VALUES ('TC-ZC-'||substr(gen_random_uuid()::text,1,6),'ZC-'||substr(gen_random_uuid()::text,1,6),'storable',true,0) RETURNING id INTO v_zero_comp;
    INSERT INTO public.products(name,internal_ref,type,active,standard_cost,last_cost)
    VALUES ('TC-ZF-'||substr(gen_random_uuid()::text,1,6),'ZF-'||substr(gen_random_uuid()::text,1,6),'storable',true,0,99) RETURNING id INTO v_zero_prod;
    INSERT INTO public.stock_quants(product_id,location_id,quantity,reserved_quantity) VALUES (v_zero_comp,v_loc_int,10,1);
    INSERT INTO public.manufacturing_orders(code,product_id,qty,warehouse_id,state)
    VALUES ('MO-ZE-'||substr(gen_random_uuid()::text,1,6),v_zero_prod,1,v_wh,'in_progress') RETURNING id INTO v_zero_mo;
    INSERT INTO public.mo_components(mo_id,product_id,qty_required,qty_reserved,sequence) VALUES (v_zero_mo,v_zero_comp,1,1,1) RETURNING id INTO v_comp1_id;
    INSERT INTO public.stock_moves(product_id,source_location_id,destination_location_id,quantity,reserved_quantity,state,mo_component_id)
    VALUES (v_zero_comp,v_loc_int,v_loc_int,1,1,'ready',v_comp1_id);
    PERFORM public.close_mo(v_zero_mo);
    SELECT unit_cost INTO v_prod.last_cost FROM public.manufacturing_orders WHERE id=v_zero_mo;
    SELECT last_cost INTO v_zero_last FROM public.products WHERE id=v_zero_prod;
    e_ok := (v_prod.last_cost=0 AND v_zero_last=99);
    v_results := v_results || jsonb_build_object('e_zero_cost_noop', jsonb_build_object(
      'ok',e_ok,'mo_unit_cost',v_prod.last_cost,'product_last_cost_unchanged',v_zero_last));
  END;

  -- f) reruns tolerantes
  BEGIN v_rr := v_rr || jsonb_build_object('supply',(public._test_supply_canonical_path()->>'ok')::boolean); EXCEPTION WHEN OTHERS THEN v_rr := v_rr || jsonb_build_object('supply', SQLERRM); END;
  BEGIN v_rr := v_rr || jsonb_build_object('mfg',(public._test_mfg_fixes()->>'ok')::boolean); EXCEPTION WHEN OTHERS THEN v_rr := v_rr || jsonb_build_object('mfg', SQLERRM); END;
  BEGIN v_rr := v_rr || jsonb_build_object('delivery',(public._test_delivery_cash_fixes()->>'ok')::boolean); EXCEPTION WHEN OTHERS THEN v_rr := v_rr || jsonb_build_object('delivery', SQLERRM); END;
  BEGIN v_rr := v_rr || jsonb_build_object('costing_purchase',(public._test_costing_purchase()->>'ok')::boolean); EXCEPTION WHEN OTHERS THEN v_rr := v_rr || jsonb_build_object('costing_purchase', SQLERRM); END;
  v_results := v_results || jsonb_build_object('f_reruns', v_rr);

  v_results := v_results || jsonb_build_object('ok',
    COALESCE(a_ok,false) AND COALESCE(b_ok,false) AND COALESCE(c_ok,false) AND COALESCE(d_ok,false) AND COALESCE(e_ok,false));
  RETURN v_results;
END $$;
