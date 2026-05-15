
-- Enums
DO $$ BEGIN CREATE TYPE public.mo_state AS ENUM ('draft','waiting_material','ready','in_progress','paused','qc','done','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mo_priority AS ENUM ('low','normal','high','urgent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mo_op_state AS ENUM ('pending','ready','in_progress','paused','done','blocked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mo_component_status AS ENUM ('pending','reserved','partial','consumed','missing'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mo_issue_kind AS ENUM ('material_missing','damaged','wrong_measure','defect','priority_blocked','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.mo_qc_result AS ENUM ('pass','fail','rework'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sol_mfg_status AS ENUM ('none','pending','waiting_material','in_production','qc','ready_for_delivery','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.sale_order_lines
  ADD COLUMN IF NOT EXISTS manufacturing_status public.sol_mfg_status NOT NULL DEFAULT 'none';

INSERT INTO public.groups(code, name, module)
VALUES ('production_manager','Produção / Gerente','manufacturing'),
       ('shop_floor_operator','Chão de Fábrica / Operador','manufacturing')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.manufacturing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  bom_id uuid REFERENCES public.boms(id) ON DELETE SET NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  uom_id uuid REFERENCES public.product_uom(id),
  priority public.mo_priority NOT NULL DEFAULT 'normal',
  state public.mo_state NOT NULL DEFAULT 'draft',
  warehouse_id uuid,
  responsible_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  due_date date,
  blocked_reason text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mo_state ON public.manufacturing_orders(state);
CREATE INDEX IF NOT EXISTS idx_mo_so ON public.manufacturing_orders(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_mo_partner ON public.manufacturing_orders(partner_id);
CREATE INDEX IF NOT EXISTS idx_mo_due ON public.manufacturing_orders(due_date);
CREATE INDEX IF NOT EXISTS idx_mo_priority ON public.manufacturing_orders(priority);

CREATE TABLE IF NOT EXISTS public.mo_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  uom_id uuid REFERENCES public.product_uom(id),
  qty_required numeric NOT NULL DEFAULT 0,
  qty_reserved numeric NOT NULL DEFAULT 0,
  qty_consumed numeric NOT NULL DEFAULT 0,
  qty_available numeric NOT NULL DEFAULT 0,
  scrap_pct numeric NOT NULL DEFAULT 0,
  status public.mo_component_status NOT NULL DEFAULT 'pending',
  sequence int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moc_mo ON public.mo_components(mo_id);
CREATE INDEX IF NOT EXISTS idx_moc_product ON public.mo_components(product_id);

CREATE TABLE IF NOT EXISTS public.mo_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  sequence int NOT NULL DEFAULT 0,
  name text NOT NULL,
  workcenter text,
  planned_minutes numeric NOT NULL DEFAULT 0,
  state public.mo_op_state NOT NULL DEFAULT 'pending',
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  qty_done numeric NOT NULL DEFAULT 0,
  qty_scrap numeric NOT NULL DEFAULT 0,
  is_qc boolean NOT NULL DEFAULT false,
  is_rework boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moop_mo ON public.mo_operations(mo_id);
CREATE INDEX IF NOT EXISTS idx_moop_state ON public.mo_operations(state);

CREATE TABLE IF NOT EXISTS public.mo_workorder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_operation_id uuid NOT NULL REFERENCES public.mo_operations(id) ON DELETE CASCADE,
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  qty_done numeric NOT NULL DEFAULT 0,
  qty_scrap numeric NOT NULL DEFAULT 0,
  notes text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mowl_mo ON public.mo_workorder_logs(mo_id);
CREATE INDEX IF NOT EXISTS idx_mowl_op ON public.mo_workorder_logs(mo_operation_id);

CREATE TABLE IF NOT EXISTS public.mo_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  mo_operation_id uuid REFERENCES public.mo_operations(id) ON DELETE SET NULL,
  kind public.mo_issue_kind NOT NULL,
  description text,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution text
);
CREATE INDEX IF NOT EXISTS idx_moiss_mo ON public.mo_issues(mo_id);

CREATE TABLE IF NOT EXISTS public.mo_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  mo_operation_id uuid REFERENCES public.mo_operations(id) ON DELETE SET NULL,
  result public.mo_qc_result NOT NULL,
  needs_rework boolean NOT NULL DEFAULT false,
  defects text,
  notes text,
  checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moqc_mo ON public.mo_quality_checks(mo_id);

CREATE OR REPLACE FUNCTION public.tg_mo_touch_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_mo_updated ON public.manufacturing_orders;
CREATE TRIGGER trg_mo_updated BEFORE UPDATE ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_mo_touch_updated();

CREATE OR REPLACE FUNCTION public.mfg_next_code()
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE n int; y text;
BEGIN
  y := to_char(now(), 'YYYY');
  SELECT count(*)+1 INTO n FROM public.manufacturing_orders WHERE code LIKE 'MO/'||y||'/%';
  RETURN 'MO/'||y||'/'||lpad(n::text,5,'0');
END $$;

CREATE OR REPLACE FUNCTION public.mfg_available_qty(_product uuid, _variant uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT COALESCE(SUM(sq.quantity - sq.reserved_quantity),0)
  FROM public.stock_quants sq
  JOIN public.stock_locations sl ON sl.id = sq.location_id
  WHERE sq.product_id = _product
    AND COALESCE(sq.variant_id::text,'') = COALESCE(_variant::text,'')
    AND sl.type = 'internal';
$$;

CREATE OR REPLACE FUNCTION public.mfg_refresh_component(_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c record; avail numeric;
BEGIN
  SELECT * INTO c FROM public.mo_components WHERE id=_id;
  IF NOT FOUND THEN RETURN; END IF;
  avail := public.mfg_available_qty(c.product_id, c.variant_id);
  UPDATE public.mo_components
     SET qty_available = avail,
         status = CASE
           WHEN c.qty_consumed >= c.qty_required THEN 'consumed'::mo_component_status
           WHEN avail >= c.qty_required THEN 'reserved'::mo_component_status
           WHEN avail > 0 THEN 'partial'::mo_component_status
           ELSE 'missing'::mo_component_status
         END
   WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.mfg_refresh_mo_state(_mo uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE all_ok boolean; mo_state_now text;
BEGIN
  SELECT state::text INTO mo_state_now FROM public.manufacturing_orders WHERE id=_mo;
  IF mo_state_now IN ('done','cancelled','in_progress','paused','qc') THEN RETURN; END IF;
  SELECT bool_and(status IN ('reserved','consumed')) INTO all_ok
  FROM public.mo_components WHERE mo_id=_mo;
  UPDATE public.manufacturing_orders
     SET state = CASE WHEN COALESCE(all_ok,true) THEN 'ready'::mo_state ELSE 'waiting_material'::mo_state END,
         blocked_reason = CASE WHEN COALESCE(all_ok,true) THEN NULL ELSE 'Aguardando matéria-prima' END
   WHERE id = _mo;
END $$;

CREATE OR REPLACE FUNCTION public.mfg_sync_sol_status(_mo uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE mo record; new_st public.sol_mfg_status;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=_mo;
  IF mo.sale_order_line_id IS NULL THEN RETURN; END IF;
  new_st := CASE mo.state
    WHEN 'draft' THEN 'pending'::public.sol_mfg_status
    WHEN 'waiting_material' THEN 'waiting_material'::public.sol_mfg_status
    WHEN 'ready' THEN 'pending'::public.sol_mfg_status
    WHEN 'in_progress' THEN 'in_production'::public.sol_mfg_status
    WHEN 'paused' THEN 'in_production'::public.sol_mfg_status
    WHEN 'qc' THEN 'qc'::public.sol_mfg_status
    WHEN 'done' THEN 'ready_for_delivery'::public.sol_mfg_status
    WHEN 'cancelled' THEN 'cancelled'::public.sol_mfg_status
  END;
  UPDATE public.sale_order_lines SET manufacturing_status = new_st WHERE id = mo.sale_order_line_id;
END $$;

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
    warehouse_id, due_date, created_by, state
  ) VALUES (
    public.mfg_next_code(), _so, _line, so.partner_id,
    sol.product_id, sol.variant_id, b.id, sol.quantity, sol.uom_id,
    so.warehouse_id, so.commitment_date, auth.uid(), 'draft'
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

CREATE OR REPLACE FUNCTION public.mfg_create_orders_for_sale(_so uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int := 0; l record; mid uuid;
BEGIN
  FOR l IN
    SELECT sol.id FROM public.sale_order_lines sol
    JOIN public.products p ON p.id = sol.product_id
    WHERE sol.order_id = _so
      AND p.can_be_manufactured = true
      AND NOT EXISTS (SELECT 1 FROM public.manufacturing_orders mo WHERE mo.sale_order_line_id = sol.id)
  LOOP
    mid := public.mfg_create_mo_for_line(_so, l.id);
    IF mid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.tg_so_confirm_create_mo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.state = 'confirmed' AND (OLD.state IS DISTINCT FROM 'confirmed') THEN
    PERFORM public.mfg_create_orders_for_sale(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_so_confirm_mo ON public.sale_orders;
CREATE TRIGGER trg_so_confirm_mo AFTER UPDATE OF state ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_so_confirm_create_mo();

CREATE OR REPLACE FUNCTION public.mfg_start_operation(_op uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op record; mo record;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=op.mo_id;
  IF mo.state IN ('done','cancelled') THEN RAISE EXCEPTION 'Ordem encerrada'; END IF;

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
END $$;

CREATE OR REPLACE FUNCTION public.mfg_finish_operation(_op uuid, _qty_done numeric, _qty_scrap numeric, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op record; remaining int; next_qc boolean;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;

  UPDATE public.mo_operations
     SET state='done', finished_at=now(),
         qty_done = COALESCE(_qty_done, qty_done),
         qty_scrap = COALESCE(_qty_scrap, qty_scrap)
   WHERE id=_op;

  UPDATE public.mo_workorder_logs
     SET finished_at = now(),
         qty_done = COALESCE(_qty_done, qty_done),
         qty_scrap = COALESCE(_qty_scrap, qty_scrap),
         notes = COALESCE(_notes, notes)
   WHERE mo_operation_id=_op AND finished_at IS NULL;

  SELECT count(*) INTO remaining FROM public.mo_operations
   WHERE mo_id=op.mo_id AND state <> 'done' AND is_qc=false;

  SELECT EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id=op.mo_id AND is_qc=true AND state <> 'done')
    INTO next_qc;

  IF remaining = 0 AND next_qc THEN
    UPDATE public.manufacturing_orders SET state='qc' WHERE id=op.mo_id;
  END IF;

  PERFORM public.mfg_sync_sol_status(op.mo_id);
END $$;

CREATE OR REPLACE FUNCTION public.mfg_pause_operation(_op uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op record;
BEGIN
  SELECT * INTO op FROM public.mo_operations WHERE id=_op;
  UPDATE public.mo_operations SET state='paused' WHERE id=_op;
  UPDATE public.manufacturing_orders SET state='paused', blocked_reason=_reason WHERE id=op.mo_id;
  PERFORM public.mfg_sync_sol_status(op.mo_id);
END $$;

CREATE OR REPLACE FUNCTION public.mfg_report_issue(_mo uuid, _op uuid, _kind public.mo_issue_kind, _description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE iid uuid; mo record;
BEGIN
  INSERT INTO public.mo_issues(mo_id, mo_operation_id, kind, description, reported_by)
  VALUES (_mo, _op, _kind, _description, auth.uid()) RETURNING id INTO iid;

  IF _kind = 'material_missing' THEN
    UPDATE public.manufacturing_orders SET state='waiting_material', blocked_reason=_description WHERE id=_mo;
  ELSE
    UPDATE public.manufacturing_orders SET state='paused', blocked_reason=_description WHERE id=_mo
      AND state NOT IN ('done','cancelled');
  END IF;

  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=_mo;
  PERFORM public.notify_user(ug.user_id,'manufacturing','mo_issue',
    'Problema na ordem '||mo.code, COALESCE(_description,_kind::text),
    '/manufacturing/orders/'||_mo::text)
  FROM public.user_groups ug
  JOIN public.groups g ON g.id=ug.group_id
  WHERE g.code IN ('production_manager','system_admin');

  PERFORM public.mfg_sync_sol_status(_mo);
  RETURN iid;
END $$;

CREATE OR REPLACE FUNCTION public.mfg_quality_check(_mo uuid, _result public.mo_qc_result, _defects text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE qc_op uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_orders WHERE id=_mo) THEN
    RAISE EXCEPTION 'Ordem não encontrada';
  END IF;

  SELECT id INTO qc_op FROM public.mo_operations WHERE mo_id=_mo AND is_qc=true ORDER BY sequence DESC LIMIT 1;

  INSERT INTO public.mo_quality_checks(mo_id, mo_operation_id, result, defects, notes, needs_rework, checked_by)
  VALUES (_mo, qc_op, _result, _defects, _notes, (_result IN ('fail','rework')), auth.uid());

  IF _result = 'pass' THEN
    UPDATE public.mo_operations SET state='done', finished_at=now() WHERE id=qc_op;
    UPDATE public.mo_components SET qty_consumed = qty_required, status='consumed' WHERE mo_id=_mo;

    INSERT INTO public.stock_quants(product_id, variant_id, location_id, quantity, reserved_quantity)
    SELECT mo.product_id, mo.variant_id,
           public.default_location(COALESCE(mo.warehouse_id, public.default_warehouse_id()),'Stock'),
           mo.qty, 0
    FROM public.manufacturing_orders mo
    JOIN public.products p ON p.id=mo.product_id
    WHERE mo.id=_mo AND p.type='storable';

    UPDATE public.manufacturing_orders SET state='done', actual_end=now() WHERE id=_mo;
  ELSIF _result IN ('fail','rework') THEN
    INSERT INTO public.mo_operations(mo_id, sequence, name, planned_minutes, state, is_rework)
    VALUES (_mo, COALESCE((SELECT max(sequence) FROM public.mo_operations WHERE mo_id=_mo AND is_qc=false),10)+1,
            'Retrabalho', 30, 'pending', true);
    UPDATE public.manufacturing_orders SET state='in_progress', blocked_reason='Reprovado em qualidade' WHERE id=_mo;
  END IF;

  PERFORM public.mfg_sync_sol_status(_mo);
END $$;

CREATE OR REPLACE FUNCTION public.tg_quants_refresh_mo_components()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c record; pid uuid;
BEGIN
  pid := COALESCE(NEW.product_id, OLD.product_id);
  FOR c IN SELECT mc.id FROM public.mo_components mc
           JOIN public.manufacturing_orders mo ON mo.id=mc.mo_id
           WHERE mc.product_id = pid
             AND mo.state IN ('draft','waiting_material','ready')
  LOOP
    PERFORM public.mfg_refresh_component(c.id);
  END LOOP;
  PERFORM public.mfg_refresh_mo_state(mo.id) FROM public.manufacturing_orders mo
   WHERE mo.state IN ('waiting_material','ready')
     AND EXISTS (SELECT 1 FROM public.mo_components mc WHERE mc.mo_id=mo.id AND mc.product_id = pid);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_quants_refresh_mo ON public.stock_quants;
CREATE TRIGGER trg_quants_refresh_mo AFTER INSERT OR UPDATE OF quantity, reserved_quantity ON public.stock_quants
  FOR EACH ROW EXECUTE FUNCTION public.tg_quants_refresh_mo_components();

ALTER TABLE public.manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_workorder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mo_quality_checks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mfg_can_view(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_group(_uid,'system_admin')
      OR public.has_group(_uid,'production_manager')
      OR public.has_group(_uid,'shop_floor_operator')
      OR public.has_group(_uid,'sales_manager')
      OR public.has_group(_uid,'sales_user')
      OR public.has_group(_uid,'inventory_manager')
      OR public.has_group(_uid,'inventory_user');
$$;

CREATE OR REPLACE FUNCTION public.mfg_can_manage(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_group(_uid,'system_admin') OR public.has_group(_uid,'production_manager');
$$;

CREATE OR REPLACE FUNCTION public.mfg_can_operate(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_group(_uid,'system_admin')
      OR public.has_group(_uid,'production_manager')
      OR public.has_group(_uid,'shop_floor_operator');
$$;

CREATE POLICY mo_select ON public.manufacturing_orders FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY mo_insert ON public.manufacturing_orders FOR INSERT WITH CHECK (public.mfg_can_manage(auth.uid()));
CREATE POLICY mo_update ON public.manufacturing_orders FOR UPDATE USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));
CREATE POLICY mo_delete ON public.manufacturing_orders FOR DELETE USING (public.has_group(auth.uid(),'system_admin'));

CREATE POLICY moc_select ON public.mo_components FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY moc_write ON public.mo_components FOR ALL USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE POLICY moop_select ON public.mo_operations FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY moop_write ON public.mo_operations FOR ALL USING (public.mfg_can_operate(auth.uid())) WITH CHECK (public.mfg_can_operate(auth.uid()));

CREATE POLICY mowl_select ON public.mo_workorder_logs FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY mowl_insert ON public.mo_workorder_logs FOR INSERT WITH CHECK (public.mfg_can_operate(auth.uid()) AND operator_id = auth.uid());
CREATE POLICY mowl_update ON public.mo_workorder_logs FOR UPDATE USING (operator_id = auth.uid() OR public.mfg_can_manage(auth.uid())) WITH CHECK (operator_id = auth.uid() OR public.mfg_can_manage(auth.uid()));

CREATE POLICY moiss_select ON public.mo_issues FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY moiss_insert ON public.mo_issues FOR INSERT WITH CHECK (public.mfg_can_operate(auth.uid()));
CREATE POLICY moiss_update ON public.mo_issues FOR UPDATE USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE POLICY moqc_select ON public.mo_quality_checks FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY moqc_insert ON public.mo_quality_checks FOR INSERT WITH CHECK (public.mfg_can_operate(auth.uid()));
