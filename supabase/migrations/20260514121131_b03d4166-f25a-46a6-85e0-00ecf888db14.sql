
CREATE TABLE IF NOT EXISTS public.service_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  priority text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  response_minutes int NOT NULL DEFAULT 240,
  resolution_minutes int NOT NULL DEFAULT 1440,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_sla_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sla_read" ON public.service_sla_policies;
CREATE POLICY "sla_read" ON public.service_sla_policies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sla_write" ON public.service_sla_policies;
CREATE POLICY "sla_write" ON public.service_sla_policies FOR ALL TO authenticated
USING (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'))
WITH CHECK (has_group(auth.uid(),'system_admin') OR has_group(auth.uid(),'inventory_manager'));

DROP TRIGGER IF EXISTS trg_sla_updated ON public.service_sla_policies;
CREATE TRIGGER trg_sla_updated BEFORE UPDATE ON public.service_sla_policies
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Tracking columns on service_requests
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS sla_policy_id uuid REFERENCES public.service_sla_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sr_resolution_due ON public.service_requests(resolution_due_at);

-- Apply SLA on insert / when priority changes
CREATE OR REPLACE FUNCTION public.apply_service_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pol public.service_sla_policies;
BEGIN
  SELECT * INTO pol FROM public.service_sla_policies
   WHERE active AND priority = NEW.priority
   ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    NEW.sla_policy_id := pol.id;
    NEW.response_due_at := NEW.created_at + (pol.response_minutes || ' minutes')::interval;
    NEW.resolution_due_at := NEW.created_at + (pol.resolution_minutes || ' minutes')::interval;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sr_apply_sla_ins ON public.service_requests;
CREATE TRIGGER trg_sr_apply_sla_ins
BEFORE INSERT ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_service_sla();

DROP TRIGGER IF EXISTS trg_sr_apply_sla_upd ON public.service_requests;
CREATE TRIGGER trg_sr_apply_sla_upd
BEFORE UPDATE OF priority ON public.service_requests
FOR EACH ROW WHEN (OLD.priority IS DISTINCT FROM NEW.priority)
EXECUTE FUNCTION public.apply_service_sla();

-- Stamp first_response_at and resolved_at
CREATE OR REPLACE FUNCTION public.touch_service_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed boolean;
BEGIN
  IF NEW.first_response_at IS NULL AND NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    NEW.first_response_at := now();
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.state IS DISTINCT FROM NEW.state THEN
    SELECT is_closed INTO closed FROM public.service_states WHERE key = NEW.state;
    IF closed AND NEW.resolved_at IS NULL THEN
      NEW.resolved_at := now();
    ELSIF NOT COALESCE(closed, false) THEN
      NEW.resolved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sr_milestones ON public.service_requests;
CREATE TRIGGER trg_sr_milestones
BEFORE INSERT OR UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_service_milestones();

-- Seed default policies
INSERT INTO public.service_sla_policies (name, priority, response_minutes, resolution_minutes) VALUES
  ('Padrão - Baixa',   'low',     1440, 7200),
  ('Padrão - Normal',  'normal',  480,  2880),
  ('Padrão - Alta',    'high',    120,  1440),
  ('Padrão - Urgente', 'urgent',  30,   480)
ON CONFLICT DO NOTHING;
