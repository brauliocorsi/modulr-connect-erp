
CREATE OR REPLACE FUNCTION public.mfg_finish_operation(
  _op uuid, _qty_done numeric, _qty_scrap numeric, _notes text, _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _mo uuid; _seq int; _is_qc boolean; _has_more boolean;
BEGIN
  UPDATE public.mo_operations
     SET state = 'done', finished_at = now(),
         qty_done = COALESCE(_qty_done, qty_done),
         qty_scrap = COALESCE(_qty_scrap, qty_scrap)
   WHERE id = _op
   RETURNING mo_id, sequence, is_qc INTO _mo, _seq, _is_qc;

  INSERT INTO public.mo_workorder_logs (mo_operation_id, mo_id, operator_id, started_at, finished_at, qty_done, qty_scrap, notes, attachments)
  VALUES (_op, _mo, auth.uid(), now(), now(), _qty_done, _qty_scrap, _notes, COALESCE(_attachments, '[]'::jsonb));

  SELECT EXISTS (SELECT 1 FROM public.mo_operations WHERE mo_id = _mo AND state <> 'done') INTO _has_more;
  IF NOT _has_more THEN
    UPDATE public.manufacturing_orders SET state = 'qc', updated_at = now() WHERE id = _mo AND state <> 'qc';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_quality_check(
  _mo uuid, _result mo_qc_result, _defects text, _notes text, _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _needs_rework boolean := (_result IN ('fail','rework'));
BEGIN
  INSERT INTO public.mo_quality_checks (mo_id, result, needs_rework, defects, notes, checked_by, checked_at, attachments)
  VALUES (_mo, _result, _needs_rework, _defects, _notes, auth.uid(), now(), COALESCE(_attachments, '[]'::jsonb));

  IF _result = 'pass' THEN
    PERFORM public.mfg_complete_mo(_mo);
  ELSE
    INSERT INTO public.mo_operations (mo_id, sequence, name, planned_minutes, state, is_rework)
    SELECT _mo, COALESCE(MAX(sequence),0)+10, 'Retrabalho', 30, 'ready', true FROM public.mo_operations WHERE mo_id = _mo;
    UPDATE public.manufacturing_orders SET state = 'in_progress', updated_at = now() WHERE id = _mo;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mfg_report_issue(
  _mo uuid, _op uuid, _kind mo_issue_kind, _description text, _attachments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mo_issues (mo_id, mo_operation_id, kind, description, reported_by, reported_at, attachments)
  VALUES (_mo, _op, _kind, _description, auth.uid(), now(), COALESCE(_attachments, '[]'::jsonb));

  UPDATE public.manufacturing_orders SET state = 'paused', blocked_reason = COALESCE(_description, _kind::text), updated_at = now()
  WHERE id = _mo AND state NOT IN ('done','cancelled');
END;
$$;
