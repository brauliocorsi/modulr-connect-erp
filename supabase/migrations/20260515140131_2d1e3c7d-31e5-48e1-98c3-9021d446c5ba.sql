
-- 1. Origem
DO $$ BEGIN
  CREATE TYPE public.mo_origin AS ENUM ('sale','manual','replenishment','rework','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.manufacturing_orders
  ADD COLUMN IF NOT EXISTS origin public.mo_origin NOT NULL DEFAULT 'manual';

-- Backfill: vindas de venda
UPDATE public.manufacturing_orders
   SET origin = 'sale'
 WHERE sale_order_id IS NOT NULL AND origin = 'manual';

CREATE INDEX IF NOT EXISTS idx_mo_origin ON public.manufacturing_orders(origin);

-- 2. Atualizar criação automática vinda de Vendas para marcar origem
CREATE OR REPLACE FUNCTION public.mfg_create_mo_for_line(_so uuid, _line uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE so record; sol record; prod record; b record; new_id uuid; ratio numeric;
BEGIN
  SELECT * INTO so FROM public.sale_orders WHERE id=_so;
  SELECT * INTO sol FROM public.sale_order_lines WHERE id=_line;
  IF sol.line_kind IS NOT NULL AND sol.line_kind <> 'product' THEN RETURN NULL; END IF;
  SELECT * INTO prod FROM public.products WHERE id = sol.product_id;
  IF prod IS NULL OR NOT prod.can_be_manufactured THEN RETURN NULL; END IF;

  SELECT * INTO b FROM public.boms
   WHERE product_id = sol.product_id AND active = true
     AND (variant_id IS NULL OR variant_id = sol.variant_id)
   ORDER BY (variant_id IS NOT NULL) DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.manufacturing_orders(
    code, sale_order_id, sale_order_line_id, partner_id,
    product_id, variant_id, bom_id, qty, uom_id,
    warehouse_id, due_date, created_by, state, origin
  ) VALUES (
    public.mfg_next_code(), _so, _line, so.partner_id,
    sol.product_id, sol.variant_id, b.id, sol.quantity, sol.uom_id,
    so.warehouse_id, so.commitment_date, auth.uid(), 'draft', 'sale'
  ) RETURNING id INTO new_id;

  ratio := sol.quantity / NULLIF(b.quantity,0);

  INSERT INTO public.mo_components(mo_id, product_id, variant_id, uom_id, qty_required, sequence)
  SELECT new_id, bl.component_product_id, bl.component_variant_id, bl.uom_id,
         (bl.quantity * COALESCE(ratio,1))::numeric, bl.sequence
  FROM public.bom_lines bl WHERE bl.bom_id = b.id;

  INSERT INTO public.mo_operations(mo_id, sequence, name, workcenter, planned_minutes, state)
  SELECT new_id, bo.sequence, bo.name, bo.workcenter,
         (bo.duration_minutes * COALESCE(ratio,1))::numeric,
         'pending'::mo_op_state
  FROM public.bom_operations bo WHERE bo.bom_id = b.id;

  IF NOT EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id=new_id) THEN
    INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (new_id, 10, 'Produção', 60, 'pending');
  END IF;

  INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, is_qc)
  VALUES (new_id, 9999, 'Controle de Qualidade', 15, 'pending', true);

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = new_id;
  PERFORM public.mfg_refresh_mo_state(new_id);
  PERFORM public.mfg_sync_sol_status(new_id);

  PERFORM public.notify_user(ug.user_id, 'manufacturing','mo_created',
    'Nova ordem de fabricação',
    format('%s — %s x %s', (SELECT code FROM public.manufacturing_orders WHERE id=new_id), prod.name, sol.quantity),
    '/manufacturing/orders/'||new_id::text)
  FROM public.user_groups ug
  JOIN public.groups g ON g.id = ug.group_id
  WHERE g.code IN ('production_manager','system_admin');

  RETURN new_id;
END $$;

-- 3. Criação manual
CREATE OR REPLACE FUNCTION public.mfg_create_manual_mo(
  _product uuid,
  _variant uuid,
  _qty numeric,
  _priority public.mo_priority,
  _planned_start timestamptz,
  _planned_end timestamptz,
  _due date,
  _responsible uuid,
  _notes text,
  _origin public.mo_origin
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prod record; b record; new_id uuid; ratio numeric;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para criar ordem de fabricação';
  END IF;
  IF _product IS NULL THEN RAISE EXCEPTION 'Produto obrigatório'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser maior que zero'; END IF;
  IF _origin = 'sale' THEN RAISE EXCEPTION 'Origem inválida para criação manual'; END IF;

  SELECT * INTO prod FROM public.products WHERE id = _product;
  IF prod IS NULL THEN RAISE EXCEPTION 'Produto inexistente'; END IF;
  IF NOT prod.can_be_manufactured THEN RAISE EXCEPTION 'Produto não é fabricável'; END IF;

  SELECT * INTO b FROM public.boms
   WHERE product_id = _product AND active = true
     AND (variant_id IS NULL OR variant_id = _variant)
   ORDER BY (variant_id IS NOT NULL) DESC
   LIMIT 1;

  INSERT INTO public.manufacturing_orders(
    code, product_id, variant_id, bom_id, qty, uom_id,
    priority, planned_start, planned_end, due_date,
    responsible_id, notes, created_by, state, origin
  ) VALUES (
    public.mfg_next_code(), _product, _variant, b.id, _qty, prod.uom_id,
    COALESCE(_priority,'normal'::public.mo_priority),
    _planned_start, _planned_end, _due,
    _responsible, _notes, auth.uid(), 'draft', COALESCE(_origin,'manual'::public.mo_origin)
  ) RETURNING id INTO new_id;

  IF b.id IS NOT NULL THEN
    ratio := _qty / NULLIF(b.quantity,0);

    INSERT INTO public.mo_components(mo_id, product_id, variant_id, uom_id, qty_required, sequence)
    SELECT new_id, bl.component_product_id, bl.component_variant_id, bl.uom_id,
           (bl.quantity * COALESCE(ratio,1))::numeric, bl.sequence
    FROM public.bom_lines bl WHERE bl.bom_id = b.id;

    INSERT INTO public.mo_operations(mo_id, sequence, name, workcenter, planned_minutes, state)
    SELECT new_id, bo.sequence, bo.name, bo.workcenter,
           (bo.duration_minutes * COALESCE(ratio,1))::numeric,
           'pending'::mo_op_state
    FROM public.bom_operations bo WHERE bo.bom_id = b.id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id=new_id) THEN
    INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state)
    VALUES (new_id, 10, 'Produção', 60, 'pending');
  END IF;

  INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, is_qc)
  VALUES (new_id, 9999, 'Controle de Qualidade', 15, 'pending', true);

  PERFORM public.mfg_refresh_component(c.id) FROM public.mo_components c WHERE c.mo_id = new_id;
  PERFORM public.mfg_refresh_mo_state(new_id);

  PERFORM public.notify_user(ug.user_id, 'manufacturing','mo_created',
    'Nova ordem de fabricação (manual)',
    format('%s — %s x %s', (SELECT code FROM public.manufacturing_orders WHERE id=new_id), prod.name, _qty),
    '/manufacturing/orders/'||new_id::text)
  FROM public.user_groups ug
  JOIN public.groups g ON g.id = ug.group_id
  WHERE g.code IN ('production_manager','system_admin')
    AND ug.user_id <> auth.uid();

  RETURN new_id;
END $$;
