
CREATE OR REPLACE FUNCTION public._phase17_diag_spine()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pfx text := 'TESTE_GOLDEN_UPM_';
  v_seed jsonb;
  v_cama uuid; v_estr uuid; v_customer uuid; v_wh uuid;
  v_so uuid; v_sol uuid;
  v_mo_cama uuid; v_mo_estr uuid;
  v_mos jsonb; v_mocomps jsonb; v_needs jsonb;
  v_err_a01 text := NULL; v_err_a02 text := NULL; v_err_a03 text := NULL;
BEGIN
  v_seed := public._seed_golden_upm();
  v_cama := (v_seed->>'cama')::uuid;
  v_estr := (v_seed->>'estrutura')::uuid;
  v_customer := (v_seed->>'customer')::uuid;
  v_wh := (v_seed->>'warehouse')::uuid;

  -- A01
  BEGIN
    INSERT INTO sale_orders(name,partner_id,warehouse_id,state,delivery_mode,amount_untaxed,amount_total)
      VALUES (v_pfx||'SO',v_customer,v_wh,'draft','delivery',1500,1500) RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal,line_kind)
      VALUES (v_so,v_cama,1,1500,1500,'product') RETURNING id INTO v_sol;
    PERFORM public.confirm_sale_order(v_so);
  EXCEPTION WHEN OTHERS THEN v_err_a01 := SQLERRM;
  END;

  -- A02 — try to fetch MO mae; if missing, force create
  BEGIN
    SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    IF v_mo_cama IS NULL THEN
      PERFORM public.mfg_create_orders_for_sale(v_so);
      SELECT id INTO v_mo_cama FROM manufacturing_orders WHERE sale_order_id=v_so AND product_id=v_cama LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_err_a02 := SQLERRM;
  END;

  -- A03 — force materialize + plan with depth=0 (correct)
  BEGIN
    IF v_mo_cama IS NOT NULL THEN
      PERFORM public._mfg_materialize_child_components(v_mo_cama);
      PERFORM public.mfg_plan_components(v_mo_cama, 0);
    END IF;
  EXCEPTION WHEN OTHERS THEN v_err_a03 := SQLERRM;
  END;

  -- snapshot of all TESTE MOs
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'mo_id', mo.id, 'code', mo.code, 'product', p.name,
    'parent_mo_id', mo.parent_mo_id, 'state', mo.state, 'qty', mo.qty,
    'bom_id', mo.bom_id, 'bom_depth', mo.bom_depth,
    'sale_order_id', mo.sale_order_id, 'root_mo_id', mo.root_mo_id,
    'parent_mo_component_id', mo.parent_mo_component_id
  ) ORDER BY mo.created_at), '[]'::jsonb)
  INTO v_mos
  FROM manufacturing_orders mo JOIN products p ON p.id=mo.product_id
  WHERE p.name LIKE v_pfx||'%';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'mo', mo.code, 'mo_product', p.name,
    'comp_id', mc.id, 'comp_product', cp.name,
    'qty_required', mc.qty_required,
    'qty_reserved', mc.qty_reserved,
    'qty_to_purchase', mc.qty_to_purchase,
    'qty_to_manufacture', mc.qty_to_manufacture,
    'supply_method', mc.supply_method,
    'child_mo_id', mc.child_mo_id
  ) ORDER BY mo.code, mc.sequence), '[]'::jsonb)
  INTO v_mocomps
  FROM mo_components mc
  JOIN manufacturing_orders mo ON mo.id=mc.mo_id
  JOIN products p ON p.id=mo.product_id
  JOIN products cp ON cp.id=mc.product_id
  WHERE p.name LIKE v_pfx||'%';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'pn_id', pn.id, 'product', p.name, 'qty', pn.quantity,
    'state', pn.state, 'mo_id', pn.manufacturing_order_id,
    'mo_component_id', pn.mo_component_id, 'origin', pn.origin
  ) ORDER BY p.name), '[]'::jsonb)
  INTO v_needs
  FROM purchase_needs pn JOIN products p ON p.id=pn.product_id
  WHERE p.name LIKE v_pfx||'%';

  SELECT id INTO v_mo_estr FROM manufacturing_orders WHERE parent_mo_id=v_mo_cama AND product_id=v_estr LIMIT 1;

  RETURN jsonb_build_object(
    'errors', jsonb_build_object('A01',v_err_a01,'A02',v_err_a02,'A03',v_err_a03),
    'so', v_so, 'mo_cama', v_mo_cama, 'mo_estr', v_mo_estr,
    'mos', v_mos,
    'mo_components', v_mocomps,
    'purchase_needs', v_needs
  );
END $function$;
