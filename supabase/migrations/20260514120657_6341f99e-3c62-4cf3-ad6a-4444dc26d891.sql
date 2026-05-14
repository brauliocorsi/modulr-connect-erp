
CREATE TABLE IF NOT EXISTS public.service_states (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  sort_order int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ss_read" ON public.service_states;
CREATE POLICY "ss_read" ON public.service_states FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ss_write" ON public.service_states;
CREATE POLICY "ss_write" ON public.service_states FOR ALL TO authenticated
USING (has_group(auth.uid(), 'system_admin') OR has_group(auth.uid(), 'inventory_manager'))
WITH CHECK (has_group(auth.uid(), 'system_admin') OR has_group(auth.uid(), 'inventory_manager'));

DROP TRIGGER IF EXISTS trg_service_states_updated ON public.service_states;
CREATE TRIGGER trg_service_states_updated BEFORE UPDATE ON public.service_states
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.service_states (key, label, color, sort_order, is_default, is_closed) VALUES
  ('new', 'Novo', 'sky', 10, true, false),
  ('triaged', 'Triado', 'violet', 20, false, false),
  ('scheduled', 'Agendado', 'amber', 30, false, false),
  ('in_progress', 'Em curso', 'blue', 40, false, false),
  ('done', 'Concluído', 'green', 50, false, true),
  ('cancelled', 'Cancelado', 'rose', 60, false, true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.service_requests DROP CONSTRAINT IF EXISTS service_requests_state_check;
