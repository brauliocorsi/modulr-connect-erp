
-- =========================================================================
-- F16-Hotfix: Component Variant Chain
-- =========================================================================

-- 1) Schema: purchase_needs.product_variant_id
ALTER TABLE public.purchase_needs
  ADD COLUMN IF NOT EXISTS product_variant_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_needs_product_variant
  ON public.purchase_needs(product_id, product_variant_id)
  WHERE state IN ('pending','quoting','approved');

-- =========================================================================
-- 2) resolve_bom_for_variant: key v_lines_map by (product||':'||variant)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.resolve_bom_for_variant(
  _product_id uuid, _variant_id uuid DEFAULT NULL::uuid,
  _qty numeric DEFAULT 1, _context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bom_id uuid;
  v_parent_id uuid;
  v_parent_chain uuid[] := ARRAY[]::uuid[];
  v_lines jsonb := '[]'::jsonb;
  v_outputs jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_line record;
  v_out record;
  v_qty numeric;
  v_raw numeric;
  v_conv numeric;
  v_rounded numeric;
  v_formula text;
  v_rule record;
  v_vars jsonb;
  v_depth int := 0;
  v_total_pct numeric := 0;
  v_lines_map jsonb := '{}'::jsonb;  -- keyed by product_id||':'||variant_id
  v_key text;
  v_src_key text;
  v_tgt_key text;
BEGIN
  SELECT id INTO v_bom_id FROM public.boms
   WHERE active = true AND product_id = _product_id AND variant_id = _variant_id
   ORDER BY is_master ASC, created_at DESC LIMIT 1;

  IF v_bom_id IS NULL AND _variant_id IS NOT NULL THEN
    SELECT id INTO v_bom_id FROM public.boms
     WHERE active = true AND applies_to_variant_id = _variant_id
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_bom_id IS NULL THEN
    SELECT id INTO v_bom_id FROM public.boms
     WHERE active = true AND product_id = _product_id AND variant_id IS NULL
     ORDER BY is_master DESC, created_at DESC LIMIT 1;
  END IF;

  IF v_bom_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','no_bom_found','product_id',_product_id,'variant_id',_variant_id);
    RETURN jsonb_build_object('bom_id',NULL,'parent_chain','[]'::jsonb,'lines','[]'::jsonb,'outputs','[]'::jsonb,'warnings',v_warnings,'blockers',v_blockers);
  END IF;

  v_parent_id := v_bom_id;
  WHILE v_parent_id IS NOT NULL AND v_depth < 5 LOOP
    v_parent_chain := v_parent_chain || v_parent_id;
    SELECT parent_bom_id INTO v_parent_id FROM public.boms WHERE id = v_parent_id;
    v_depth := v_depth + 1;
  END LOOP;

  FOR v_line IN
    WITH chain AS (
      SELECT unnest(v_parent_chain) AS bid, generate_subscripts(v_parent_chain,1) AS pos
    )
    SELECT bl.*, c.pos
    FROM chain c
    JOIN public.bom_lines bl ON bl.bom_id = c.bid
    ORDER BY c.pos DESC, bl.sequence ASC
  LOOP
    v_key := v_line.component_product_id::text || ':' || COALESCE(v_line.component_variant_id::text,'');
    IF v_line.inheritance_action = 'remove' THEN
      v_lines_map := v_lines_map - v_key;
      CONTINUE;
    END IF;

    v_formula := COALESCE(v_line.qty_formula, v_line.formula);
    v_vars := COALESCE(v_line.formula_variables,'{}'::jsonb) || COALESCE(_context,'{}'::jsonb);
    IF v_formula IS NOT NULL AND btrim(v_formula) <> '' THEN
      BEGIN
        v_raw := public.mfg_eval_formula(v_formula, v_vars);
      EXCEPTION WHEN OTHERS THEN
        v_blockers := v_blockers || jsonb_build_object('code','formula_error','bom_line_id',v_line.id,'formula',v_formula,'error',SQLERRM);
        CONTINUE;
      END;
    ELSE
      v_raw := v_line.quantity;
    END IF;

    v_conv := v_raw * COALESCE(v_line.conversion_factor, 1);
    v_rounded := CASE v_line.rounding_method
      WHEN 'round_up'   THEN ceil(v_conv)
      WHEN 'round_down' THEN floor(v_conv)
      ELSE v_conv
    END;
    v_qty := v_rounded * _qty;

    v_lines_map := v_lines_map || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'component_product_id', v_line.component_product_id,
        'component_variant_id', v_line.component_variant_id,
        'qty_required', v_qty,
        'raw_qty', v_raw,
        'converted_qty', v_conv,
        'uom_id', COALESCE(v_line.consumption_uom_id, v_line.uom_id),
        'inheritance_action', v_line.inheritance_action,
        'source_line_id', v_line.id,
        'parent_bom_line_id', v_line.parent_bom_line_id,
        'formula_used', v_formula,
        'rounding_method', v_line.rounding_method,
        'is_optional', v_line.is_optional
      )
    );
  END LOOP;

  -- Variant rules: keyed by source_component_id only (no variant) -> match all keys starting with that product
  FOR v_rule IN
    SELECT * FROM public.bom_variant_rules
     WHERE active = true AND bom_id = ANY(v_parent_chain)
       AND (variant_id IS NULL OR variant_id = _variant_id)
       AND (
         attribute_name IS NULL
         OR (_context ? attribute_name AND _context->>attribute_name = attribute_value)
       )
     ORDER BY priority ASC
  LOOP
    IF v_rule.rule_type = 'remove_component' AND v_rule.source_component_id IS NOT NULL THEN
      SELECT k INTO v_src_key FROM jsonb_object_keys(v_lines_map) k
        WHERE k LIKE v_rule.source_component_id::text || ':%' LIMIT 1;
      IF v_src_key IS NOT NULL THEN v_lines_map := v_lines_map - v_src_key; END IF;
    ELSIF v_rule.rule_type = 'replace_component' THEN
      SELECT k INTO v_src_key FROM jsonb_object_keys(v_lines_map) k
        WHERE k LIKE v_rule.source_component_id::text || ':%' LIMIT 1;
      IF v_src_key IS NOT NULL THEN
        DECLARE v_existing jsonb := v_lines_map->v_src_key;
        BEGIN
          v_tgt_key := v_rule.target_component_id::text || ':';
          v_lines_map := v_lines_map - v_src_key;
          v_lines_map := v_lines_map || jsonb_build_object(
            v_tgt_key,
            v_existing
              || jsonb_build_object('component_product_id', v_rule.target_component_id, 'component_variant_id', NULL, 'rule_id', v_rule.id, 'inheritance_action','override')
              || CASE WHEN v_rule.qty IS NOT NULL THEN jsonb_build_object('qty_required', v_rule.qty * _qty, 'raw_qty', v_rule.qty) ELSE '{}'::jsonb END
              || CASE WHEN v_rule.uom_id IS NOT NULL THEN jsonb_build_object('uom_id', v_rule.uom_id) ELSE '{}'::jsonb END
          );
        END;
      END IF;
    ELSIF v_rule.rule_type = 'add_component' AND v_rule.target_component_id IS NOT NULL THEN
      v_raw := COALESCE(v_rule.qty, 1);
      IF v_rule.formula IS NOT NULL THEN
        BEGIN
          v_raw := public.mfg_eval_formula(v_rule.formula, _context);
        EXCEPTION WHEN OTHERS THEN
          v_blockers := v_blockers || jsonb_build_object('code','rule_formula_error','rule_id',v_rule.id,'error',SQLERRM);
          CONTINUE;
        END;
      END IF;
      v_lines_map := v_lines_map || jsonb_build_object(
        v_rule.target_component_id::text || ':',
        jsonb_build_object(
          'component_product_id', v_rule.target_component_id,
          'component_variant_id', NULL,
          'qty_required', v_raw * _qty,
          'raw_qty', v_raw,
          'uom_id', v_rule.uom_id,
          'inheritance_action','add',
          'rule_id', v_rule.id,
          'formula_used', v_rule.formula
        )
      );
    ELSIF v_rule.rule_type = 'change_qty' AND v_rule.source_component_id IS NOT NULL THEN
      SELECT k INTO v_src_key FROM jsonb_object_keys(v_lines_map) k
        WHERE k LIKE v_rule.source_component_id::text || ':%' LIMIT 1;
      IF v_src_key IS NOT NULL AND v_rule.qty IS NOT NULL THEN
        v_lines_map := jsonb_set(v_lines_map, ARRAY[v_src_key,'qty_required'], to_jsonb(v_rule.qty * _qty));
        v_lines_map := jsonb_set(v_lines_map, ARRAY[v_src_key,'rule_id'], to_jsonb(v_rule.id));
      END IF;
    ELSIF v_rule.rule_type = 'change_formula' AND v_rule.source_component_id IS NOT NULL AND v_rule.formula IS NOT NULL THEN
      SELECT k INTO v_src_key FROM jsonb_object_keys(v_lines_map) k
        WHERE k LIKE v_rule.source_component_id::text || ':%' LIMIT 1;
      IF v_src_key IS NOT NULL THEN
        BEGIN
          v_raw := public.mfg_eval_formula(v_rule.formula, _context);
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_src_key,'qty_required'], to_jsonb(v_raw * _qty));
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_src_key,'formula_used'], to_jsonb(v_rule.formula));
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_src_key,'rule_id'], to_jsonb(v_rule.id));
        EXCEPTION WHEN OTHERS THEN
          v_blockers := v_blockers || jsonb_build_object('code','rule_formula_error','rule_id',v_rule.id,'error',SQLERRM);
        END;
      END IF;
    END IF;
  END LOOP;

  FOR v_out IN
    SELECT o.* FROM public.manufacturing_bom_outputs o
     WHERE o.active = true AND o.bom_id = ANY(v_parent_chain)
  LOOP
    v_raw := COALESCE(v_out.qty, 1);
    IF v_out.formula IS NOT NULL THEN
      BEGIN
        v_raw := public.mfg_eval_formula(v_out.formula, _context);
      EXCEPTION WHEN OTHERS THEN
        v_blockers := v_blockers || jsonb_build_object('code','output_formula_error','output_id',v_out.id,'error',SQLERRM);
        CONTINUE;
      END;
    END IF;
    IF v_out.cost_allocation_percent IS NOT NULL THEN
      v_total_pct := v_total_pct + v_out.cost_allocation_percent;
    END IF;
    v_outputs := v_outputs || jsonb_build_object(
      'output_id', v_out.id,
      'product_id', v_out.product_id,
      'output_type', v_out.output_type,
      'qty_expected', v_raw * _qty,
      'uom_id', v_out.uom_id,
      'stockable', v_out.stockable,
      'condition', v_out.condition,
      'operation_id', v_out.operation_id,
      'work_center_id', v_out.work_center_id,
      'cost_allocation_percent', v_out.cost_allocation_percent
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_outputs) e WHERE e->>'output_type' = 'main_product'
  ) THEN
    v_outputs := jsonb_build_array(jsonb_build_object(
      'product_id', _product_id,
      'output_type','main_product',
      'qty_expected', _qty,
      'stockable', true,
      'cost_allocation_percent', NULL,
      'synthesized', true
    )) || v_outputs;
  END IF;

  IF v_total_pct > 100 THEN
    v_blockers := v_blockers || jsonb_build_object('code','cost_allocation_exceeds_100','total',v_total_pct);
  END IF;

  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'component_product_id', value->>'component_variant_id'),'[]'::jsonb)
    INTO v_lines
    FROM jsonb_each(v_lines_map);

  RETURN jsonb_build_object(
    'bom_id', v_bom_id,
    'parent_chain', to_jsonb(v_parent_chain),
    'lines', v_lines,
    'outputs', v_outputs,
    'warnings', v_warnings,
    'blockers', v_blockers,
    'requested_qty', _qty,
    'product_id', _product_id,
    'variant_id', _variant_id
  );
END;
$function$;

-- =========================================================================
-- 3) create_purchase_need: add _variant parameter
-- =========================================================================
DROP FUNCTION IF EXISTS public.create_purchase_need(uuid, numeric, purchase_need_origin, uuid, uuid, date, text);

CREATE OR REPLACE FUNCTION public.create_purchase_need(
  _product uuid, _qty numeric, _origin purchase_need_origin,
  _sale uuid DEFAULT NULL, _mo uuid DEFAULT NULL,
  _needed_by date DEFAULT NULL, _notes text DEFAULT NULL,
  _variant uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _id uuid; _supplier uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO _id FROM public.purchase_needs
   WHERE product_id = _product
     AND COALESCE(product_variant_id::text,'') = COALESCE(_variant::text,'')
     AND origin_kind = _origin
     AND state IN ('pending','quoting','approved')
     AND COALESCE(sale_order_id::text,'') = COALESCE(_sale::text,'')
     AND COALESCE(manufacturing_order_id::text,'') = COALESCE(_mo::text,'')
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  SELECT partner_id INTO _supplier FROM public.product_suppliers
    WHERE product_id = _product ORDER BY priority NULLS LAST LIMIT 1;

  INSERT INTO public.purchase_needs(product_id, product_variant_id, qty_needed, origin_kind,
       sale_order_id, manufacturing_order_id, suggested_partner_id, needed_by, notes)
  VALUES (_product, _variant, _qty, _origin, _sale, _mo, _supplier, _needed_by, _notes)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;

-- =========================================================================
-- 4) guard_purchase_need_no_dup: consider variant
-- =========================================================================
CREATE OR REPLACE FUNCTION public.guard_purchase_need_no_dup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.sale_order_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.sale_order_line_supply_links sl
      JOIN public.sale_order_lines l ON l.id = sl.sale_order_line_id
      WHERE l.order_id = NEW.sale_order_id
        AND l.product_id = NEW.product_id
        AND COALESCE(l.variant_id::text,'') = COALESCE(NEW.product_variant_id::text,'')
        AND sl.state = 'active'
        AND sl.link_kind IN ('purchase_need','purchase_order_line')
    ) THEN
      RAISE EXCEPTION 'guard_purchase_need_no_dup: já existe supply_link ativo para SO=% produto=% variante=%',
        NEW.sale_order_id, NEW.product_id, NEW.product_variant_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- =========================================================================
-- 5) mfg_plan_components: pass component variant
-- =========================================================================
CREATE OR REPLACE FUNCTION public.mfg_plan_components(_mo uuid, _depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mo manufacturing_orders%ROWTYPE;
  v_comp record;
  v_prod record;
  v_loc uuid;
  v_short numeric;
  v_available numeric;
  v_to_reserve numeric;
  v_quant record;
  v_method text;
  v_child_mo uuid;
  v_root_mo uuid;
  v_root_so uuid;
  v_root_sol uuid;
  v_children int := 0;
  v_needs int := 0;
  v_stock_reserved int := 0;
  v_existing_pn int;
  v_new_pn_id uuid;
BEGIN
  IF _depth > 5 THEN
    RAISE EXCEPTION 'MULTILEVEL_BOM_DEPTH_EXCEEDED mo=%, depth=%', _mo, _depth USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id=_mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mo_not_found %', _mo; END IF;
  IF v_mo.state IN ('done','cancelled') THEN
    RETURN jsonb_build_object('mo_id',_mo,'skipped',true,'state',v_mo.state::text);
  END IF;

  v_loc := public._wh_main_internal_loc(v_mo.warehouse_id);
  v_root_mo  := COALESCE(v_mo.root_mo_id, _mo);
  v_root_so  := COALESCE(v_mo.root_sale_order_id, v_mo.sale_order_id);
  v_root_sol := COALESCE(v_mo.root_sale_order_line_id, v_mo.sale_order_line_id);

  FOR v_comp IN
    SELECT * FROM public.mo_components WHERE mo_id=_mo ORDER BY sequence FOR UPDATE
  LOOP
    SELECT * INTO v_prod FROM public.products WHERE id=v_comp.product_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_short := v_comp.qty_required - COALESCE(v_comp.qty_reserved,0);
    IF v_short > 0 AND v_loc IS NOT NULL THEN
      SELECT id, quantity, reserved_quantity INTO v_quant
        FROM public.stock_quants
       WHERE location_id=v_loc
         AND product_id=v_comp.product_id
         AND COALESCE(variant_id::text,'')=COALESCE(v_comp.variant_id::text,'')
       FOR UPDATE;
      IF FOUND THEN
        v_available := GREATEST(0, v_quant.quantity - v_quant.reserved_quantity);
        v_to_reserve := LEAST(v_short, v_available);
        IF v_to_reserve > 0 THEN
          UPDATE public.stock_quants
             SET reserved_quantity = reserved_quantity + v_to_reserve, updated_at=now()
           WHERE id=v_quant.id AND reserved_quantity + v_to_reserve <= quantity;
          UPDATE public.mo_components
             SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + v_to_reserve),
                 supply_method = COALESCE(supply_method,'stock')
           WHERE id=v_comp.id;
          INSERT INTO public.stock_reservation_log
            (origin_type, origin_id, action, product_id, variant_id, location_id, qty,
             qty_before, qty_after, to_mo_component_id, to_manufacturing_order_id, payload)
          VALUES
            ('MO', _mo, 'reserve', v_comp.product_id, v_comp.variant_id, v_loc, v_to_reserve,
             v_quant.reserved_quantity, v_quant.reserved_quantity + v_to_reserve,
             v_comp.id, _mo,
             jsonb_build_object('source','mfg_plan_components','step','stock_reserve',
                                'depth',_depth,'mo_component_id',v_comp.id));
          v_comp.qty_reserved := COALESCE(v_comp.qty_reserved,0) + v_to_reserve;
          v_stock_reserved := v_stock_reserved + 1;
        END IF;
      END IF;
    END IF;

    v_short := v_comp.qty_required
               - COALESCE(v_comp.qty_reserved,0)
               - COALESCE(v_comp.qty_to_manufacture,0)
               - COALESCE(v_comp.qty_to_purchase,0);
    IF v_short <= 0 THEN CONTINUE; END IF;

    v_method := NULL;
    IF v_prod.supply_route::text = 'manufacture' THEN
      v_method := CASE WHEN v_prod.can_be_manufactured THEN 'manufacture' ELSE NULL END;
    ELSIF v_prod.supply_route::text = 'buy' THEN
      v_method := CASE WHEN v_prod.can_be_purchased THEN 'buy' ELSE NULL END;
    ELSIF v_prod.supply_route::text = 'buy_or_manufacture' THEN
      IF v_prod.can_be_manufactured
         AND EXISTS (SELECT 1 FROM public.boms WHERE product_id=v_prod.id AND active) THEN
        v_method := 'manufacture';
      ELSIF v_prod.can_be_purchased THEN
        v_method := 'buy';
      END IF;
    ELSE
      IF v_prod.can_be_manufactured AND v_prod.can_be_purchased THEN
        RAISE EXCEPTION 'AMBIGUOUS_SUPPLY_ROUTE product=% mo=%', v_prod.id, _mo USING ERRCODE='22023';
      ELSIF v_prod.can_be_manufactured THEN
        v_method := 'manufacture';
      ELSIF v_prod.can_be_purchased THEN
        v_method := 'buy';
      END IF;
    END IF;

    IF v_method IS NULL THEN
      RAISE EXCEPTION 'NO_SUPPLY_ROUTE product=% mo=%', v_prod.id, _mo USING ERRCODE='22023';
    END IF;

    IF v_method = 'manufacture' THEN
      IF v_comp.product_id = v_mo.product_id THEN
        RAISE EXCEPTION 'MULTILEVEL_BOM_CYCLE component=% equals mo product (mo=%)',
          v_comp.product_id, _mo USING ERRCODE='22023';
      END IF;
      IF EXISTS (
        WITH RECURSIVE chain AS (
          SELECT id, product_id, parent_mo_id FROM public.manufacturing_orders WHERE id=_mo
          UNION ALL
          SELECT m.id, m.product_id, m.parent_mo_id
            FROM public.manufacturing_orders m JOIN chain c ON m.id=c.parent_mo_id
        )
        SELECT 1 FROM chain WHERE product_id = v_comp.product_id
      ) THEN
        RAISE EXCEPTION 'MULTILEVEL_BOM_CYCLE product=% already in parent chain (mo=%)',
          v_comp.product_id, _mo USING ERRCODE='22023';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.boms WHERE product_id=v_comp.product_id AND active) THEN
        RAISE EXCEPTION 'NO_BOM_FOR_MANUFACTURED_COMPONENT product=%', v_comp.product_id
          USING ERRCODE='22023';
      END IF;

      IF v_comp.child_mo_id IS NOT NULL THEN
        UPDATE public.mo_components SET supply_method='manufacture' WHERE id=v_comp.id;
        CONTINUE;
      END IF;

      INSERT INTO public.manufacturing_orders(
        code, product_id, variant_id, bom_id, qty, uom_id, warehouse_id,
        due_date, state, origin,
        parent_mo_id, parent_mo_component_id, root_mo_id,
        root_sale_order_id, root_sale_order_line_id, bom_depth, created_by
      )
      SELECT public.mfg_next_code(), v_comp.product_id, v_comp.variant_id,
             (SELECT id FROM public.boms WHERE product_id=v_comp.product_id AND active
                ORDER BY is_master DESC, created_at DESC LIMIT 1),
             v_short, v_comp.uom_id, v_mo.warehouse_id,
             v_mo.due_date, 'draft'::mo_state, 'replenishment'::mo_origin,
             _mo, v_comp.id, v_root_mo,
             v_root_so, v_root_sol, _depth + 1, v_mo.created_by
      RETURNING id INTO v_child_mo;

      UPDATE public.mo_components
         SET child_mo_id = v_child_mo,
             supply_method = 'manufacture',
             qty_to_manufacture = COALESCE(qty_to_manufacture,0) + v_short
       WHERE id = v_comp.id;

      PERFORM public._mfg_materialize_child_components(v_child_mo);
      PERFORM public.mfg_plan_components(v_child_mo, _depth + 1);
      v_children := v_children + 1;

    ELSIF v_method = 'buy' THEN
      SELECT COUNT(*) INTO v_existing_pn
        FROM public.purchase_needs
       WHERE mo_component_id = v_comp.id AND state NOT IN ('cancelled','received');
      IF v_existing_pn = 0 THEN
        v_new_pn_id := public.create_purchase_need(
          v_comp.product_id, v_short, 'manufacturing'::purchase_need_origin,
          NULL, _mo, v_mo.due_date, 'mfg_plan_components depth='||_depth,
          v_comp.variant_id);
        UPDATE public.purchase_needs
           SET mo_component_id = v_comp.id
         WHERE id = v_new_pn_id
           AND mo_component_id IS NULL;
      END IF;
      UPDATE public.mo_components
         SET supply_method = 'buy',
             qty_to_purchase = COALESCE(qty_to_purchase,0) + v_short
       WHERE id = v_comp.id;
      v_needs := v_needs + 1;
    END IF;
  END LOOP;

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id=_mo;
  PERFORM public.mfg_refresh_mo_state(_mo);

  RETURN jsonb_build_object(
    'mo_id', _mo, 'depth', _depth,
    'children_created', v_children,
    'needs_created', v_needs,
    'reserved_from_stock', v_stock_reserved
  );
END $function$;

-- =========================================================================
-- 6) tg_so_confirm_create_purchase_needs: pass line variant
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_so_confirm_create_purchase_needs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_avail numeric; v_short numeric; v_need uuid; v_count int := 0;
BEGIN
  IF NEW.state = 'confirmed' AND COALESCE(OLD.state::text,'') <> 'confirmed' THEN
    FOR r IN
      SELECT sol.product_id, sol.variant_id, sol.quantity, p.can_be_purchased, p.can_be_manufactured, p.name
        FROM public.sale_order_lines sol
        JOIN public.products p ON p.id = sol.product_id
       WHERE sol.order_id = NEW.id AND p.type = 'storable' AND p.can_be_purchased
    LOOP
      SELECT COALESCE(SUM(available),0) INTO v_avail
        FROM public.product_stock_forecast WHERE product_id = r.product_id;
      v_short := r.quantity - COALESCE(v_avail,0);
      IF v_short > 0 AND NOT r.can_be_manufactured THEN
        v_need := public.create_purchase_need(r.product_id, v_short, 'sale'::purchase_need_origin,
          NEW.id, NULL, COALESCE(NEW.commitment_date::date, NEW.validity_date),
          'Auto: stock insuficiente para venda ' || NEW.name, r.variant_id);
        IF v_need IS NOT NULL THEN v_count := v_count + 1; END IF;
      END IF;
    END LOOP;
    IF v_count > 0 AND NEW.salesperson_id IS NOT NULL THEN
      PERFORM public.notify_user(NEW.salesperson_id, 'sales'::app_module, 'purchase_need',
        'Necessidades de compra geradas',
        format('Venda %s gerou %s necessidade(s) de compra.', NEW.name, v_count),
        '/sales/orders/' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- =========================================================================
-- 7) _so_ensure_mo_for_line: propagate variant to MO and purchase_needs
-- =========================================================================
CREATE OR REPLACE FUNCTION public._so_ensure_mo_for_line(_line_id uuid, _qty numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line sale_order_lines%ROWTYPE; v_so sale_orders%ROWTYPE;
  v_mo uuid; v_bom uuid; v_code text;
BEGIN
  IF _qty <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_line FROM public.sale_order_lines WHERE id=_line_id;
  SELECT * INTO v_so FROM public.sale_orders WHERE id=v_line.order_id;
  SELECT id INTO v_bom FROM public.boms WHERE product_id=v_line.product_id AND active LIMIT 1;
  IF v_bom IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_mo FROM public.manufacturing_orders
   WHERE sale_order_line_id=_line_id AND state NOT IN ('cancelled','done') LIMIT 1;
  IF v_mo IS NOT NULL THEN RETURN v_mo; END IF;

  v_code := 'MO/'||v_so.name||'/'||substr(_line_id::text,1,8);
  INSERT INTO public.manufacturing_orders(code, sale_order_id, sale_order_line_id, partner_id,
                                   product_id, variant_id, bom_id, qty, state, warehouse_id,
                                   origin, due_date)
  VALUES (v_code, v_so.id, _line_id, v_so.partner_id,
          v_line.product_id, v_line.variant_id, v_bom, _qty, 'draft', v_so.warehouse_id,
          'sale', v_so.commitment_date)
  RETURNING id INTO v_mo;

  INSERT INTO public.purchase_needs(product_id, product_variant_id, qty_needed, origin_kind,
                                    sale_order_id, manufacturing_order_id, suggested_partner_id, needed_by)
  SELECT bl.component_product_id, bl.component_variant_id,
         (bl.quantity * _qty) - public.so_product_available_now(bl.component_product_id, v_so.warehouse_id),
         'manufacturing', NULL, v_mo,
         (SELECT partner_id FROM public.product_suppliers WHERE product_id=bl.component_product_id
            ORDER BY priority NULLS LAST LIMIT 1),
         COALESCE(v_so.commitment_date, (CURRENT_DATE + COALESCE(
              (SELECT lead_time_days FROM public.product_suppliers WHERE product_id=bl.component_product_id
                 ORDER BY priority NULLS LAST LIMIT 1), 7)))
  FROM public.bom_lines bl
  WHERE bl.bom_id = v_bom
    AND (bl.quantity * _qty) > public.so_product_available_now(bl.component_product_id, v_so.warehouse_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_needs pn
      WHERE pn.manufacturing_order_id = v_mo
        AND pn.product_id = bl.component_product_id
        AND COALESCE(pn.product_variant_id::text,'') = COALESCE(bl.component_variant_id::text,'')
        AND pn.state IN ('pending','quoting','approved')
    );
  RETURN v_mo;
END $function$;
