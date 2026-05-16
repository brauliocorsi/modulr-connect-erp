
CREATE TABLE IF NOT EXISTS public.allocation_hook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  source_id       uuid NOT NULL,
  source_event_id text NOT NULL,
  product_id      uuid,
  variant_id      uuid,
  location_id     uuid,
  qty             numeric,
  status          text NOT NULL DEFAULT 'ok',
  result          jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allocation_hook_events_status_check CHECK (status IN ('ok','skipped','error','duplicate'))
);

CREATE UNIQUE INDEX IF NOT EXISTS allocation_hook_events_uniq
  ON public.allocation_hook_events(event_type, source_event_id);

CREATE INDEX IF NOT EXISTS allocation_hook_events_source_idx
  ON public.allocation_hook_events(event_type, source_id, created_at DESC);

ALTER TABLE public.allocation_hook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocation_hook_events_select ON public.allocation_hook_events;
CREATE POLICY allocation_hook_events_select ON public.allocation_hook_events
  FOR SELECT TO authenticated USING (true);
