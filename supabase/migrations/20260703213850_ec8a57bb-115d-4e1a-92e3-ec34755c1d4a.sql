
-- =============================================================
-- Correção MÓDULO FABRICO (consolidada)
--   A) qty MO = qty em falta
--   B) variant_id na reserva de venda + reserve_picking_strict
--   C) log/notify no replan pós-MO + close_mo intent
--   D) gating soft de sequência com override + proteções de estado
--   E) função de teste _test_mfg_fixes()
-- =============================================================

-- -------------------------------------------------------------
-- B.3 reserve_picking_strict: filtrar quants por variant_id do move
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_picking_strict(_picking uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pk record; mv record; q record;
  needed numeric; available numeric; reserved_now numeric; total_reserved numeric := 0;
  before_res numeric;
BEGIN
  SELECT * INTO pk FROM public.stock_pickings WHERE id=_picking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Picking não encontrado: %', _picking; END IF;
  IF pk.state IN ('done','cancelled') THEN RETURN jsonb_build_object('skip', pk.state); END IF;

  FOR mv IN SELECT * FROM public.stock_moves WHERE picking_id=_picking AND state NOT IN ('done','cancelled') FOR UPDATE LOOP
    PERFORM public.lock_quant(mv.product_id, mv.source_location_id);

    needed := GREATEST(0, COALESCE(mv.quantity,0) - COALESCE(mv.reserved_quantity,0));
    IF needed <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(GREATEST(0, quantity-reserved_quantity)),0) INTO available
      FROM public.stock_quants
     WHERE product_id=mv.product_id
       AND location_id=mv.source_location_id
       AND COALESCE(variant_id::text,'') = COALESCE(mv.variant_id::text,'');

    IF available < needed THEN
      RAISE EXCEPTION 'Stock insuficiente para produto %/variante % na localização %: precisa %, disponível %',
        mv.product_id, mv.variant_id, mv.source_location_id, needed, available USING ERRCODE='check_violation';
    END IF;

    reserved_now := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id=mv.product_id
                AND location_id=mv.source_location_id
                AND COALESCE(variant_id::text,'') = COALESCE(mv.variant_id::text,'')
                AND quantity-reserved_quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN reserved_now >= needed;
      DECLARE free_qty numeric := GREATEST(0, q.quantity-q.reserved_quantity);
              take numeric := LEAST(free_qty, needed-reserved_now);
      BEGIN
        IF take<=0 THEN CONTINUE; END IF;
        before_res := q.reserved_quantity;
        UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+take, updated_at=now() WHERE id=q.id;
        PERFORM public.log_stock_reservation(mv.product_id, mv.variant_id, q.location_id, q.lot_id,
          take, before_res, before_res+take, 'PICKING', _picking, 'reserve',
          'reserve_picking_strict move='||mv.id::text);
        reserved_now := reserved_now + take;
      END;
    END LOOP;

    UPDATE public.stock_moves
       SET reserved_quantity = COALESCE(reserved_quantity,0) + reserved_now
     WHERE id = mv.id;
    total_reserved := total_reserved + reserved_now;
  END LOOP;

  IF pk.state = 'draft'::picking_state THEN
    UPDATE public.stock_pickings SET state='ready'::picking_state WHERE id=_picking;
  END IF;
  RETURN jsonb_build_object('reserved_total', total_reserved);
END $function$;

-- -------------------------------------------------------------
-- B.1/B.2 _so_reserve_line: incluir variant_id no move + filtro
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._so_reserve_line(_line_id uuid, _qty numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line sale_order_lines%ROWTYPE; v_so sale_orders%ROWTYPE;
  v_src_loc uuid; v_dst_loc uuid; v_wh uuid;
  v_picking uuid; v_already numeric := 0; v_to_add numeric;
BEGIN
  IF _qty <= 0 THEN RETURN 0; END IF;
  SELECT * INTO v_line FROM sale_order_lines WHERE id=_line_id;
  SELECT * INTO v_so   FROM sale_orders WHERE id=v_line.order_id;
  v_wh := v_so.warehouse_id;

  SELECT id INTO v_src_loc FROM stock_locations
   WHERE warehouse_id=v_wh AND type='internal' AND active
   ORDER BY (parent_id IS NULL) DESC LIMIT 1;
  IF v_src_loc IS NULL THEN RETURN 0; END IF;
  SELECT id INTO v_dst_loc FROM stock_locations WHERE type='customer' LIMIT 1;
  IF v_dst_loc IS NULL THEN RETURN 0; END IF;

  SELECT id INTO v_picking FROM stock_pickings
   WHERE origin = v_so.name AND kind='outgoing' AND state IN ('draft','ready')
   ORDER BY created_at LIMIT 1;
  IF v_picking IS NULL THEN
    INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id,
                               destination_location_id, partner_id, origin)
    VALUES ('OUT/'||v_so.name||'/'||substr(_line_id::text,1,8),
            'outgoing','draft', v_wh, v_src_loc, v_dst_loc, v_so.partner_id, v_so.name)
    RETURNING id INTO v_picking;
  END IF;

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_already
    FROM stock_moves
   WHERE picking_id=v_picking
     AND product_id=v_line.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(v_line.variant_id::text,'')
     AND state IN ('ready','draft');
  v_to_add := GREATEST(_qty - v_already, 0);
  IF v_to_add > 0 THEN
    INSERT INTO stock_moves(picking_id, product_id, variant_id, source_location_id,
                            destination_location_id, quantity, state)
    VALUES (v_picking, v_line.product_id, v_line.variant_id, v_src_loc, v_dst_loc, v_to_add, 'draft');
    BEGIN
      PERFORM reserve_picking_strict(v_picking);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'reserve failed line=% : %', _line_id, SQLERRM;
    END;
  END IF;

  SELECT COALESCE(SUM(reserved_quantity),0) INTO v_already
    FROM stock_moves
   WHERE picking_id=v_picking
     AND product_id=v_line.product_id
     AND COALESCE(variant_id::text,'') = COALESCE(v_line.variant_id::text,'')
     AND state IN ('ready','draft');
  RETURN v_already;
END $function$;

-- -------------------------------------------------------------
-- A) mfg_create_mo_for_line: nova assinatura (_so,_line,_qty)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mfg_create_mo_for_line(_so uuid, _line uuid, _qty numeric DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  so record; sol record; prod record;
  v_existing uuid; v_existing_state text; v_existing_qty numeric;
  v_resolved jsonb; v_blockers jsonb; v_lines jsonb; v_outputs jsonb;
  v_line jsonb; v_out jsonb;
  v_ctx jsonb := '{}'::jsonb;
  v_qty numeric;
  v_include_optional boolean := false;
  new_id uuid; v_bom_id uuid; v_op_count int;
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

  IF _qty IS NOT NULL THEN
    IF _qty <= 0 OR _qty > COALESCE(sol.quantity,0) THEN
      RAISE EXCEPTION 'mfg_create_mo_for_line: invalid _qty=% for line % (sol.quantity=%)', _qty, _line, sol.quantity
        USING ERRCODE = '22023';
    END IF;
    v_qty := _qty;
  ELSE
    v_qty := sol.quantity;
  END IF;

  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'mfg_create_mo_for_line: invalid qty % for sale_order_line %', v_qty, _line
      USING ERRCODE = '22023';
  END IF;

  SELECT id, state::text, qty INTO v_existing, v_existing_state, v_existing_qty
    FROM public.manufacturing_orders
   WHERE sale_order_line_id = _line
     AND parent_mo_id IS NULL
     AND state NOT IN ('cancelled','done')
   ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing_state = 'draft' AND v_existing_qty IS DISTINCT FROM v_qty THEN
      UPDATE public.manufacturing_orders SET qty = v_qty, updated_at = now() WHERE id = v_existing;
      PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = v_existing;
      PERFORM public.mfg_plan_components(v_existing, 0);
    ELSIF v_existing_state <> 'draft' AND v_existing_qty IS DISTINCT FROM v_qty THEN
      BEGIN
        PERFORM public.log_record_event(
          'manufacturing_orders'::text, v_existing, 'mfg.qty_divergence'::text,
          format('qty em falta divergente: MO=%s vs falta=%s (estado=%s)', v_existing_qty, v_qty, v_existing_state)::text,
          jsonb_build_object('mo_qty', v_existing_qty, 'needed_qty', v_qty, 'mo_state', v_existing_state)
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
      PERFORM public.mfg_plan_components(v_existing, 0);
    ELSE
      PERFORM public.mfg_plan_components(v_existing, 0);
    END IF;
    RETURN v_existing;
  END IF;

  IF prod.supply_route IS NOT NULL
     AND prod.supply_route::text NOT IN ('manufacture','buy_or_manufacture') THEN
    RETURN NULL;
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
END $function$;

-- -------------------------------------------------------------
-- A) _so_ensure_mo_for_line: passar _qty ao planner
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._so_ensure_mo_for_line(_line_id uuid, _qty numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line sale_order_lines%ROWTYPE;
  v_mo uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_line FROM public.sale_order_lines WHERE id=_line_id;
  IF v_line.id IS NULL THEN RETURN NULL; END IF;
  v_mo := public.mfg_create_mo_for_line(v_line.order_id, _line_id, _qty);
  RETURN v_mo;
END
$function$;

-- -------------------------------------------------------------
-- C) tg_zz_mo_done_replan: log + notify em vez de swallow silencioso
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_zz_mo_done_replan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_so uuid; v_sp uuid; v_creator uuid; v_err text;
BEGIN
  IF NEW.state='done' AND COALESCE(OLD.state::text,'') <> 'done' THEN
    v_owner_so := NEW.root_sale_order_id;
    IF v_owner_so IS NULL THEN
      SELECT sol.order_id INTO v_owner_so
        FROM sale_order_line_supply_links sl
        JOIN sale_order_lines sol ON sol.id = sl.sale_order_line_id
       WHERE sl.manufacturing_order_id = NEW.id AND sl.state='active' LIMIT 1;
    END IF;
    IF v_owner_so IS NULL THEN v_owner_so := NEW.sale_order_id; END IF;

    UPDATE sale_order_line_supply_links
      SET state='consumed', updated_at=now()
     WHERE manufacturing_order_id = NEW.id AND state='active';

    IF v_owner_so IS NOT NULL THEN
      BEGIN
        PERFORM so_run_operational_plan(v_owner_so,'mo_done');
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
        BEGIN
          INSERT INTO public.sale_operational_plan_log(sale_order_id, mode, error, summary)
          VALUES (v_owner_so, 'mo_done_failed', v_err,
                  jsonb_build_object('mo_id', NEW.id, 'mo_code', NEW.code));
        EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN
          v_creator := NEW.created_by;
          SELECT salesperson_id INTO v_sp FROM public.sale_orders WHERE id = v_owner_so;
          IF v_creator IS NOT NULL THEN
            PERFORM public.notify_user(v_creator,
              format('Replaneamento falhou após conclusão da MO %s — reserva pode não ter sido efetuada', COALESCE(NEW.code, NEW.id::text)),
              'manufacturing', NEW.id::text);
          END IF;
          IF v_sp IS NOT NULL AND v_sp <> COALESCE(v_creator, '00000000-0000-0000-0000-000000000000'::uuid) THEN
            PERFORM public.notify_user(v_sp,
              format('Replaneamento falhou após conclusão da MO %s — reserva pode não ter sido efetuada', COALESCE(NEW.code, NEW.id::text)),
              'manufacturing', NEW.id::text);
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
      BEGIN PERFORM so_emit_timeline(v_owner_so,'manufacturing.done', NULL, NEW.id::text,
        jsonb_build_object('mo_id',NEW.id), 'mo_done'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- -------------------------------------------------------------
-- C) close_mo: sale_active branch action='intent' + notes explícito
--    (apenas 2 alterações textuais em relação à função existente)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_mo(_mo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mo record; produced numeric; loc uuid;
  q record; parent_mo record; before_q numeric; before_res numeric;
  v_parent_mo_id uuid; v_parent_variant_id uuid; v_parent_comp_id uuid;
  v_child_uom uuid; v_parent_uom uuid; v_conv numeric; v_ok boolean;
  v_check_cnt int; v_pass_cnt int; v_case text;
  total_consumed numeric := 0;
  dst_q record; scrap_qty numeric := 0; scrap_loc uuid;
  v_pkg_tracking boolean; v_pkg_id uuid; v_pkg_type text := 'CX';
  v_per_unit numeric; v_unit_count int; v_seq int := 1;
  v_pallet_id uuid; v_pallet_ref text;
  v_so_id uuid; v_sol_id uuid; v_payload jsonb;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id = _mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO % not found', _mo; END IF;
  IF mo.state = 'done' THEN RETURN jsonb_build_object('skip','already_done'); END IF;

  SELECT count(*), count(*) FILTER (WHERE result='pass')
    INTO v_check_cnt, v_pass_cnt
    FROM public.mo_quality_checks WHERE mo_id = _mo;
  IF v_check_cnt > 0 AND v_pass_cnt < v_check_cnt THEN
    RAISE EXCEPTION 'MO % tem controles de qualidade pendentes ou reprovados', _mo USING ERRCODE='P0001';
  END IF;

  produced := GREATEST(0, COALESCE(mo.qty_produced, mo.qty, 0));

  FOR q IN
    SELECT sm.id, sm.quantity, sm.reserved_quantity, sq.id AS quant_id, sq.quantity AS q_qty, sq.reserved_quantity AS q_res,
           sq.location_id
      FROM public.mo_components c
      JOIN public.stock_moves sm ON sm.mo_component_id = c.id
      JOIN public.stock_quants sq ON sq.product_id = sm.product_id AND sq.location_id = sm.source_location_id
     WHERE c.mo_id = _mo
       AND sm.state IN ('draft','ready')
     ORDER BY sm.id
     FOR UPDATE OF sq, sm
  LOOP
    DECLARE take numeric := LEAST(q.reserved_quantity, q.q_res);
    BEGIN
      IF take <= 0 THEN CONTINUE; END IF;
      before_q := q.quantity; before_res := q.reserved_quantity;
      UPDATE public.stock_quants
         SET quantity = GREATEST(0, quantity - take),
             reserved_quantity = GREATEST(0, reserved_quantity - take),
             updated_at = now()
       WHERE id = q.quant_id;
      UPDATE public.stock_moves
         SET reserved_quantity = GREATEST(0, reserved_quantity - take),
             state = 'done'
       WHERE id = q.id;
      total_consumed := total_consumed + take;
    END;
  END LOOP;

  UPDATE public.mo_components c
     SET qty_reserved = GREATEST(0, COALESCE(qty_reserved,0) - total_consumed)
   WHERE c.mo_id = _mo;

  loc := public.default_location(mo.warehouse_id, 'FinishedGoods');
  IF loc IS NULL THEN loc := public.default_location(mo.warehouse_id,'Stock'); END IF;
  IF loc IS NULL THEN RAISE EXCEPTION 'no destination location'; END IF;

  SELECT * INTO parent_mo FROM public.manufacturing_orders WHERE id = mo.parent_mo_id;

  SELECT * INTO dst_q FROM public.stock_quants
   WHERE product_id = mo.product_id AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(mo.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND location_id = loc FOR UPDATE;

  IF dst_q.id IS NULL THEN
    before_res := 0;
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (mo.product_id, mo.variant_id, loc, produced, 0)
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
  ELSE
    UPDATE public.stock_quants SET quantity = quantity + produced, updated_at = now() WHERE id = dst_q.id;
  END IF;

  IF parent_mo.id IS NOT NULL THEN
    v_case := 'sub_assembly';
  ELSIF mo.sale_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.sale_orders WHERE id=mo.sale_order_id AND state IN ('confirmed','draft')) THEN
    v_case := 'sale_active';
  ELSIF mo.sale_order_id IS NOT NULL THEN
    v_case := 'cancelled_sale';
  ELSE v_case := 'manual'; END IF;

  IF v_case = 'sub_assembly' THEN
    v_parent_mo_id := parent_mo.id;
    SELECT c.id, c.variant_id, c.uom_id INTO v_parent_comp_id, v_parent_variant_id, v_parent_uom
      FROM public.mo_components c
     WHERE c.mo_id = v_parent_mo_id AND c.product_id = mo.product_id LIMIT 1;
    SELECT uom_id INTO v_child_uom FROM public.manufacturing_orders WHERE id = _mo;
    v_conv := public.get_uom_conversion(v_child_uom, v_parent_uom);
    IF v_conv IS NULL OR v_conv <= 0 THEN v_conv := 1; END IF;
    before_res := dst_q.reserved_quantity;
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (mo.product_id, mo.variant_id, loc, 0, 0)
    ON CONFLICT DO NOTHING
    RETURNING id, reserved_quantity INTO dst_q.id, dst_q.reserved_quantity;
    UPDATE public.stock_quants
       SET reserved_quantity = reserved_quantity + produced, updated_at = now()
     WHERE id = dst_q.id AND reserved_quantity + produced <= quantity;
    UPDATE public.mo_components
       SET qty_reserved = LEAST(qty_required, COALESCE(qty_reserved,0) + produced),
           updated_at = now()
     WHERE id = v_parent_comp_id;
    v_payload := jsonb_build_object('source','close_mo_subassembly_reserve_for_parent_mo',
      'mo_id', _mo, 'parent_mo_id', v_parent_mo_id, 'parent_component_id', v_parent_comp_id, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'reserve', auth.uid(),
       'close_mo sub_assembly reserve for parent mo_component',
       v_payload);
    PERFORM public.mfg_refresh_component(v_parent_comp_id);
    PERFORM public.mfg_refresh_mo_state(v_parent_mo_id);
  ELSIF v_case = 'sale_active' THEN
    v_so_id := mo.sale_order_id; v_sol_id := mo.sale_order_line_id;
    v_payload := jsonb_build_object('source','close_mo_reserve_finished_for_sale',
      'mo_id', _mo, 'sale_order_id', v_so_id, 'sale_order_line_id', v_sol_id, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, to_sale_order_line_id, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, before_res, before_res + produced,
       'MO', _mo, 'intent', auth.uid(),
       'close_mo finished_good intent — reserva efetiva ocorre no replan pós-MO', v_sol_id, v_payload);
  ELSE
    v_payload := jsonb_build_object('source',
      CASE WHEN v_case = 'manual' THEN 'close_mo_for_stock' ELSE 'close_mo_cancelled_sale_to_stock' END,
      'mo_id', _mo, 'qty', produced);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES (mo.product_id, mo.variant_id, loc, NULL, produced, 0, produced,
       'MO', _mo, 'consume', auth.uid(),
       'close_mo finished_good to free stock', v_payload);
  END IF;

  SELECT COALESCE(package_tracking, false) INTO v_pkg_tracking FROM public.products WHERE id = mo.product_id;
  IF v_pkg_tracking THEN
    v_unit_count := CASE WHEN produced = floor(produced) AND produced >= 1 THEN produced::int ELSE 1 END;
    v_per_unit := produced / v_unit_count;
    v_pallet_ref := 'PLT-' || substr(_mo::text,1,8);
    INSERT INTO public.warehouse_pallets(reference, location_id) VALUES (v_pallet_ref, loc)
    ON CONFLICT (reference) DO NOTHING RETURNING id INTO v_pallet_id;
    IF v_pallet_id IS NULL THEN SELECT id INTO v_pallet_id FROM public.warehouse_pallets WHERE reference = v_pallet_ref; END IF;

    FOR v_seq IN 1..v_unit_count LOOP
      INSERT INTO public.stock_packages(
        product_id, variant_id, quantity, package_type, location_id,
        status, source_manufacturing_order_id, source_sale_order_id, source_sale_order_line_id,
        pallet_id, sequence_in_pallet
      ) VALUES (
        mo.product_id, mo.variant_id, v_per_unit, v_pkg_type, loc,
        CASE
          WHEN v_case = 'sale_active'  THEN 'reserved'::package_status
          WHEN v_case = 'sub_assembly' THEN 'reserved'::package_status
          ELSE 'available'::package_status
        END,
        _mo,
        CASE WHEN v_case='sale_active' THEN mo.sale_order_id ELSE NULL END,
        CASE WHEN v_case='sale_active' THEN mo.sale_order_line_id ELSE NULL END,
        v_pallet_id, v_seq
      );
    END LOOP;
  END IF;

  scrap_qty := COALESCE((SELECT SUM(qty_scrap) FROM public.mo_operations WHERE mo_id = _mo), 0);
  IF scrap_qty > 0 THEN
    scrap_loc := public.default_location(mo.warehouse_id,'Scrap');
    IF scrap_loc IS NULL THEN scrap_loc := loc; END IF;
    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    VALUES (mo.product_id, mo.variant_id, scrap_loc, scrap_qty, 0)
    ON CONFLICT DO NOTHING;
    UPDATE public.stock_quants SET quantity = quantity + scrap_qty, updated_at = now()
     WHERE product_id = mo.product_id AND location_id = scrap_loc
       AND COALESCE(variant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(mo.variant_id,'00000000-0000-0000-0000-000000000000'::uuid)
       AND ctid = (SELECT ctid FROM public.stock_quants
                    WHERE product_id = mo.product_id AND location_id = scrap_loc
                      AND COALESCE(variant_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(mo.variant_id,'00000000-0000-0000-0000-000000000000'::uuid)
                    ORDER BY updated_at DESC LIMIT 1);
    v_payload := jsonb_build_object('source','close_mo_scrap','mo_id',_mo,'qty',scrap_qty);
    INSERT INTO public.stock_reservation_log
      (product_id, variant_id, location_id, lot_id, qty, qty_before, qty_after,
       origin_type, origin_id, action, reserved_by, notes, payload)
    VALUES (mo.product_id, mo.variant_id, scrap_loc, NULL, scrap_qty, 0, scrap_qty,
       'MO', _mo, 'scrap', auth.uid(), 'close_mo scrap output', v_payload);
  END IF;

  UPDATE public.manufacturing_orders
     SET state = 'done', actual_end = COALESCE(actual_end, now()), updated_at = now()
   WHERE id = _mo;

  RETURN jsonb_build_object('ok', true, 'produced', produced, 'case', v_case, 'consumed', total_consumed);
END $function$;

-- -------------------------------------------------------------
-- D) Helpers de gating/estado
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mfg_assert_sequence_ok(_op uuid, _override_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  op record; v_pending text;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada' USING ERRCODE='P0002'; END IF;

  SELECT string_agg(format('#%s %s (state=%s)', sequence, COALESCE(name,'—'), state), ', ' ORDER BY sequence)
    INTO v_pending
    FROM public.mo_operations
   WHERE mo_id = op.mo_id
     AND sequence < op.sequence
     AND state NOT IN ('done','skipped','cancelled')
     AND COALESCE(is_qc,false) = false;

  IF v_pending IS NULL THEN RETURN; END IF;

  IF _override_reason IS NULL OR btrim(_override_reason) = '' THEN
    RAISE EXCEPTION 'PREVIOUS_OPERATIONS_PENDING: %', v_pending USING ERRCODE='P0001';
  END IF;

  BEGIN
    INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, notes)
    VALUES (_op, op.mo_id, auth.uid(), now(),
            format('override sequência: %s — operações pendentes: %s', _override_reason, v_pending));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    PERFORM public.log_record_event(
      'manufacturing_orders'::text, op.mo_id, 'mfg.sequence_override'::text,
      format('início fora de sequência (op #%s): %s — pendentes: %s', op.sequence, _override_reason, v_pending)::text,
      jsonb_build_object('op_id', _op, 'reason', _override_reason, 'pending', v_pending)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $function$;

CREATE OR REPLACE FUNCTION public._mfg_assert_start_ok(_op uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE op record;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada' USING ERRCODE='P0002'; END IF;
  IF op.state = 'done' THEN
    RAISE EXCEPTION 'operação já concluída' USING ERRCODE='P0001';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public._mfg_assert_finish_ok(_op uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE op record;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada' USING ERRCODE='P0002'; END IF;
  IF op.started_at IS NULL THEN
    RAISE EXCEPTION 'operação nunca foi iniciada (started_at IS NULL)' USING ERRCODE='P0001';
  END IF;
END $function$;

-- -------------------------------------------------------------
-- D) mfg_start_operation com override
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mfg_start_operation(_op uuid, _override_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE op record; mo record;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=op.mo_id;
  IF mo.state IN ('done','cancelled') THEN RAISE EXCEPTION 'Ordem encerrada'; END IF;

  PERFORM public._mfg_assert_start_ok(_op);
  PERFORM public._mfg_assert_sequence_ok(_op, _override_reason);

  UPDATE public.mo_operations
     SET state='in_progress', operator_id=auth.uid(),
         started_at = COALESCE(started_at, now())
   WHERE id=_op;

  UPDATE public.manufacturing_orders
     SET state='in_progress',
         actual_start = COALESCE(actual_start, now()),
         blocked_reason = NULL
   WHERE id=op.mo_id AND state IN ('draft','ready','waiting_material','paused');

  INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at)
  VALUES (_op, op.mo_id, auth.uid(), now());

  PERFORM public.mfg_sync_sol_status(op.mo_id);
END $function$;

-- -------------------------------------------------------------
-- D) mfg_finish_operation: proteção started_at
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mfg_finish_operation(_op uuid, _qty_done numeric, _qty_scrap numeric, _notes text, _attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _mo uuid; _seq int; _is_qc boolean; _has_more boolean;
BEGIN
  PERFORM public._mfg_assert_finish_ok(_op);

  UPDATE public.mo_operations
     SET state = 'done', finished_at = now(),
         qty_done = COALESCE(_qty_done, qty_done),
         qty_scrap = COALESCE(_qty_scrap, qty_scrap)
   WHERE id = _op
   RETURNING mo_id, sequence, is_qc INTO _mo, _seq, _is_qc;

  INSERT INTO public.mo_workorder_logs (mo_operation_id, mo_id, operator_id, started_at, finished_at, qty_done, qty_scrap, notes, attachments)
  VALUES (_op, _mo, auth.uid(), now(), now(), _qty_done, _qty_scrap, _notes, COALESCE(_attachments, '[]'::jsonb));

  SELECT EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id = _mo AND state <> 'done') INTO _has_more;
  IF NOT _has_more THEN
    UPDATE public.manufacturing_orders SET state = 'qc', updated_at = now() WHERE id = _mo AND state <> 'qc';
  END IF;
END $function$;

-- -------------------------------------------------------------
-- D) work_order_start: usar helper (gating soft com override)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_order_start(_work_order_id uuid, _employee_id uuid DEFAULT NULL::uuid, _machine_id uuid DEFAULT NULL::uuid, _override_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE wo record; mch record; v_prev int; v_busy int;
BEGIN
  SELECT * INTO wo FROM public.mo_operations WHERE id = _work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF wo.state NOT IN ('ready','paused') THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_READY: state=%', wo.state USING ERRCODE='P0001';
  END IF;
  PERFORM public._mfg_assert_sequence_ok(_work_order_id, _override_reason);
  IF EXISTS(
    SELECT 1 FROM public.mo_components c
    WHERE c.mo_id = wo.mo_id
      AND (c.operation_id IS NULL OR c.operation_id = wo.operation_id)
      AND c.is_critical = true
      AND COALESCE(c.qty_reserved,0) < c.qty_required
  ) THEN
    UPDATE public.mo_operations SET state='blocked', block_reason='CRITICAL_COMPONENT_MISSING' WHERE id=_work_order_id;
    RAISE EXCEPTION 'CRITICAL_COMPONENT_MISSING' USING ERRCODE='P0001';
  END IF;
  IF _machine_id IS NOT NULL THEN
    SELECT * INTO mch FROM public.manufacturing_machines WHERE id=_machine_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MACHINE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF mch.status NOT IN ('available') THEN
      RAISE EXCEPTION 'MACHINE_UNAVAILABLE: status=%', mch.status USING ERRCODE='P0001';
    END IF;
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE machine_id=_machine_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'MACHINE_BUSY' USING ERRCODE='P0001'; END IF;
    UPDATE public.manufacturing_machines SET status='busy', updated_at=clock_timestamp() WHERE id=_machine_id;
  END IF;
  IF _employee_id IS NOT NULL THEN
    SELECT count(*) INTO v_busy FROM public.mo_operations
      WHERE assigned_employee_id=_employee_id AND state='in_progress' AND id<>_work_order_id;
    IF v_busy > 0 THEN RAISE EXCEPTION 'EMPLOYEE_BUSY' USING ERRCODE='P0001'; END IF;
  END IF;
  UPDATE public.mo_operations SET
    state = 'in_progress',
    actual_start_at = COALESCE(actual_start_at, clock_timestamp()),
    started_at = COALESCE(started_at, clock_timestamp()),
    assigned_employee_id = COALESCE(_employee_id, assigned_employee_id),
    machine_id = COALESCE(_machine_id, machine_id),
    block_reason = NULL
  WHERE id = _work_order_id;
  INSERT INTO public.mo_workorder_logs(mo_operation_id, mo_id, operator_id, started_at, qty_done, qty_scrap, notes)
  VALUES (_work_order_id, wo.mo_id, _employee_id, clock_timestamp(), 0, 0, 'start');
  IF (SELECT state FROM public.manufacturing_orders WHERE id = wo.mo_id) IN ('draft','ready','waiting_material') THEN
    UPDATE public.manufacturing_orders SET state='in_progress', actual_start=COALESCE(actual_start, clock_timestamp()), updated_at=clock_timestamp()
      WHERE id = wo.mo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'work_order_id', _work_order_id, 'state','in_progress');
END $function$;

-- =============================================================
-- E) _test_mfg_fixes(): teste de regressão
-- =============================================================
CREATE OR REPLACE FUNCTION public._test_mfg_fixes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag text := 'TMF_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_wh uuid; v_uom uuid; v_stock_loc uuid;
  v_partner uuid; v_product uuid; v_variant_a uuid; v_variant_b uuid;
  v_attr uuid; v_val_a uuid; v_val_b uuid;
  v_so uuid; v_sol uuid;
  v_mo uuid; v_mo_qty numeric;
  v_move_variant uuid; v_reserved_via_variant numeric;
  v_op1 uuid; v_op2 uuid; v_op3 uuid;
  v_seq_err text; v_ok_after_override boolean;
  v_finish_err text;
  v_before int; v_after int;
  v_canonical jsonb;
  v_results jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_wh FROM warehouses ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'no warehouse'; END IF;
  SELECT id INTO v_uom FROM product_uom ORDER BY id LIMIT 1;
  v_stock_loc := public.default_location(v_wh,'Stock');

  ---------------------------------------------------------------
  -- (a) qty MO = qty em falta
  ---------------------------------------------------------------
  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI-A', true) RETURNING id INTO v_partner;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, can_be_manufactured, uom_id, supply_route)
  VALUES (v_tag||' PROD-A','storable',true,false,true,v_uom,'manufacture'::product_supply_route)
  RETURNING id INTO v_product;

  INSERT INTO boms(product_id, code, quantity, uom_id, active)
  VALUES (v_product, v_tag||'-BOM', 1, v_uom, true);

  INSERT INTO stock_quants(product_id, location_id, quantity, reserved_quantity)
  VALUES (v_product, v_stock_loc, 2, 0);

  INSERT INTO sale_orders(name, partner_id, warehouse_id, state)
  VALUES (v_tag||'-A', v_partner, v_wh, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_uom, 3, 10, 30, 'product') RETURNING id INTO v_sol;

  PERFORM confirm_sale_order(v_so);

  SELECT id, qty INTO v_mo, v_mo_qty
    FROM manufacturing_orders
   WHERE sale_order_line_id = v_sol AND parent_mo_id IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_mo IS NULL THEN RAISE EXCEPTION 'FAIL (a): MO não criada'; END IF;
  IF v_mo_qty <> 1 THEN RAISE EXCEPTION 'FAIL (a): MO.qty=% (esperado 1)', v_mo_qty; END IF;
  v_results := v_results || jsonb_build_object('a_mo_qty_delta', jsonb_build_object('mo_id',v_mo,'qty',v_mo_qty,'expected',1));

  ---------------------------------------------------------------
  -- (b) variant_id no move de reserva
  ---------------------------------------------------------------
  INSERT INTO partners(name, is_customer) VALUES (v_tag||' CLI-B', true) RETURNING id INTO v_partner;
  INSERT INTO products(name, type, can_be_sold, can_be_purchased, uom_id, has_variants, supply_route)
  VALUES (v_tag||' PROD-B','storable',true,false,v_uom,true,'buy'::product_supply_route)
  RETURNING id INTO v_product;

  INSERT INTO product_attributes(name) VALUES (v_tag||'-COR') RETURNING id INTO v_attr;
  INSERT INTO product_attribute_values(attribute_id, name) VALUES (v_attr,'A') RETURNING id INTO v_val_a;
  INSERT INTO product_attribute_values(attribute_id, name) VALUES (v_attr,'B') RETURNING id INTO v_val_b;
  INSERT INTO product_variants(product_id, name) VALUES (v_product, v_tag||' VAR-A') RETURNING id INTO v_variant_a;
  INSERT INTO product_variants(product_id, name) VALUES (v_product, v_tag||' VAR-B') RETURNING id INTO v_variant_b;
  INSERT INTO product_variant_values(variant_id, value_id) VALUES (v_variant_a, v_val_a);
  INSERT INTO product_variant_values(variant_id, value_id) VALUES (v_variant_b, v_val_b);

  INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
  VALUES (v_product, v_variant_a, v_stock_loc, 5, 0);
  INSERT INTO stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
  VALUES (v_product, v_variant_b, v_stock_loc, 5, 0);

  INSERT INTO sale_orders(name, partner_id, warehouse_id, state)
  VALUES (v_tag||'-B', v_partner, v_wh, 'draft') RETURNING id INTO v_so;
  INSERT INTO sale_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal, line_kind)
  VALUES (v_so, v_product, v_variant_a, v_uom, 2, 10, 20, 'product') RETURNING id INTO v_sol;

  PERFORM confirm_sale_order(v_so);

  SELECT variant_id, reserved_quantity INTO v_move_variant, v_reserved_via_variant
    FROM stock_moves sm
    JOIN stock_pickings sp ON sp.id = sm.picking_id
   WHERE sp.origin = (SELECT name FROM sale_orders WHERE id=v_so)
     AND sm.product_id = v_product
   ORDER BY sm.created_at DESC LIMIT 1;
  IF v_move_variant IS DISTINCT FROM v_variant_a THEN
    RAISE EXCEPTION 'FAIL (b): move variant_id=% expected %', v_move_variant, v_variant_a;
  END IF;
  IF (SELECT reserved_quantity FROM stock_quants WHERE product_id=v_product AND variant_id=v_variant_a) < 2 THEN
    RAISE EXCEPTION 'FAIL (b): quant da variante A não reservou';
  END IF;
  IF (SELECT reserved_quantity FROM stock_quants WHERE product_id=v_product AND variant_id=v_variant_b) <> 0 THEN
    RAISE EXCEPTION 'FAIL (b): quant da variante B foi tocada indevidamente';
  END IF;
  v_results := v_results || jsonb_build_object('b_variant_isolation', jsonb_build_object('move_variant',v_move_variant,'reserved',v_reserved_via_variant));

  ---------------------------------------------------------------
  -- (c) MO done com replan a falhar → log + MO fecha
  ---------------------------------------------------------------
  SELECT count(*) INTO v_before FROM sale_operational_plan_log WHERE mode='mo_done_failed';
  INSERT INTO manufacturing_orders(code, product_id, qty, uom_id, warehouse_id, state, origin, sale_order_id, root_sale_order_id)
  VALUES (public.mfg_next_code(), v_product, 1, v_uom, v_wh, 'in_progress'::mo_state, 'sale',
          '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
  RETURNING id INTO v_mo;
  UPDATE manufacturing_orders SET state='done' WHERE id=v_mo;
  SELECT count(*) INTO v_after FROM sale_operational_plan_log WHERE mode='mo_done_failed';
  IF v_after <= v_before THEN
    RAISE EXCEPTION 'FAIL (c): sale_operational_plan_log não registou mo_done_failed (before=%, after=%)', v_before, v_after;
  END IF;
  IF (SELECT state::text FROM manufacturing_orders WHERE id=v_mo) <> 'done' THEN
    RAISE EXCEPTION 'FAIL (c): MO não fechou apesar do erro';
  END IF;
  v_results := v_results || jsonb_build_object('c_mo_done_failed_logged', jsonb_build_object('delta', v_after - v_before));

  ---------------------------------------------------------------
  -- (d) gating de sequência via work_order_start
  ---------------------------------------------------------------
  INSERT INTO manufacturing_orders(code, product_id, qty, uom_id, warehouse_id, state, origin)
  VALUES (public.mfg_next_code(), v_product, 1, v_uom, v_wh, 'ready'::mo_state, 'manual')
  RETURNING id INTO v_mo;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
  VALUES (v_mo, 10, 'Op1', 30, 'ready'::mo_op_state) RETURNING id INTO v_op1;
  INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
  VALUES (v_mo, 20, 'Op2', 30, 'ready'::mo_op_state) RETURNING id INTO v_op2;

  v_seq_err := NULL;
  BEGIN
    PERFORM public.work_order_start(v_op2, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_seq_err := SQLERRM;
  END;
  IF v_seq_err IS NULL OR v_seq_err NOT LIKE 'PREVIOUS_OPERATIONS_PENDING%' THEN
    RAISE EXCEPTION 'FAIL (d): esperava PREVIOUS_OPERATIONS_PENDING, obteve: %', COALESCE(v_seq_err,'(sem erro)');
  END IF;

  BEGIN
    PERFORM public.work_order_start(v_op2, NULL, NULL, 'urgência cliente teste');
    v_ok_after_override := true;
  EXCEPTION WHEN OTHERS THEN
    v_ok_after_override := false;
    RAISE EXCEPTION 'FAIL (d): override devia passar mas falhou: %', SQLERRM;
  END;

  IF NOT EXISTS(SELECT 1 FROM mo_workorder_logs WHERE mo_operation_id=v_op2 AND notes LIKE 'override sequência%') THEN
    RAISE EXCEPTION 'FAIL (d): log de override não registado';
  END IF;
  v_results := v_results || jsonb_build_object('d_sequence_gating', jsonb_build_object('blocked_without_reason',true,'passed_with_reason',v_ok_after_override));

  v_finish_err := NULL;
  BEGIN
    INSERT INTO mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (v_mo, 30, 'Op3', 15, 'ready'::mo_op_state) RETURNING id INTO v_op3;
    PERFORM public.mfg_finish_operation(v_op3, 1, 0, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_finish_err := SQLERRM;
  END;
  IF v_finish_err IS NULL OR v_finish_err NOT LIKE '%nunca foi iniciada%' THEN
    RAISE EXCEPTION 'FAIL (d.finish): esperava proteção, obteve: %', COALESCE(v_finish_err,'(sem erro)');
  END IF;
  v_results := v_results || jsonb_build_object('d_finish_guard', jsonb_build_object('protected', true));

  ---------------------------------------------------------------
  -- (e) rerun canonical supply
  ---------------------------------------------------------------
  v_canonical := public._test_supply_canonical_path();
  v_results := v_results || jsonb_build_object('e_supply_canonical', v_canonical);

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END $function$;
