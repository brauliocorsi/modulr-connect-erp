-- ============================================================
-- F16-C.5 — Multi-level BOM / Sub-assembly MO chaining
-- ============================================================

-- 1. Schema additions ---------------------------------------------------------
ALTER TABLE public.manufacturing_orders
  ADD COLUMN IF NOT EXISTS parent_mo_id uuid REFERENCES public.manufacturing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_mo_component_id uuid REFERENCES public.mo_components(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_mo_id uuid REFERENCES public.manufacturing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_sale_order_id uuid,
  ADD COLUMN IF NOT EXISTS root_sale_order_line_id uuid,
  ADD COLUMN IF NOT EXISTS bom_depth integer NOT NULL DEFAULT 0;

ALTER TABLE public.mo_components
  ADD COLUMN IF NOT EXISTS child_mo_id uuid REFERENCES public.manufacturing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supply_method text,
  ADD COLUMN IF NOT EXISTS qty_to_manufacture numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_to_purchase numeric NOT NULL DEFAULT 0;

ALTER TABLE public.stock_reservation_log
  ADD COLUMN IF NOT EXISTS to_mo_component_id uuid,
  ADD COLUMN IF NOT EXISTS to_manufacturing_order_id uuid;

CREATE INDEX IF NOT EXISTS idx_mo_parent_mo ON public.manufacturing_orders(parent_mo_id) WHERE parent_mo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_parent_comp ON public.manufacturing_orders(parent_mo_component_id) WHERE parent_mo_component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_root_mo ON public.manufacturing_orders(root_mo_id) WHERE root_mo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_root_sol ON public.manufacturing_orders(root_sale_order_line_id) WHERE root_sale_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_comp_child_mo ON public.mo_components(child_mo_id) WHERE child_mo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_srl_to_mo_comp ON public.stock_reservation_log(to_mo_component_id) WHERE to_mo_component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_srl_to_mo ON public.stock_reservation_log(to_manufacturing_order_id) WHERE to_manufacturing_order_id IS NOT NULL;

-- 2. Helper: materialize child MO components/operations -----------------------
CREATE OR REPLACE FUNCTION public._mfg_materialize_child_components(_mo uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mo manufacturing_orders%ROWTYPE;
  v_resolved jsonb;
  v_lines jsonb;
  v_outputs jsonb;
  v_line jsonb;
  v_out jsonb;
  v_bom_id uuid;
  v_op_count int;
BEGIN
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id=_mo;
  IF NOT FOUND THEN RAISE EXCEPTION 'mo_not_found %', _mo; END IF;

  v_resolved := public.resolve_bom_for_variant(v_mo.product_id, v_mo.variant_id, v_mo.qty, '{}'::jsonb);
  v_bom_id := NULLIF(v_resolved->>'bom_id','')::uuid;
  IF v_bom_id IS NULL THEN
    RAISE EXCEPTION 'NO_BOM_FOR_MANUFACTURED_COMPONENT product=%', v_mo.product_id
      USING ERRCODE='22023';
  END IF;

  UPDATE public.manufacturing_orders SET bom_id = v_bom_id WHERE id=_mo AND bom_id IS NULL;

  -- idempotência: só materializa se ainda não há mo_components
  IF EXISTS (SELECT 1 FROM public.mo_components WHERE mo_id=_mo) THEN
    RETURN;
  END IF;

  v_lines   := COALESCE(v_resolved->'lines','[]'::jsonb);
  v_outputs := COALESCE(v_resolved->'outputs','[]'::jsonb);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF COALESCE((v_line->>'is_optional')::boolean,false) THEN CONTINUE; END IF;
    INSERT INTO public.mo_components(
      mo_id, product_id, variant_id, uom_id, qty_required, sequence,
      bom_line_id, parent_bom_line_id, inheritance_action,
      formula, rounding_method, consumption_uom_id, is_optional
    ) VALUES (
      _mo,
      (v_line->>'component_product_id')::uuid,
      NULLIF(v_line->>'component_variant_id','')::uuid,
      NULLIF(v_line->>'uom_id','')::uuid,
      COALESCE((v_line->>'qty_required')::numeric, 0),
      COALESCE((v_line->>'sequence')::int, 10),
      NULLIF(v_line->>'source_line_id','')::uuid,
      NULLIF(v_line->>'parent_bom_line_id','')::uuid,
      COALESCE(v_line->>'inheritance_action','own'),
      v_line->>'formula_used',
      COALESCE(v_line->>'rounding_method','exact'),
      NULLIF(v_line->>'uom_id','')::uuid,
      false
    );
  END LOOP;

  FOR v_out IN SELECT * FROM jsonb_array_elements(v_outputs) LOOP
    INSERT INTO public.manufacturing_order_outputs(
      manufacturing_order_id, product_id, output_type, qty_expected, uom_id,
      operation_id, condition, cost_allocation_percent
    ) VALUES (
      _mo,
      (v_out->>'product_id')::uuid,
      v_out->>'output_type',
      COALESCE((v_out->>'qty_expected')::numeric, 0),
      NULLIF(v_out->>'uom_id','')::uuid,
      NULLIF(v_out->>'operation_id','')::uuid,
      COALESCE(v_out->>'condition','good'),
      NULLIF(v_out->>'cost_allocation_percent','')::numeric
    );
  END LOOP;

  INSERT INTO public.mo_operations(mo_id, sequence, name, workcenter, planned_minutes, state)
  SELECT _mo, bo.sequence, bo.name, bo.workcenter,
         (bo.duration_minutes * (v_mo.qty / NULLIF((SELECT quantity FROM public.boms WHERE id=v_bom_id),0)))::numeric,
         'pending'::mo_op_state
  FROM public.bom_operations bo WHERE bo.bom_id = v_bom_id;

  SELECT count(*) INTO v_op_count FROM public.mo_operations WHERE mo_id=_mo;
  IF v_op_count = 0 THEN
    INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (_mo, 10, 'Produção', 60, 'pending');
  END IF;

  INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, is_qc)
  VALUES (_mo, 9999, 'Controle de Qualidade', 15, 'pending', true);

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id=_mo;
END $$;

-- 3. mfg_plan_components — routing + recursion --------------------------------
CREATE OR REPLACE FUNCTION public.mfg_plan_components(_mo uuid, _depth int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- 1) tentar reservar do stock livre
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

    -- 2) shortfall remanescente
    v_short := v_comp.qty_required
               - COALESCE(v_comp.qty_reserved,0)
               - COALESCE(v_comp.qty_to_manufacture,0)
               - COALESCE(v_comp.qty_to_purchase,0);
    IF v_short <= 0 THEN CONTINUE; END IF;

    -- 3) decidir rota
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
      -- supply_route NULL ou 'manual'
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

    -- 4) executar rota
    IF v_method = 'manufacture' THEN
      -- ciclo: produto = MO atual
      IF v_comp.product_id = v_mo.product_id THEN
        RAISE EXCEPTION 'MULTILEVEL_BOM_CYCLE component=% equals mo product (mo=%)',
          v_comp.product_id, _mo USING ERRCODE='22023';
      END IF;
      -- ciclo: produto já está em parent chain
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

      -- BOM existe?
      IF NOT EXISTS (SELECT 1 FROM public.boms WHERE product_id=v_comp.product_id AND active) THEN
        RAISE EXCEPTION 'NO_BOM_FOR_MANUFACTURED_COMPONENT product=%', v_comp.product_id
          USING ERRCODE='22023';
      END IF;

      -- idempotência
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
      -- idempotência por mo_component
      SELECT COUNT(*) INTO v_existing_pn
        FROM public.purchase_needs
       WHERE mo_component_id = v_comp.id AND state NOT IN ('cancelled','received');
      IF v_existing_pn = 0 THEN
        -- create_purchase_need é idempotente por (product, sale, mo, state); precisamos vincular o mo_component
        PERFORM public.create_purchase_need(
          v_comp.product_id, v_short, 'manufacturing'::purchase_need_origin,
          NULL, _mo, v_mo.due_date, 'mfg_plan_components depth='||_depth);
        UPDATE public.purchase_needs
           SET mo_component_id = v_comp.id
         WHERE manufacturing_order_id = _mo
           AND product_id = v_comp.product_id
           AND mo_component_id IS NULL
           AND state IN ('pending','quoting','approved');
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
END $$;

-- 4. mfg_create_needs_for_mo — wrapper compatível -----------------------------
CREATE OR REPLACE FUNCTION public.mfg_create_needs_for_mo(_mo uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.mfg_plan_components(_mo, 0);
  RETURN COALESCE((v_result->>'needs_created')::int, 0);
END $$;

-- 5. mfg_create_mo_for_line — preencher root_* e chamar plan ------------------
CREATE OR REPLACE FUNCTION public.mfg_create_mo_for_line(_so uuid, _line uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  so record; sol record; prod record;
  v_existing uuid;
  v_resolved jsonb;
  v_blockers jsonb;
  v_lines jsonb;
  v_outputs jsonb;
  v_line jsonb;
  v_out jsonb;
  v_ctx jsonb := '{}'::jsonb;
  v_qty numeric;
  v_include_optional boolean := false;
  new_id uuid;
  v_bom_id uuid;
  v_op_count int;
BEGIN
  SELECT * INTO so  FROM public.sale_orders        WHERE id = _so;
  SELECT * INTO sol FROM public.sale_order_lines   WHERE id = _line;

  IF sol.line_kind IS NOT NULL AND sol.line_kind <> 'product' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO prod FROM public.products WHERE id = sol.product_id;
  IF prod IS NULL OR NOT prod.can_be_manufactured THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing
    FROM public.manufacturing_orders
   WHERE sale_order_line_id = _line
     AND parent_mo_id IS NULL
     AND state NOT IN ('cancelled','done')
   ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM public.mfg_plan_components(v_existing, 0);
    RETURN v_existing;
  END IF;

  IF prod.supply_route IS NOT NULL
     AND prod.supply_route::text NOT IN ('manufacture','buy_or_manufacture') THEN
    RETURN NULL;
  END IF;

  v_qty := sol.quantity;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'mfg_create_mo_for_line: invalid qty % for sale_order_line %', v_qty, _line
      USING ERRCODE = '22023';
  END IF;

  v_resolved := public.resolve_bom_for_variant(sol.product_id, sol.variant_id, v_qty, v_ctx);
  v_blockers := COALESCE(v_resolved->'blockers','[]'::jsonb);
  v_lines    := COALESCE(v_resolved->'lines','[]'::jsonb);
  v_outputs  := COALESCE(v_resolved->'outputs','[]'::jsonb);
  v_bom_id   := NULLIF(v_resolved->>'bom_id','')::uuid;

  IF v_bom_id IS NULL THEN
    IF jsonb_array_length(v_blockers) = 1 AND v_blockers->0->>'code' = 'no_bom_found' THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'mfg_create_mo_for_line: BOM resolution failed for product %: %',
      sol.product_id, v_blockers::text USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION 'mfg_create_mo_for_line: BOM blockers for product %: %',
      sol.product_id, v_blockers::text USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.manufacturing_orders(
    code, sale_order_id, sale_order_line_id, partner_id,
    product_id, variant_id, bom_id, qty, uom_id,
    warehouse_id, due_date, created_by, state, origin,
    root_sale_order_id, root_sale_order_line_id, bom_depth
  ) VALUES (
    public.mfg_next_code(), _so, _line, so.partner_id,
    sol.product_id, sol.variant_id, v_bom_id, v_qty, sol.uom_id,
    so.warehouse_id, so.commitment_date, auth.uid(), 'draft', 'sale',
    _so, _line, 0
  ) RETURNING id INTO new_id;

  UPDATE public.manufacturing_orders SET root_mo_id = new_id WHERE id = new_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF COALESCE((v_line->>'is_optional')::boolean,false) AND NOT v_include_optional THEN
      CONTINUE;
    END IF;
    IF COALESCE((v_line->>'qty_required')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'mfg_create_mo_for_line: negative qty in resolved line %', v_line::text
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.mo_components(
      mo_id, product_id, variant_id, uom_id, qty_required, sequence,
      bom_line_id, parent_bom_line_id, inheritance_action, variant_rule_id,
      formula, rounding_method, consumption_uom_id, is_optional
    ) VALUES (
      new_id,
      (v_line->>'component_product_id')::uuid,
      NULLIF(v_line->>'component_variant_id','')::uuid,
      NULLIF(v_line->>'uom_id','')::uuid,
      COALESCE((v_line->>'qty_required')::numeric, 0),
      COALESCE((v_line->>'sequence')::int, 10),
      NULLIF(v_line->>'source_line_id','')::uuid,
      NULLIF(v_line->>'parent_bom_line_id','')::uuid,
      COALESCE(v_line->>'inheritance_action','own'),
      NULLIF(v_line->>'rule_id','')::uuid,
      v_line->>'formula_used',
      COALESCE(v_line->>'rounding_method','exact'),
      NULLIF(v_line->>'uom_id','')::uuid,
      COALESCE((v_line->>'is_optional')::boolean, false)
    );
  END LOOP;

  FOR v_out IN SELECT * FROM jsonb_array_elements(v_outputs) LOOP
    INSERT INTO public.manufacturing_order_outputs(
      manufacturing_order_id, product_id, output_type, qty_expected,
      uom_id, operation_id, condition, cost_allocation_percent
    ) VALUES (
      new_id,
      (v_out->>'product_id')::uuid,
      v_out->>'output_type',
      COALESCE((v_out->>'qty_expected')::numeric, 0),
      NULLIF(v_out->>'uom_id','')::uuid,
      NULLIF(v_out->>'operation_id','')::uuid,
      COALESCE(v_out->>'condition','good'),
      NULLIF(v_out->>'cost_allocation_percent','')::numeric
    );
  END LOOP;

  INSERT INTO public.mo_operations(mo_id, sequence, name, workcenter, planned_minutes, state)
  SELECT new_id, bo.sequence, bo.name, bo.workcenter,
         (bo.duration_minutes * (v_qty / NULLIF((SELECT quantity FROM public.boms WHERE id = v_bom_id),0)))::numeric,
         'pending'::mo_op_state
  FROM public.bom_operations bo WHERE bo.bom_id = v_bom_id;

  SELECT count(*) INTO v_op_count FROM public.mo_operations WHERE mo_id = new_id;
  IF v_op_count = 0 THEN
    INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (new_id, 10, 'Produção', 60, 'pending');
  END IF;

  INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, is_qc)
  VALUES (new_id, 9999, 'Controle de Qualidade', 15, 'pending', true);

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = new_id;
  PERFORM public.mfg_refresh_mo_state(new_id);
  PERFORM public.mfg_plan_components(new_id, 0);
  PERFORM public.mfg_sync_sol_status(new_id);

  RETURN new_id;
END $$;

-- 6. close_mo — caso sub_assembly --------------------------------------------
CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid, _qty_produced numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mo record; comp record; loc uuid; produced numeric;
  ratio numeric; consume_qty numeric; remaining numeric; take numeric;
  q record; dst_q record; before_q numeric; before_res numeric;
  total_consumed numeric;
  so_state text; v_case text;
  v_pkg_tracking boolean := false;
  v_tmpl record; v_unit int; v_unit_count int; v_per_unit numeric;
  v_pkg_ref text; v_pkg_status package_status;
  v_so_id uuid; v_sol_id uuid;
  v_tmpl_count int;
  v_payload jsonb;
  v_out record;
  v_out_qty numeric;
  v_out_loc uuid;
  v_out_type product_type;
  v_out_pkg_tracking boolean;
  v_total_pct numeric;
  v_unit_count_o int; v_per_unit_o numeric;
  v_outputs_created int := 0;
  v_parent_comp_id uuid;
  v_parent_mo_id uuid;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('already','done','mo_id',_mo); END IF;
  IF mo.state = 'cancelled' THEN RAISE EXCEPTION 'MO cancelada não pode ser fechada'; END IF;

  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna no armazém da MO'; END IF;

  produced := COALESCE(_qty_produced, mo.qty);
  IF produced <= 0 THEN RAISE EXCEPTION 'qty_produced inválido'; END IF;
  ratio := produced / NULLIF(mo.qty, 0);

  v_parent_comp_id := mo.parent_mo_component_id;
  v_parent_mo_id := mo.parent_mo_id;

  IF v_parent_comp_id IS NOT NULL THEN
    v_case := 'sub_assembly';
  ELSIF mo.sale_order_id IS NULL OR mo.sale_order_line_id IS NULL THEN
    v_case := 'manual';
  ELSE
    SELECT state::text INTO so_state FROM public.sale_orders WHERE id = mo.sale_order_id;
    IF so_state IS NULL OR so_state IN ('cancelled','done','completed') THEN
      v_case := 'sale_cancelled';
    ELSE
      v_case := 'sale_active';
    END IF;
  END IF;

  SELECT COALESCE(package_tracking_enabled,false) INTO v_pkg_tracking
    FROM public.products WHERE id = mo.product_id;

  IF v_pkg_tracking THEN
    SELECT count(*) INTO v_tmpl_count
      FROM public.product_package_templates
     WHERE product_id = mo.product_id AND active = true;
    IF v_tmpl_count = 0 THEN
      RAISE EXCEPTION 'Produto % tem rastreio por embalagens activo sem templates', mo.product_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(cost_allocation_percent),0) INTO v_total_pct
    FROM public.manufacturing_order_outputs
   WHERE manufacturing_order_id = _mo
     AND output_type IN ('co_product','byproduct','reusable_scrap');
  IF v_total_pct > 100 THEN
    RAISE EXCEPTION 'close_mo: soma de cost_allocation_percent dos outputs secundários (%) excede 100', v_total_pct
      USING ERRCODE = '22023';
  END IF;

  -- Consume components
  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id = _mo FOR UPDATE LOOP
    consume_qty := GREATEST(0, ROUND((comp.qty_required * ratio)::numeric, 4) - COALESCE(comp.qty_consumed,0));
    IF consume_qty <= 0 THEN CONTINUE; END IF;
    remaining := consume_qty;
    total_consumed := 0;

    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id = comp.product_id
                AND location_id = loc
                AND COALESCE(variant_id::text,'') = COALESCE(comp.variant_id::text,'')
                AND quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, q.quantity);
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = quantity - take,
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.id;
      PERFORM public.log_stock_reservation(
        comp.product_id, comp.variant_id, q.location_id, q.lot_id,
        take, before_res, GREATEST(0, before_res - take),
        'MO', _mo, 'consume',
        'close_mo comp='||comp.id::text||' qty_before='||before_q::text
      );
      remaining := remaining - take;
      total_consumed := total_consumed + take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'Stock físico insuficiente para consumir componente % (faltam %)', comp.product_id, remaining;
    END IF;

    UPDATE public.mo_components
       SET qty_consumed = COALESCE(qty_consumed,0) + total_consumed,
           qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
     WHERE id = comp.id;
  END LOOP;

  -- Finished good
  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(mo.variant_id::text,'')
     AND location_id = loc
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now()
     WHERE id = dst_q.id;
    before_res := dst_q.reserved_quantity;
  ELSE
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced)
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
    before_res := 0;
  END IF;

  IF v_case = 'sub_assembly' THEN
    -- reservar finished good para o componente da MO mãe
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + produced,
           updated_at = now()
     WHERE id = dst_q.id
       AND reserved_quantity + produced <= quantity;
    UPDATE public.mo_components
       SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + produced),
           supply_method = 'manufacture'
     WHERE id = v_parent_comp_id;
    v_payload := jsonb_build_object(
      'source','close_mo_subassembly_reserve_for_parent_mo',
      'mo_id', _mo, 'parent_mo_id', v_parent_mo_id,
      'parent_mo_component_id', v_parent_comp_id, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_mo_component_id, to_manufacturing_order_id, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo sub_assembly reserve for parent mo_component',
       v_parent_comp_id, v_parent_mo_id, v_payload);
    PERFORM public.mfg_refresh_component(v_parent_comp_id);
    PERFORM public.mfg_refresh_mo_state(v_parent_mo_id);

  ELSIF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id;
    v_sol_id := mo.sale_order_line_id;
    v_payload := jsonb_build_object(
      'source','close_mo_reserve_finished_for_sale',
      'mo_id', _mo, 'sale_order_id', v_so_id,
      'sale_order_line_id', v_sol_id, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes,
       to_sale_order_line_id, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo finished_good intent reserve for SO line', v_sol_id, v_payload);
  ELSE
    v_payload := jsonb_build_object(
      'source', CASE WHEN v_case = 'manual' THEN 'close_mo_for_stock'
                     ELSE 'close_mo_cancelled_sale_to_stock' END,
      'mo_id', _mo, 'qty', produced
    );
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES
      (mo.product_id, mo.variant_id, loc, NULL, produced, 0, produced,
       'MO', _mo, 'consume', auth.uid(),
       'close_mo finished_good to free stock', v_payload);
  END IF;

  -- Stock packages do produto principal
  IF v_pkg_tracking THEN
    v_unit_count := CASE WHEN produced = floor(produced) AND produced >= 1 THEN produced::int ELSE 1 END;
    v_per_unit := produced / v_unit_count;
    v_pkg_status := CASE
      WHEN v_case = 'sale_active'  THEN 'reserved'::package_status
      WHEN v_case = 'sub_assembly' THEN 'reserved'::package_status
      ELSE 'available'::package_status
    END;

    FOR v_unit IN 1..v_unit_count LOOP
      FOR v_tmpl IN
        SELECT * FROM public.product_package_templates
         WHERE product_id = mo.product_id AND active = true
         ORDER BY package_sequence
      LOOP
        v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
        INSERT INTO public.stock_packages
          (product_id, package_template_id,
           sale_order_id, sale_order_line_id, manufacturing_order_id,
           package_ref, package_sequence, package_total, package_group,
           qty, current_location_id, condition, status,
           length_cm, width_cm, height_cm, weight_kg, volume_m3,
           stackable, fragile, requires_flat_transport)
        VALUES
          (mo.product_id, v_tmpl.id,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_id ELSE NULL END,
           CASE WHEN v_case='sale_active' THEN mo.sale_order_line_id ELSE NULL END,
           COALESCE(v_parent_mo_id, _mo),
           v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
           v_per_unit, loc, 'good'::package_condition, v_pkg_status,
           v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
           v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
           v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
        ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- Outputs secundários (mantém comportamento existente)
  FOR v_out IN
    SELECT * FROM public.manufacturing_order_outputs
     WHERE manufacturing_order_id = _mo
       AND output_type IN ('co_product','byproduct','reusable_scrap','waste')
     ORDER BY created_at FOR UPDATE
  LOOP
    v_out_qty := ROUND((COALESCE(v_out.qty_expected,0) * ratio)::numeric, 4);
    IF v_out_qty <= 0 THEN CONTINUE; END IF;

    IF v_out.output_type = 'waste' THEN
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, NULL, NULL, v_out_qty, 0, 0,
         'MO', _mo, 'consume', auth.uid(), 'close_mo waste (no stock impact)',
         jsonb_build_object('source','close_mo_waste','mo_id',_mo,'output_id',v_out.id,
                            'output_type','waste','qty',v_out_qty));
      UPDATE public.manufacturing_order_outputs SET qty_done = v_out_qty, updated_at = now() WHERE id = v_out.id;
      v_outputs_created := v_outputs_created + 1;
      CONTINUE;
    END IF;

    v_out_loc := COALESCE(v_out.stock_location_id, loc);
    SELECT type, COALESCE(package_tracking_enabled,false) INTO v_out_type, v_out_pkg_tracking
      FROM public.products WHERE id = v_out.product_id;

    IF v_out_type = 'storable' THEN
      SELECT * INTO dst_q FROM public.stock_quants
       WHERE product_id = v_out.product_id AND location_id = v_out_loc AND variant_id IS NULL
       LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.stock_quants SET quantity = quantity + v_out_qty, updated_at = now() WHERE id = dst_q.id;
      ELSE
        INSERT INTO public.stock_quants(product_id, location_id, quantity) VALUES (v_out.product_id, v_out_loc, v_out_qty);
      END IF;
      INSERT INTO public.stock_reservation_log
        (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
         origin_type, origin_id, action, reserved_by, notes, payload)
      VALUES
        (v_out.product_id, NULL, v_out_loc, NULL, v_out_qty, 0, v_out_qty,
         'MO', _mo, 'consume', auth.uid(), 'close_mo secondary output to stock',
         jsonb_build_object('source','close_mo_output_to_stock','mo_id',_mo,
                            'output_id',v_out.id,'output_type',v_out.output_type,'qty',v_out_qty));
    END IF;

    IF v_out_pkg_tracking THEN
      SELECT count(*) INTO v_tmpl_count FROM public.product_package_templates
       WHERE product_id = v_out.product_id AND active = true;
      IF v_tmpl_count > 0 THEN
        v_unit_count_o := CASE WHEN v_out_qty = floor(v_out_qty) AND v_out_qty >= 1 THEN v_out_qty::int ELSE 1 END;
        v_per_unit_o := v_out_qty / v_unit_count_o;
        FOR v_unit IN 1..v_unit_count_o LOOP
          FOR v_tmpl IN
            SELECT * FROM public.product_package_templates
             WHERE product_id = v_out.product_id AND active = true ORDER BY package_sequence
          LOOP
            v_pkg_ref := 'MO-' || replace(_mo::text,'-','') || '-OUT-' || replace(v_out.id::text,'-','')
                         || '-T' || v_tmpl.package_sequence::text || '-U' || v_unit::text;
            INSERT INTO public.stock_packages
              (product_id, package_template_id, manufacturing_order_id,
               package_ref, package_sequence, package_total, package_group,
               qty, current_location_id, condition, status,
               length_cm, width_cm, height_cm, weight_kg, volume_m3,
               stackable, fragile, requires_flat_transport)
            VALUES
              (v_out.product_id, v_tmpl.id, _mo,
               v_pkg_ref, v_tmpl.package_sequence, v_tmpl.package_total, v_tmpl.package_group,
               v_per_unit_o, v_out_loc, 'good'::package_condition, 'available'::package_status,
               v_tmpl.default_length_cm, v_tmpl.default_width_cm, v_tmpl.default_height_cm,
               v_tmpl.default_weight_kg, v_tmpl.default_volume_m3,
               v_tmpl.stackable, v_tmpl.fragile, v_tmpl.requires_flat_transport)
            ON CONFLICT (package_ref) WHERE package_ref IS NOT NULL DO NOTHING;
          END LOOP;
        END LOOP;
      END IF;
    END IF;

    UPDATE public.manufacturing_order_outputs
       SET qty_done = v_out_qty, stock_location_id = v_out_loc, updated_at = now()
     WHERE id = v_out.id;
    v_outputs_created := v_outputs_created + 1;
  END LOOP;

  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = _mo;

  -- allocation engine apenas para free-stock
  IF v_case IN ('manual','sale_cancelled') THEN
    BEGIN
      PERFORM public.run_inventory_allocation(
        mo.product_id, mo.variant_id, loc, produced,
        CASE WHEN v_case='manual' THEN 'close_mo_for_stock' ELSE 'close_mo_cancelled_sale' END);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object(
    'mo_id', _mo, 'produced', produced, 'case', v_case,
    'package_tracking', v_pkg_tracking, 'outputs_processed', v_outputs_created,
    'parent_mo_id', v_parent_mo_id, 'parent_mo_component_id', v_parent_comp_id
  );
END $$;

-- 7. Test function ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._test_phase16_multilevel_bom_subassembly()
RETURNS TABLE(scenario text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wh uuid; v_loc uuid;
  v_cama uuid; v_estrut uuid; v_ripa uuid; v_trav uuid; v_paraf uuid;
  v_tecido uuid; v_espuma uuid; v_ferrag uuid;
  v_bom_cama uuid; v_bom_estrut uuid;
  v_partner uuid;
  v_so uuid; v_sol uuid;
  v_mo_mae uuid; v_mo_filha uuid;
  v_comp_estrut uuid; v_comp_ripa uuid;
  v_qty_reserved numeric; v_qty_in_stock numeric;
  v_pn_count int;
  v_total int := 0; v_ok int := 0;
  v_err text;
BEGIN
  -- Setup ----------------------------------------------------------------
  SELECT id INTO v_wh FROM warehouses WHERE active=true ORDER BY created_at LIMIT 1;
  v_loc := _wh_main_internal_loc(v_wh);

  SELECT id INTO v_partner FROM partners WHERE is_customer=true AND active=true LIMIT 1;

  -- raw materials
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Ripa','storable',true,false,'buy',true) RETURNING id INTO v_ripa;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Travessa','storable',true,false,'buy',true) RETURNING id INTO v_trav;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Parafuso','storable',true,false,'buy',true) RETURNING id INTO v_paraf;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Tecido','storable',true,false,'buy',true) RETURNING id INTO v_tecido;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Espuma','storable',true,false,'buy',true) RETURNING id INTO v_espuma;
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Ferragens','storable',true,false,'buy',true) RETURNING id INTO v_ferrag;

  -- semi-finished
  INSERT INTO products(name, type, can_be_purchased, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Estrutura','storable',false,true,'manufacture',true) RETURNING id INTO v_estrut;

  -- finished
  INSERT INTO products(name, type, can_be_sold, can_be_manufactured, supply_route, active)
  VALUES ('T16C5_Cama','storable',true,true,'manufacture',true) RETURNING id INTO v_cama;

  -- BOMs
  INSERT INTO boms(product_id, code, type, quantity, active, is_master)
  VALUES (v_cama,'T16C5_BOM_CAMA','manufacturing',1,true,true) RETURNING id INTO v_bom_cama;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES
    (v_bom_cama, v_estrut, 1, 10),
    (v_bom_cama, v_tecido, 5, 20),
    (v_bom_cama, v_espuma, 2, 30),
    (v_bom_cama, v_ferrag, 4, 40);

  INSERT INTO boms(product_id, code, type, quantity, active, is_master)
  VALUES (v_estrut,'T16C5_BOM_ESTRUT','manufacturing',1,true,true) RETURNING id INTO v_bom_estrut;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence) VALUES
    (v_bom_estrut, v_ripa, 6, 10),
    (v_bom_estrut, v_trav, 2, 20),
    (v_bom_estrut, v_paraf, 20, 30);

  -- ============= Scenario A: submontagem com stock disponível ============
  BEGIN
    v_total := v_total + 1;
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_estrut, v_loc, 1);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_tecido, v_loc, 100);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_espuma, v_loc, 100);
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_ferrag, v_loc, 100);

    INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
    VALUES ('T16C5_SO_A_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100)
    RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
    VALUES (v_so, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol;

    v_mo_mae := mfg_create_mo_for_line(v_so, v_sol);

    SELECT mc.qty_reserved INTO v_qty_reserved
      FROM mo_components mc WHERE mc.mo_id=v_mo_mae AND mc.product_id=v_estrut;
    IF v_qty_reserved >= 1 AND NOT EXISTS (
       SELECT 1 FROM manufacturing_orders WHERE parent_mo_id=v_mo_mae AND product_id=v_estrut
    ) AND NOT EXISTS (
       SELECT 1 FROM purchase_needs WHERE manufacturing_order_id=v_mo_mae AND product_id=v_estrut
    ) THEN
      v_ok := v_ok + 1;
      scenario := 'A_submontagem_stock'; passed := true;
      detail := 'reservou Estrutura do stock, sem MO filha nem PN'; RETURN NEXT;
    ELSE
      scenario := 'A_submontagem_stock'; passed := false;
      detail := format('qty_reserved=%s', v_qty_reserved); RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'A_submontagem_stock'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario B: submontagem sem stock => MO filha ============
  BEGIN
    v_total := v_total + 1;
    -- esgotar stock da estrutura
    DELETE FROM stock_quants WHERE product_id=v_estrut;

    INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
    VALUES ('T16C5_SO_B_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100)
    RETURNING id INTO v_so;
    INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
    VALUES (v_so, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol;

    v_mo_mae := mfg_create_mo_for_line(v_so, v_sol);

    SELECT id INTO v_mo_filha FROM manufacturing_orders
     WHERE parent_mo_id = v_mo_mae AND product_id = v_estrut LIMIT 1;

    IF v_mo_filha IS NOT NULL THEN
      v_ok := v_ok + 1;
      scenario := 'B_mo_filha_criada'; passed := true;
      detail := format('mo_mae=%s mo_filha=%s', v_mo_mae, v_mo_filha); RETURN NEXT;
    ELSE
      scenario := 'B_mo_filha_criada'; passed := false;
      detail := 'MO filha não criada'; RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'B_mo_filha_criada'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario C: PN da Ripa, NÃO da Cama nem Estrutura =======
  BEGIN
    v_total := v_total + 1;
    IF v_mo_filha IS NOT NULL THEN
      SELECT COUNT(*) INTO v_pn_count FROM purchase_needs
       WHERE manufacturing_order_id = v_mo_filha AND product_id = v_ripa;
      IF v_pn_count >= 1 AND NOT EXISTS (
         SELECT 1 FROM purchase_needs WHERE product_id IN (v_cama, v_estrut)
            AND manufacturing_order_id IN (v_mo_mae, v_mo_filha)
      ) THEN
        v_ok := v_ok + 1;
        scenario := 'C_pn_ripa_apenas'; passed := true;
        detail := format('PN Ripa=%s', v_pn_count); RETURN NEXT;
      ELSE
        scenario := 'C_pn_ripa_apenas'; passed := false;
        detail := format('pn_ripa=%s; existem PN proibidas', v_pn_count); RETURN NEXT;
      END IF;
    ELSE
      scenario := 'C_pn_ripa_apenas'; passed := false; detail := 'sem mo_filha'; RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'C_pn_ripa_apenas'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario D: fecho MO filha reserva para MO mãe ==========
  BEGIN
    v_total := v_total + 1;
    -- abastecer componentes para fechar MO filha (simulação rápida: stock direto)
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_ripa, v_loc, 6)
      ON CONFLICT DO NOTHING;
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_trav, v_loc, 2)
      ON CONFLICT DO NOTHING;
    INSERT INTO stock_quants(product_id, location_id, quantity) VALUES (v_paraf, v_loc, 20)
      ON CONFLICT DO NOTHING;

    -- forçar consume sem ser via reservation engine (basta haver stock no loc)
    PERFORM close_mo(v_mo_filha, 1);

    -- Estrutura deve estar em stock e reservada para MO mãe
    SELECT quantity, reserved_quantity INTO v_qty_in_stock, v_qty_reserved
      FROM stock_quants WHERE product_id=v_estrut AND location_id=v_loc LIMIT 1;

    SELECT mc.qty_reserved INTO v_qty_reserved
      FROM mo_components mc WHERE mc.mo_id=v_mo_mae AND mc.product_id=v_estrut;

    IF v_qty_in_stock >= 1 AND v_qty_reserved >= 1 THEN
      v_ok := v_ok + 1;
      scenario := 'D_close_filha_reserva_mae'; passed := true;
      detail := format('stock=%s reserved_mae=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT;
    ELSE
      scenario := 'D_close_filha_reserva_mae'; passed := false;
      detail := format('stock=%s reserved_mae=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'D_close_filha_reserva_mae'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario E: fecho MO mãe consome Estrutura, cria Cama ==
  BEGIN
    v_total := v_total + 1;
    PERFORM close_mo(v_mo_mae, 1);
    SELECT quantity, reserved_quantity INTO v_qty_in_stock, v_qty_reserved
      FROM stock_quants WHERE product_id=v_cama AND location_id=v_loc LIMIT 1;
    IF v_qty_in_stock >= 1 AND v_qty_reserved >= 1 THEN
      v_ok := v_ok + 1;
      scenario := 'E_close_mae'; passed := true;
      detail := format('cama_stock=%s reserved=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT;
    ELSE
      scenario := 'E_close_mae'; passed := false;
      detail := format('cama_stock=%s reserved=%s', v_qty_in_stock, v_qty_reserved); RETURN NEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'E_close_mae'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario G: ciclo BOM A → B → A bloqueia ================
  BEGIN
    v_total := v_total + 1;
    DECLARE
      v_pA uuid; v_pB uuid; v_bA uuid; v_bB uuid;
      v_mo_cycle uuid;
    BEGIN
      INSERT INTO products(name,type,can_be_manufactured,supply_route,active)
      VALUES('T16C5_CycleA','storable',true,'manufacture',true) RETURNING id INTO v_pA;
      INSERT INTO products(name,type,can_be_manufactured,supply_route,active)
      VALUES('T16C5_CycleB','storable',true,'manufacture',true) RETURNING id INTO v_pB;
      INSERT INTO boms(product_id,code,type,quantity,active,is_master)
      VALUES(v_pA,'T16C5_BCYC_A','manufacturing',1,true,true) RETURNING id INTO v_bA;
      INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence) VALUES (v_bA,v_pB,1,10);
      INSERT INTO boms(product_id,code,type,quantity,active,is_master)
      VALUES(v_pB,'T16C5_BCYC_B','manufacturing',1,true,true) RETURNING id INTO v_bB;
      INSERT INTO bom_lines(bom_id,component_product_id,quantity,sequence) VALUES (v_bB,v_pA,1,10);

      INSERT INTO manufacturing_orders(code,product_id,bom_id,qty,warehouse_id,state,origin,root_mo_id,bom_depth)
      VALUES(mfg_next_code(),v_pA,v_bA,1,v_wh,'draft','manual',NULL,0)
      RETURNING id INTO v_mo_cycle;
      UPDATE manufacturing_orders SET root_mo_id=v_mo_cycle WHERE id=v_mo_cycle;
      PERFORM _mfg_materialize_child_components(v_mo_cycle);

      BEGIN
        PERFORM mfg_plan_components(v_mo_cycle, 0);
        scenario := 'G_cycle_bloqueia'; passed := false;
        detail := 'esperado MULTILEVEL_BOM_CYCLE mas não foi lançado'; RETURN NEXT;
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%MULTILEVEL_BOM_CYCLE%' THEN
          v_ok := v_ok + 1;
          scenario := 'G_cycle_bloqueia'; passed := true; detail := SQLERRM; RETURN NEXT;
        ELSE
          scenario := 'G_cycle_bloqueia'; passed := false; detail := SQLERRM; RETURN NEXT;
        END IF;
      END;
    END;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'G_cycle_bloqueia'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- ============= Scenario H: idempotência =================================
  BEGIN
    v_total := v_total + 1;
    DECLARE
      v_so_h uuid; v_sol_h uuid; v_mo_h uuid;
      v_count1 int; v_count2 int; v_pn1 int; v_pn2 int;
    BEGIN
      DELETE FROM stock_quants WHERE product_id=v_estrut;
      INSERT INTO sale_orders(name, partner_id, warehouse_id, state, amount_total)
      VALUES ('T16C5_SO_H_'||extract(epoch from now())::text, v_partner, v_wh, 'draft', 100)
      RETURNING id INTO v_so_h;
      INSERT INTO sale_order_lines(order_id, product_id, quantity, unit_price, subtotal, line_kind)
      VALUES (v_so_h, v_cama, 1, 100, 100, 'product') RETURNING id INTO v_sol_h;

      v_mo_h := mfg_create_mo_for_line(v_so_h, v_sol_h);
      -- Re-executar 3 vezes
      PERFORM mfg_create_mo_for_line(v_so_h, v_sol_h);
      PERFORM mfg_plan_components(v_mo_h, 0);
      PERFORM mfg_plan_components(v_mo_h, 0);

      SELECT count(*) INTO v_count1 FROM manufacturing_orders WHERE sale_order_line_id=v_sol_h OR parent_mo_id=v_mo_h;
      SELECT count(*) INTO v_pn1 FROM purchase_needs WHERE manufacturing_order_id IN
        (SELECT id FROM manufacturing_orders WHERE sale_order_line_id=v_sol_h OR parent_mo_id=v_mo_h
         OR parent_mo_id IN (SELECT id FROM manufacturing_orders WHERE parent_mo_id=v_mo_h));

      -- idempotência: 1 mãe + 1 filha = 2 MO total
      IF v_count1 = 2 THEN
        v_ok := v_ok + 1;
        scenario := 'H_idempotencia'; passed := true;
        detail := format('mos=%s pns=%s', v_count1, v_pn1); RETURN NEXT;
      ELSE
        scenario := 'H_idempotencia'; passed := false;
        detail := format('mos=%s esperado=2', v_count1); RETURN NEXT;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    scenario := 'H_idempotencia'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- Resumo
  scenario := 'TOTAL';
  passed := (v_ok = v_total);
  detail := format('%s/%s scenarios passed', v_ok, v_total);
  RETURN NEXT;
END $$;