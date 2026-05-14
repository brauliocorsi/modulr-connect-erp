-- Priority-level SLA exceptions (override default policy)
CREATE TABLE public.service_sla_priority_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority text NOT NULL UNIQUE,
  response_minutes integer NOT NULL,
  resolution_minutes integer NOT NULL,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_sla_priority_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read" ON public.service_sla_priority_exceptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write" ON public.service_sla_priority_exceptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Per-request SLA exception log
CREATE TABLE public.service_sla_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('pause','resume','extend','adjust')),
  minutes integer,
  reason text NOT NULL,
  old_resolution_due_at timestamptz,
  new_resolution_due_at timestamptz,
  old_response_due_at timestamptz,
  new_response_due_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_sla_exceptions_request ON public.service_sla_exceptions(request_id, created_at DESC);
ALTER TABLE public.service_sla_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read" ON public.service_sla_exceptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert" ON public.service_sla_exceptions FOR INSERT TO authenticated WITH CHECK (true);

-- Per-request pause/extension fields
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS sla_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_paused_total_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_extension_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_pause_reason text;

-- Pause SLA
CREATE OR REPLACE FUNCTION public.service_sla_pause(_request_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM service_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.sla_paused_at IS NOT NULL THEN RAISE EXCEPTION 'SLA já pausado'; END IF;

  UPDATE service_requests SET sla_paused_at = now(), sla_pause_reason = _reason WHERE id = _request_id;
  INSERT INTO service_sla_exceptions(request_id, action, reason, created_by, old_resolution_due_at, new_resolution_due_at)
  VALUES (_request_id, 'pause', _reason, auth.uid(), r.resolution_due_at, r.resolution_due_at);
END $$;

-- Resume SLA (adds paused interval to deadlines)
CREATE OR REPLACE FUNCTION public.service_sla_resume(_request_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; mins integer; new_res timestamptz; new_resp timestamptz;
BEGIN
  SELECT * INTO r FROM service_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.sla_paused_at IS NULL THEN RAISE EXCEPTION 'SLA não está pausado'; END IF;

  mins := GREATEST(0, EXTRACT(EPOCH FROM (now() - r.sla_paused_at))::int / 60);
  new_res := r.resolution_due_at + make_interval(mins => mins);
  new_resp := CASE WHEN r.response_due_at IS NOT NULL THEN r.response_due_at + make_interval(mins => mins) ELSE NULL END;

  UPDATE service_requests SET
    sla_paused_at = NULL,
    sla_pause_reason = NULL,
    sla_paused_total_minutes = sla_paused_total_minutes + mins,
    resolution_due_at = new_res,
    response_due_at = new_resp
  WHERE id = _request_id;

  INSERT INTO service_sla_exceptions(request_id, action, minutes, reason, created_by,
    old_resolution_due_at, new_resolution_due_at, old_response_due_at, new_response_due_at)
  VALUES (_request_id, 'resume', mins, _reason, auth.uid(),
    r.resolution_due_at, new_res, r.response_due_at, new_resp);
END $$;

-- Extend deadline by N minutes
CREATE OR REPLACE FUNCTION public.service_sla_extend(_request_id uuid, _minutes integer, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; new_res timestamptz;
BEGIN
  IF _minutes IS NULL OR _minutes = 0 THEN RAISE EXCEPTION 'minutos inválidos'; END IF;
  SELECT * INTO r FROM service_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  new_res := COALESCE(r.resolution_due_at, now()) + make_interval(mins => _minutes);
  UPDATE service_requests SET resolution_due_at = new_res,
    sla_extension_minutes = sla_extension_minutes + _minutes WHERE id = _request_id;
  INSERT INTO service_sla_exceptions(request_id, action, minutes, reason, created_by,
    old_resolution_due_at, new_resolution_due_at)
  VALUES (_request_id, 'extend', _minutes, _reason, auth.uid(), r.resolution_due_at, new_res);
END $$;

-- Adjust deadline to specific timestamp
CREATE OR REPLACE FUNCTION public.service_sla_adjust(_request_id uuid, _new_due timestamptz, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF _new_due IS NULL THEN RAISE EXCEPTION 'data inválida'; END IF;
  SELECT * INTO r FROM service_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'request not found'; END IF;
  UPDATE service_requests SET resolution_due_at = _new_due WHERE id = _request_id;
  INSERT INTO service_sla_exceptions(request_id, action, reason, created_by,
    old_resolution_due_at, new_resolution_due_at)
  VALUES (_request_id, 'adjust', _reason, auth.uid(), r.resolution_due_at, _new_due);
END $$;
