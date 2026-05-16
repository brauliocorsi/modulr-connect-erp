
CREATE TYPE public.product_supply_route AS ENUM ('buy','manufacture','buy_or_manufacture','manual');

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supply_route public.product_supply_route,
  ADD COLUMN IF NOT EXISTS supply_priority text;

UPDATE public.products SET supply_route = 'manufacture'
  WHERE supply_route IS NULL AND can_be_manufactured = true AND can_be_purchased = false;
UPDATE public.products SET supply_route = 'buy'
  WHERE supply_route IS NULL AND can_be_purchased = true AND can_be_manufactured = false;
UPDATE public.products SET supply_route = 'manual'
  WHERE supply_route IS NULL AND can_be_purchased = true AND can_be_manufactured = true;

CREATE TYPE public.work_center_type AS ENUM
  ('manual','machine','cutting','sewing','upholstery','assembly','quality','packing','other');

CREATE TABLE public.work_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  warehouse_id uuid,
  name text NOT NULL,
  code text NOT NULL,
  type public.work_center_type NOT NULL DEFAULT 'manual',
  capacity_per_day numeric,
  efficiency_percent numeric NOT NULL DEFAULT 100 CHECK (efficiency_percent > 0),
  cost_per_hour numeric,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_centers_code_key UNIQUE (code)
);
CREATE INDEX idx_work_centers_active ON public.work_centers(active);
CREATE INDEX idx_work_centers_type ON public.work_centers(type);
ALTER TABLE public.work_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wc_select" ON public.work_centers FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "wc_write" ON public.work_centers FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TYPE public.machine_status AS ENUM ('available','busy','maintenance','inactive');

CREATE TABLE public.manufacturing_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id uuid NOT NULL REFERENCES public.work_centers(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  machine_type text,
  status public.machine_status NOT NULL DEFAULT 'available',
  capacity_per_hour numeric,
  cost_per_hour numeric,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_machines_code_key UNIQUE (code),
  CONSTRAINT machine_active_consistent CHECK (NOT (active = true AND status = 'inactive'))
);
CREATE INDEX idx_machines_wc ON public.manufacturing_machines(work_center_id);
CREATE INDEX idx_machines_status ON public.manufacturing_machines(status);
ALTER TABLE public.manufacturing_machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mm_select" ON public.manufacturing_machines FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "mm_write" ON public.manufacturing_machines FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TYPE public.mfg_skill_level AS ENUM ('trainee','normal','skilled','specialist');

CREATE TABLE public.work_center_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id uuid NOT NULL REFERENCES public.work_centers(id) ON DELETE CASCADE,
  user_id uuid,
  employee_id uuid,
  role text,
  skill_level public.mfg_skill_level NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wce_has_principal CHECK (user_id IS NOT NULL OR employee_id IS NOT NULL)
);
CREATE UNIQUE INDEX wce_unique_user_per_wc
  ON public.work_center_employees(work_center_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_wce_wc ON public.work_center_employees(work_center_id);
ALTER TABLE public.work_center_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wce_select" ON public.work_center_employees FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "wce_write" ON public.work_center_employees FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TABLE public.manufacturing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  description text,
  default_work_center_id uuid REFERENCES public.work_centers(id) ON DELETE SET NULL,
  requires_machine boolean NOT NULL DEFAULT false,
  requires_employee boolean NOT NULL DEFAULT true,
  requires_quality_check boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manufacturing_operations_code_key UNIQUE (code)
);
CREATE INDEX idx_mfg_ops_active ON public.manufacturing_operations(active);
ALTER TABLE public.manufacturing_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mop_select" ON public.manufacturing_operations FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "mop_write" ON public.manufacturing_operations FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TABLE public.operation_employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.manufacturing_operations(id) ON DELETE CASCADE,
  user_id uuid,
  employee_id uuid,
  can_execute boolean NOT NULL DEFAULT true,
  skill_level public.mfg_skill_level NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oes_has_principal CHECK (user_id IS NOT NULL OR employee_id IS NOT NULL)
);
CREATE UNIQUE INDEX oes_unique_user_per_op
  ON public.operation_employee_skills(operation_id, user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.operation_employee_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oes_select" ON public.operation_employee_skills FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "oes_write" ON public.operation_employee_skills FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TABLE public.manufacturing_routings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid,
  name text NOT NULL,
  version text NOT NULL DEFAULT '1',
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX routings_one_default_active
  ON public.manufacturing_routings(product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default = true AND active = true;
CREATE INDEX idx_routings_product ON public.manufacturing_routings(product_id);
ALTER TABLE public.manufacturing_routings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rt_select" ON public.manufacturing_routings FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "rt_write" ON public.manufacturing_routings FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

CREATE TABLE public.manufacturing_routing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_id uuid NOT NULL REFERENCES public.manufacturing_routings(id) ON DELETE CASCADE,
  sequence int NOT NULL,
  operation_id uuid NOT NULL REFERENCES public.manufacturing_operations(id) ON DELETE RESTRICT,
  work_center_id uuid REFERENCES public.work_centers(id) ON DELETE SET NULL,
  default_duration_minutes numeric CHECK (default_duration_minutes IS NULL OR default_duration_minutes >= 0),
  setup_time_minutes numeric NOT NULL DEFAULT 0 CHECK (setup_time_minutes >= 0),
  cleanup_time_minutes numeric NOT NULL DEFAULT 0 CHECK (cleanup_time_minutes >= 0),
  requires_quality_check boolean NOT NULL DEFAULT false,
  instructions text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_ops_seq_unique UNIQUE (routing_id, sequence)
);
CREATE INDEX idx_routing_ops_routing ON public.manufacturing_routing_operations(routing_id);
ALTER TABLE public.manufacturing_routing_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rto_select" ON public.manufacturing_routing_operations FOR SELECT USING (public.mfg_can_view(auth.uid()));
CREATE POLICY "rto_write" ON public.manufacturing_routing_operations FOR ALL
  USING (public.mfg_can_manage(auth.uid())) WITH CHECK (public.mfg_can_manage(auth.uid()));

ALTER TABLE public.mo_operations
  ADD COLUMN IF NOT EXISTS work_center_id uuid REFERENCES public.work_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.manufacturing_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.manufacturing_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid;

CREATE OR REPLACE FUNCTION public.product_manufacturing_configuration_check(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prod record;
  v_has_bom boolean := false;
  v_has_routing boolean := false;
  v_has_default boolean := false;
  v_has_wc boolean := false;
  v_has_ops boolean := false;
  v_blockers text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_ready boolean := false;
BEGIN
  SELECT id, can_be_manufactured, supply_route INTO v_prod
    FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','product_not_found');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.bom_operations WHERE product_id = _product_id) INTO v_has_bom;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_routings WHERE product_id = _product_id AND active = true) INTO v_has_routing;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_routings WHERE product_id = _product_id AND active = true AND is_default = true) INTO v_has_default;
  SELECT EXISTS(SELECT 1 FROM public.work_centers WHERE active = true) INTO v_has_wc;
  SELECT EXISTS(SELECT 1 FROM public.manufacturing_operations WHERE active = true) INTO v_has_ops;

  IF v_prod.can_be_manufactured = false THEN
    v_blockers := v_blockers || 'product_not_manufacturable';
  END IF;
  IF NOT v_has_routing THEN v_warnings := v_warnings || 'no_active_routing'; END IF;
  IF v_has_routing AND NOT v_has_default THEN v_warnings := v_warnings || 'no_default_routing'; END IF;
  IF NOT v_has_wc THEN v_warnings := v_warnings || 'no_active_work_centers'; END IF;
  IF NOT v_has_ops THEN v_warnings := v_warnings || 'no_active_operations'; END IF;
  IF v_prod.supply_route = 'manual' THEN v_warnings := v_warnings || 'supply_route_manual_undecided'; END IF;

  v_ready := array_length(v_blockers,1) IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', _product_id,
    'has_bom', v_has_bom,
    'has_routing', v_has_routing,
    'has_default_routing', v_has_default,
    'has_work_centers', v_has_wc,
    'has_operations', v_has_ops,
    'supply_route', v_prod.supply_route,
    'can_be_manufactured', v_prod.can_be_manufactured,
    'manufacturing_ready', v_ready,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings)
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public._test_phase16_b_schema()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tst$
DECLARE
  res jsonb := '[]'::jsonb; pass int := 0; fail int := 0;
  tag text := 'F16B_' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_p_mfg uuid; v_p_buy uuid; v_p_both uuid;
  v_wc uuid; v_mc uuid; v_op uuid; v_emp uuid; v_skill uuid;
  v_rt uuid; v_rt2 uuid; v_rto uuid;
  v_chk jsonb;
  v_user uuid;
BEGIN
  v_user := COALESCE(auth.uid(), gen_random_uuid());

  IF to_regclass('public.work_centers') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','01_work_centers','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','01','ok',false); END IF;

  IF to_regclass('public.manufacturing_machines') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','02_machines','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','02','ok',false); END IF;

  IF to_regclass('public.work_center_employees') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','03_wce','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','03','ok',false); END IF;

  IF to_regclass('public.manufacturing_operations') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','04_mfg_ops','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','04','ok',false); END IF;

  IF to_regclass('public.operation_employee_skills') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','05_oes','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','05','ok',false); END IF;

  IF to_regclass('public.manufacturing_routings') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','06_routings','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','06','ok',false); END IF;

  IF to_regclass('public.manufacturing_routing_operations') IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','07_rto','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','07','ok',false); END IF;

  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='supply_route') THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','08_supply_route','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','08','ok',false); END IF;

  INSERT INTO public.products(name, sku, can_be_manufactured, can_be_purchased, type)
    VALUES (tag||'_mfg', tag||'_mfg', true, false, 'product') RETURNING id INTO v_p_mfg;
  UPDATE public.products SET supply_route = 'manufacture' WHERE id=v_p_mfg AND supply_route IS NULL;
  IF (SELECT supply_route FROM public.products WHERE id=v_p_mfg) = 'manufacture' THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','09_backfill_mfg','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','09','ok',false); END IF;

  INSERT INTO public.products(name, sku, can_be_manufactured, can_be_purchased, type)
    VALUES (tag||'_buy', tag||'_buy', false, true, 'product') RETURNING id INTO v_p_buy;
  UPDATE public.products SET supply_route = 'buy' WHERE id=v_p_buy AND supply_route IS NULL;
  IF (SELECT supply_route FROM public.products WHERE id=v_p_buy) = 'buy' THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','10_backfill_buy','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','10','ok',false); END IF;

  INSERT INTO public.products(name, sku, can_be_manufactured, can_be_purchased, type)
    VALUES (tag||'_both', tag||'_both', true, true, 'product') RETURNING id INTO v_p_both;
  UPDATE public.products SET supply_route = 'manual' WHERE id=v_p_both AND supply_route IS NULL;
  IF (SELECT supply_route FROM public.products WHERE id=v_p_both) = 'manual' THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','11_backfill_manual','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','11','ok',false); END IF;

  INSERT INTO public.work_centers(name, code, type) VALUES (tag||'_WC', tag||'_WC', 'assembly') RETURNING id INTO v_wc;
  IF v_wc IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','12_wc','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','12','ok',false); END IF;

  INSERT INTO public.manufacturing_machines(work_center_id, name, code, status)
    VALUES (v_wc, tag||'_MC', tag||'_MC', 'available') RETURNING id INTO v_mc;
  IF v_mc IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','13_machine','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','13','ok',false); END IF;

  INSERT INTO public.manufacturing_operations(name, code, default_work_center_id)
    VALUES (tag||'_OP', tag||'_OP', v_wc) RETURNING id INTO v_op;
  IF v_op IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','14_op','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','14','ok',false); END IF;

  INSERT INTO public.work_center_employees(work_center_id, user_id, skill_level)
    VALUES (v_wc, v_user, 'skilled') RETURNING id INTO v_emp;
  INSERT INTO public.operation_employee_skills(operation_id, user_id, skill_level)
    VALUES (v_op, v_user, 'specialist') RETURNING id INTO v_skill;
  IF v_emp IS NOT NULL AND v_skill IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','15_emp_skill','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','15','ok',false); END IF;

  INSERT INTO public.manufacturing_routings(product_id, name, is_default, active)
    VALUES (v_p_mfg, tag||'_RT', true, true) RETURNING id INTO v_rt;
  IF v_rt IS NOT NULL THEN pass:=pass+1; res:=res||jsonb_build_object('t','16_routing','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','16','ok',false); END IF;

  INSERT INTO public.manufacturing_routing_operations(routing_id, sequence, operation_id, work_center_id, default_duration_minutes)
    VALUES (v_rt, 10, v_op, v_wc, 30) RETURNING id INTO v_rto;
  INSERT INTO public.manufacturing_routing_operations(routing_id, sequence, operation_id, work_center_id, default_duration_minutes)
    VALUES (v_rt, 20, v_op, v_wc, 15);
  IF (SELECT COUNT(*) FROM public.manufacturing_routing_operations WHERE routing_id=v_rt) = 2 THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','17_rto_seq','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','17','ok',false); END IF;

  BEGIN
    INSERT INTO public.manufacturing_routings(product_id, name, is_default, active)
      VALUES (v_p_mfg, tag||'_RT2', true, true) RETURNING id INTO v_rt2;
    fail:=fail+1; res:=res||jsonb_build_object('t','18_unique_default','ok',false,'why','no_error_raised');
  EXCEPTION WHEN unique_violation THEN
    pass:=pass+1; res:=res||jsonb_build_object('t','18_unique_default','ok',true);
  END;

  v_chk := public.product_manufacturing_configuration_check(v_p_mfg);
  IF (v_chk->>'ok')='true'
     AND (v_chk->>'has_routing')='true'
     AND (v_chk->>'has_default_routing')='true'
     AND (v_chk->>'has_work_centers')='true'
     AND (v_chk->>'has_operations')='true'
     AND (v_chk->>'manufacturing_ready')='true'
  THEN pass:=pass+1; res:=res||jsonb_build_object('t','19_diagnostic','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','19','ok',false,'chk',v_chk); END IF;

  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='close_mo')
     AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='cancel_sale_order')
     AND EXISTS(SELECT 1 FROM pg_proc WHERE proname='run_inventory_allocation')
  THEN pass:=pass+1; res:=res||jsonb_build_object('t','20_ops_intact','ok',true);
  ELSE fail:=fail+1; res:=res||jsonb_build_object('t','20','ok',false); END IF;

  BEGIN DELETE FROM public.manufacturing_routing_operations WHERE routing_id=v_rt; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.manufacturing_routings WHERE id=v_rt; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.operation_employee_skills WHERE id=v_skill; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.work_center_employees WHERE id=v_emp; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.manufacturing_operations WHERE id=v_op; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.manufacturing_machines WHERE id=v_mc; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.work_centers WHERE id=v_wc; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.products WHERE id IN (v_p_mfg, v_p_buy, v_p_both); EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('phase','F16-B','passed',pass,'failed',fail,'total',pass+fail,'tests',res,'tag',tag);
END
$tst$;
