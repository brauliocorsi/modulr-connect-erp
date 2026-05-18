
-- ============================================================
-- F18-B :: SCHEMA (additive)
-- ============================================================

-- ----- ENUMs específicos de service_cases -----
DO $$ BEGIN
  CREATE TYPE public.service_case_type AS ENUM (
    'delivery_issue','customer_claim','warranty','supplier_defect',
    'internal_rework','damaged_return','missing_part','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_source AS ENUM (
    'customer','delivery_team','warehouse','manufacturing','quality','internal','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_status AS ENUM (
    'new','triage','waiting_photos','waiting_supplier','waiting_parts',
    'waiting_manufacturing','waiting_schedule','scheduled','in_route',
    'done','cancelled','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_responsibility AS ENUM (
    'supplier','internal_manufacturing','delivery_team','customer','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_warranty_status AS ENUM (
    'in_warranty','out_of_warranty','goodwill','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_item_issue_type AS ENUM (
    'damaged','missing','defective','wrong_item','wear_and_tear','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_item_action AS ENUM (
    'repair','replace','send_part','pickup_return','inspect',
    'refund','supplier_claim','manufacture_part','buy_part');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_item_status AS ENUM (
    'open','waiting_part','part_ready','scheduled','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_case_attachment_type AS ENUM (
    'customer_photo','delivery_photo','warehouse_photo',
    'before_repair','after_repair','supplier_evidence','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_task_type AS ENUM (
    'triage','request_photos','buy_part','manufacture_part','repair',
    'schedule_assistance','pickup','supplier_claim','close_case');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_task_status AS ENUM ('open','in_progress','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- service_cases -----
CREATE TABLE IF NOT EXISTS public.service_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id) ON DELETE SET NULL,
  delivery_schedule_id uuid REFERENCES public.delivery_schedules(id) ON DELETE SET NULL,
  delivery_route_order_id uuid REFERENCES public.delivery_route_orders(id) ON DELETE SET NULL,
  stock_package_id uuid REFERENCES public.stock_packages(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id uuid,
  case_type public.service_case_type NOT NULL DEFAULT 'other',
  source public.service_case_source NOT NULL DEFAULT 'internal',
  priority public.service_case_priority NOT NULL DEFAULT 'normal',
  status public.service_case_status NOT NULL DEFAULT 'new',
  responsibility public.service_case_responsibility NOT NULL DEFAULT 'unknown',
  warranty_status public.service_case_warranty_status NOT NULL DEFAULT 'unknown',
  description text,
  customer_notes text,
  internal_notes text,
  reported_by uuid,
  reported_at timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid,
  closed_at timestamptz,
  closed_resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_cases_status ON public.service_cases(status);
CREATE INDEX IF NOT EXISTS idx_service_cases_customer ON public.service_cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_cases_sale_order ON public.service_cases(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_service_cases_stock_package ON public.service_cases(stock_package_id);
CREATE INDEX IF NOT EXISTS idx_service_cases_assigned ON public.service_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_service_cases_reported_at ON public.service_cases(reported_at);

-- ----- service_case_items -----
CREATE TABLE IF NOT EXISTS public.service_case_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_case_id uuid NOT NULL REFERENCES public.service_cases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id uuid,
  stock_package_id uuid REFERENCES public.stock_packages(id) ON DELETE SET NULL,
  sale_order_line_id uuid REFERENCES public.sale_order_lines(id) ON DELETE SET NULL,
  issue_type public.service_case_item_issue_type NOT NULL DEFAULT 'other',
  required_action public.service_case_item_action,
  qty numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  qty_reserved numeric NOT NULL DEFAULT 0,
  qty_ready numeric NOT NULL DEFAULT 0,
  status public.service_case_item_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sci_case ON public.service_case_items(service_case_id);
CREATE INDEX IF NOT EXISTS idx_sci_product ON public.service_case_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sci_package ON public.service_case_items(stock_package_id);
CREATE INDEX IF NOT EXISTS idx_sci_action ON public.service_case_items(required_action);

-- ----- service_case_attachments (metadata only) -----
CREATE TABLE IF NOT EXISTS public.service_case_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_case_id uuid NOT NULL REFERENCES public.service_cases(id) ON DELETE CASCADE,
  file_url text,
  file_name text,
  file_type text,
  attachment_type public.service_case_attachment_type NOT NULL DEFAULT 'other',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sca_case ON public.service_case_attachments(service_case_id);
CREATE INDEX IF NOT EXISTS idx_sca_type ON public.service_case_attachments(attachment_type);

-- ----- service_tasks -----
CREATE TABLE IF NOT EXISTS public.service_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_case_id uuid NOT NULL REFERENCES public.service_cases(id) ON DELETE CASCADE,
  service_case_item_id uuid REFERENCES public.service_case_items(id) ON DELETE SET NULL,
  task_type public.service_task_type NOT NULL,
  assigned_to uuid,
  status public.service_task_status NOT NULL DEFAULT 'open',
  due_date date,
  linked_purchase_need_id uuid REFERENCES public.purchase_needs(id) ON DELETE SET NULL,
  linked_manufacturing_order_id uuid REFERENCES public.manufacturing_orders(id) ON DELETE SET NULL,
  linked_delivery_schedule_id uuid REFERENCES public.delivery_schedules(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stk_case ON public.service_tasks(service_case_id);
CREATE INDEX IF NOT EXISTS idx_stk_item ON public.service_tasks(service_case_item_id);
CREATE INDEX IF NOT EXISTS idx_stk_assigned ON public.service_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_stk_status ON public.service_tasks(status);

-- ----- Linking columns on existing tables -----
ALTER TABLE public.purchase_needs
  ADD COLUMN IF NOT EXISTS service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_case_item_id uuid REFERENCES public.service_case_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pn_service_case ON public.purchase_needs(service_case_id);
CREATE INDEX IF NOT EXISTS idx_pn_service_case_item ON public.purchase_needs(service_case_item_id);

ALTER TABLE public.manufacturing_orders
  ADD COLUMN IF NOT EXISTS service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_case_item_id uuid REFERENCES public.service_case_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mo_service_case ON public.manufacturing_orders(service_case_id);
CREATE INDEX IF NOT EXISTS idx_mo_service_case_item ON public.manufacturing_orders(service_case_item_id);

ALTER TABLE public.delivery_schedules
  ADD COLUMN IF NOT EXISTS service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ds_service_case ON public.delivery_schedules(service_case_id);

ALTER TABLE public.stock_reservation_log
  ADD COLUMN IF NOT EXISTS to_service_case_id uuid,
  ADD COLUMN IF NOT EXISTS to_service_case_item_id uuid;

-- ----- Sequence helper for case_number -----
CREATE SEQUENCE IF NOT EXISTS public.service_case_seq START 1;

CREATE OR REPLACE FUNCTION public.next_service_case_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n bigint; v_year text;
BEGIN
  v_year := to_char(now(),'YYYY');
  v_n := nextval('public.service_case_seq');
  RETURN format('SC/%s/%s', v_year, lpad(v_n::text, 5, '0'));
END $$;

-- ----- updated_at triggers -----
CREATE OR REPLACE FUNCTION public.tg_service_touch_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_service_cases_updated ON public.service_cases;
CREATE TRIGGER trg_service_cases_updated BEFORE UPDATE ON public.service_cases
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_touch_updated();

DROP TRIGGER IF EXISTS trg_service_case_items_updated ON public.service_case_items;
CREATE TRIGGER trg_service_case_items_updated BEFORE UPDATE ON public.service_case_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_touch_updated();

DROP TRIGGER IF EXISTS trg_service_tasks_updated ON public.service_tasks;
CREATE TRIGGER trg_service_tasks_updated BEFORE UPDATE ON public.service_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_touch_updated();

-- ----- RLS -----
ALTER TABLE public.service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_case_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_tasks ENABLE ROW LEVEL SECURITY;

-- helper: read access for service/inventory/admin groups
CREATE OR REPLACE FUNCTION public.service_can_view(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id
    WHERE ug.user_id=_uid AND g.code IN (
      'system_admin','service_manager','service_user','service_agent',
      'inventory_manager','inventory_user','delivery_manager','delivery_user'))
$$;

CREATE OR REPLACE FUNCTION public.service_can_manage(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_groups ug JOIN public.groups g ON g.id=ug.group_id
    WHERE ug.user_id=_uid AND g.code IN ('system_admin','service_manager','service_agent'))
$$;

-- service_cases policies
DROP POLICY IF EXISTS sc_select ON public.service_cases;
CREATE POLICY sc_select ON public.service_cases FOR SELECT TO authenticated
  USING (public.service_can_view(auth.uid()));
DROP POLICY IF EXISTS sc_insert ON public.service_cases;
CREATE POLICY sc_insert ON public.service_cases FOR INSERT TO authenticated
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS sc_update ON public.service_cases;
CREATE POLICY sc_update ON public.service_cases FOR UPDATE TO authenticated
  USING (public.service_can_manage(auth.uid()))
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS sc_delete ON public.service_cases;
CREATE POLICY sc_delete ON public.service_cases FOR DELETE TO authenticated
  USING (public.has_group(auth.uid(),'system_admin'));

-- service_case_items policies (same pattern)
DROP POLICY IF EXISTS sci_select ON public.service_case_items;
CREATE POLICY sci_select ON public.service_case_items FOR SELECT TO authenticated
  USING (public.service_can_view(auth.uid()));
DROP POLICY IF EXISTS sci_insert ON public.service_case_items;
CREATE POLICY sci_insert ON public.service_case_items FOR INSERT TO authenticated
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS sci_update ON public.service_case_items;
CREATE POLICY sci_update ON public.service_case_items FOR UPDATE TO authenticated
  USING (public.service_can_manage(auth.uid()))
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS sci_delete ON public.service_case_items;
CREATE POLICY sci_delete ON public.service_case_items FOR DELETE TO authenticated
  USING (public.has_group(auth.uid(),'system_admin'));

-- service_case_attachments policies
DROP POLICY IF EXISTS sca_select ON public.service_case_attachments;
CREATE POLICY sca_select ON public.service_case_attachments FOR SELECT TO authenticated
  USING (public.service_can_view(auth.uid()));
DROP POLICY IF EXISTS sca_insert ON public.service_case_attachments;
CREATE POLICY sca_insert ON public.service_case_attachments FOR INSERT TO authenticated
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS sca_delete ON public.service_case_attachments;
CREATE POLICY sca_delete ON public.service_case_attachments FOR DELETE TO authenticated
  USING (public.has_group(auth.uid(),'system_admin'));

-- service_tasks policies (assignee may update their own)
DROP POLICY IF EXISTS stk_select ON public.service_tasks;
CREATE POLICY stk_select ON public.service_tasks FOR SELECT TO authenticated
  USING (public.service_can_view(auth.uid()) OR assigned_to = auth.uid());
DROP POLICY IF EXISTS stk_insert ON public.service_tasks;
CREATE POLICY stk_insert ON public.service_tasks FOR INSERT TO authenticated
  WITH CHECK (public.service_can_manage(auth.uid()));
DROP POLICY IF EXISTS stk_update ON public.service_tasks;
CREATE POLICY stk_update ON public.service_tasks FOR UPDATE TO authenticated
  USING (public.service_can_manage(auth.uid()) OR assigned_to = auth.uid())
  WITH CHECK (public.service_can_manage(auth.uid()) OR assigned_to = auth.uid());
DROP POLICY IF EXISTS stk_delete ON public.service_tasks;
CREATE POLICY stk_delete ON public.service_tasks FOR DELETE TO authenticated
  USING (public.has_group(auth.uid(),'system_admin'));
