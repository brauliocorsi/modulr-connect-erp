-- Dedup tracking columns
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS notified_at_risk_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_breached_at timestamptz;

-- Function: scan and notify
CREATE OR REPLACE FUNCTION public.service_sla_notify_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  uid uuid;
  total_seconds bigint;
  remaining_seconds bigint;
  ratio numeric;
  is_at_risk boolean;
  is_breached boolean;
  notified_count int := 0;
  affected_count int := 0;
  link_url text;
BEGIN
  FOR r IN
    SELECT sr.* FROM public.service_requests sr
    WHERE sr.resolution_due_at IS NOT NULL
      AND sr.resolved_at IS NULL
      AND sr.sla_paused_at IS NULL
      AND (sr.notified_breached_at IS NULL OR sr.notified_at_risk_at IS NULL)
  LOOP
    is_breached := now() > r.resolution_due_at;
    total_seconds := EXTRACT(EPOCH FROM (r.resolution_due_at - r.created_at))::bigint;
    remaining_seconds := EXTRACT(EPOCH FROM (r.resolution_due_at - now()))::bigint;
    ratio := CASE WHEN total_seconds > 0 THEN remaining_seconds::numeric / total_seconds ELSE 0 END;
    is_at_risk := (NOT is_breached) AND ratio < 0.2;

    IF is_breached AND r.notified_breached_at IS NOT NULL THEN
      CONTINUE;
    END IF;
    IF is_at_risk AND r.notified_at_risk_at IS NOT NULL THEN
      CONTINUE;
    END IF;
    IF NOT is_breached AND NOT is_at_risk THEN
      CONTINUE;
    END IF;

    affected_count := affected_count + 1;
    link_url := '/service/requests/' || r.id::text;

    -- Insert notifications for all users in support group
    FOR uid IN
      SELECT DISTINCT ug.user_id
      FROM public.user_groups ug
      JOIN public.groups g ON g.id = ug.group_id
      WHERE g.code = 'service_support'
    LOOP
      INSERT INTO public.notifications(user_id, module, type, title, body, link, payload)
      VALUES (
        uid,
        'service',
        CASE WHEN is_breached THEN 'sla_breached' ELSE 'sla_at_risk' END,
        CASE WHEN is_breached
          THEN 'SLA em atraso · ' || r.name
          ELSE 'SLA em risco · ' || r.name END,
        CASE WHEN is_breached
          THEN 'Prazo de resolução excedido em ' || GREATEST(1, ABS(remaining_seconds) / 60)::text || ' min'
          ELSE 'Restam ' || GREATEST(0, remaining_seconds / 60)::text || ' min para o prazo' END,
        link_url,
        jsonb_build_object(
          'request_id', r.id,
          'priority', r.priority,
          'state', r.state,
          'resolution_due_at', r.resolution_due_at
        )
      );
      notified_count := notified_count + 1;
    END LOOP;

    -- Mark request as notified
    IF is_breached THEN
      UPDATE public.service_requests SET notified_breached_at = now() WHERE id = r.id;
    ELSE
      UPDATE public.service_requests SET notified_at_risk_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('requests', affected_count, 'notifications', notified_count);
END $$;

-- Reset notification flags when SLA changes (resume, extend, adjust)
CREATE OR REPLACE FUNCTION public.service_sla_reset_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.resolution_due_at IS DISTINCT FROM OLD.resolution_due_at THEN
    NEW.notified_at_risk_at := NULL;
    NEW.notified_breached_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_service_sla_reset_notifications ON public.service_requests;
CREATE TRIGGER trg_service_sla_reset_notifications
BEFORE UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.service_sla_reset_notifications();
