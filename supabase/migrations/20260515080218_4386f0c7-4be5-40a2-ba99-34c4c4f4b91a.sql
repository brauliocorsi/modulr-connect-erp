
DROP FUNCTION IF EXISTS public.mfg_finish_operation(uuid, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.mfg_quality_check(uuid, mo_qc_result, text, text);
DROP FUNCTION IF EXISTS public.mfg_report_issue(uuid, uuid, mo_issue_kind, text);

CREATE OR REPLACE FUNCTION public.mfg_report_issue(
  _mo uuid, _op uuid, _kind mo_issue_kind, _description text, _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _issue_id uuid; _code text; _mgr uuid;
BEGIN
  INSERT INTO public.mo_issues (mo_id, mo_operation_id, kind, description, reported_by, reported_at, attachments)
  VALUES (_mo, _op, _kind, _description, auth.uid(), now(), COALESCE(_attachments, '[]'::jsonb))
  RETURNING id INTO _issue_id;

  UPDATE public.manufacturing_orders
     SET state = 'paused', blocked_reason = COALESCE(_description, _kind::text), updated_at = now()
   WHERE id = _mo AND state NOT IN ('done','cancelled')
   RETURNING code INTO _code;

  -- Notify all production managers
  FOR _mgr IN
    SELECT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role IN ('production_manager','admin','system_admin','manager')
  LOOP
    PERFORM public.notify_user(
      _mgr, 'manufacturing'::app_module, 'mfg_issue',
      'Problema na ordem ' || COALESCE(_code,''),
      _kind::text || COALESCE(' — ' || _description, ''),
      '/manufacturing/orders/' || _mo::text
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_resolve_issue(_issue uuid, _resolution text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _mo uuid; _open int;
BEGIN
  UPDATE public.mo_issues
     SET resolved_by = auth.uid(), resolved_at = now(), resolution = _resolution
   WHERE id = _issue
   RETURNING mo_id INTO _mo;

  SELECT count(*) INTO _open FROM public.mo_issues WHERE mo_id = _mo AND resolved_at IS NULL;
  IF _open = 0 THEN
    UPDATE public.manufacturing_orders
       SET state = CASE
         WHEN EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id = _mo AND state = 'in_progress') THEN 'in_progress'
         ELSE 'ready'
       END,
       blocked_reason = NULL, updated_at = now()
     WHERE id = _mo AND state IN ('paused','waiting_material');
  END IF;
END;
$$;
