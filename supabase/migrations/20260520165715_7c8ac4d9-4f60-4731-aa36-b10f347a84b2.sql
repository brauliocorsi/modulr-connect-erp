
-- =====================================================================
-- F24-D1 — Permissions Admin: assignments soft-delete + RPCs + health
-- =====================================================================

-- 1. Soft-delete columns on user_store_assignments
ALTER TABLE public.user_store_assignments
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid,
  ADD COLUMN IF NOT EXISTS removed_reason text;

-- (Partial unique index user_store_assignments_one_default_uq already exists.)

-- =====================================================================
-- 2. RPCs — store assignments
-- =====================================================================

CREATE OR REPLACE FUNCTION public.user_store_assignment_upsert(
  _user_id uuid,
  _store_id uuid,
  _role text DEFAULT 'staff',
  _is_default boolean DEFAULT false,
  _active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _role NOT IN ('staff','manager','cashier','logistics','service') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  INSERT INTO public.user_store_assignments (user_id, store_id, role, is_default, active, created_by)
  VALUES (_user_id, _store_id, _role, false, _active, auth.uid())
  ON CONFLICT (user_id, store_id) DO UPDATE
    SET role = EXCLUDED.role,
        active = EXCLUDED.active,
        removed_at = CASE WHEN EXCLUDED.active THEN NULL ELSE public.user_store_assignments.removed_at END,
        updated_at = now()
  RETURNING id INTO _id;

  IF _is_default AND _active THEN
    UPDATE public.user_store_assignments
      SET is_default = false, updated_at = now()
      WHERE user_id = _user_id AND id <> _id AND is_default;
    UPDATE public.user_store_assignments
      SET is_default = true, updated_at = now()
      WHERE id = _id;
  END IF;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.user_store_assignment_remove(
  _assignment_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row record;
  _open_sessions int;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_reason, '') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO _row FROM public.user_store_assignments WHERE id = _assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment_not_found'; END IF;

  SELECT count(*) INTO _open_sessions
  FROM public.cash_sessions cs
  JOIN public.cash_registers cr ON cr.id = cs.register_id
  WHERE cs.state = 'open'
    AND cs.opened_by = _row.user_id
    AND cr.store_id = _row.store_id;

  IF _open_sessions > 0 THEN
    RAISE EXCEPTION 'open_cash_session_exists';
  END IF;

  UPDATE public.user_store_assignments
    SET active = false,
        is_default = false,
        removed_at = now(),
        removed_by = auth.uid(),
        removed_reason = _reason,
        updated_at = now()
  WHERE id = _assignment_id;
END $$;

CREATE OR REPLACE FUNCTION public.user_store_assignment_set_default(
  _assignment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row record;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.user_store_assignments WHERE id = _assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment_not_found'; END IF;
  IF NOT _row.active THEN RAISE EXCEPTION 'assignment_inactive'; END IF;

  UPDATE public.user_store_assignments
    SET is_default = false, updated_at = now()
    WHERE user_id = _row.user_id AND id <> _assignment_id AND is_default;
  UPDATE public.user_store_assignments
    SET is_default = true, updated_at = now()
    WHERE id = _assignment_id;
END $$;

-- =====================================================================
-- 3. RPCs — roles/groups
-- =====================================================================

CREATE OR REPLACE FUNCTION public.user_role_assign(
  _user_id uuid,
  _group_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _gid uuid;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _gid FROM public.groups WHERE code = _group_code;
  IF _gid IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  INSERT INTO public.user_groups (user_id, group_id)
  VALUES (_user_id, _gid)
  ON CONFLICT DO NOTHING;
  RETURN _gid;
END $$;

CREATE OR REPLACE FUNCTION public.user_role_remove(
  _user_id uuid,
  _group_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _gid uuid;
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _gid FROM public.groups WHERE code = _group_code;
  IF _gid IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  DELETE FROM public.user_groups WHERE user_id = _user_id AND group_id = _gid;
END $$;

-- =====================================================================
-- 4. permissions_health_check — read-only, returns findings
-- =====================================================================
CREATE OR REPLACE FUNCTION public.permissions_health_check()
RETURNS TABLE(code text, severity text, entity_id uuid, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_group(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- user_with_cash_permission_without_store
  RETURN QUERY
  SELECT 'user_with_cash_permission_without_store'::text, 'P0'::text, p.id,
         coalesce(p.full_name, p.email)
  FROM public.profiles p
  WHERE (public.has_group(p.id,'cashbox_user') OR public.has_group(p.id,'sales_user') OR public.has_group(p.id,'finance_user'))
    AND NOT EXISTS (
      SELECT 1 FROM public.user_store_assignments u WHERE u.user_id = p.id AND u.active
    );

  -- user_with_multiple_default_stores (defensive — unique index should prevent)
  RETURN QUERY
  SELECT 'user_with_multiple_default_stores'::text, 'P0'::text, u.user_id,
         'defaults='||count(*)::text
  FROM public.user_store_assignments u
  WHERE u.is_default AND u.active
  GROUP BY u.user_id
  HAVING count(*) > 1;

  -- cash_register_without_store
  RETURN QUERY
  SELECT 'cash_register_without_store'::text, 'P1'::text, cr.id, cr.name
  FROM public.cash_registers cr
  WHERE cr.active AND cr.store_id IS NULL;

  -- open_cash_session_register_without_store
  RETURN QUERY
  SELECT 'open_cash_session_register_without_store'::text, 'P1'::text, cs.id, cs.name
  FROM public.cash_sessions cs
  JOIN public.cash_registers cr ON cr.id = cs.register_id
  WHERE cs.state = 'open' AND cr.store_id IS NULL;

  -- user_store_assignment_inactive_but_open_session
  RETURN QUERY
  SELECT 'user_store_assignment_inactive_but_open_session'::text, 'P0'::text, cs.id,
         'session '||cs.name
  FROM public.cash_sessions cs
  JOIN public.cash_registers cr ON cr.id = cs.register_id
  JOIN public.user_store_assignments u
    ON u.user_id = cs.opened_by AND u.store_id = cr.store_id
  WHERE cs.state = 'open' AND NOT u.active;

  -- cashier_without_cash_permission
  RETURN QUERY
  SELECT 'cashier_without_cash_permission'::text, 'P1'::text, u.user_id,
         'assignment '||u.id::text
  FROM public.user_store_assignments u
  WHERE u.active AND u.role = 'cashier'
    AND NOT (public.has_group(u.user_id,'cashbox_user') OR public.has_group(u.user_id,'finance_user'));
END $$;

GRANT EXECUTE ON FUNCTION public.user_store_assignment_upsert(uuid,uuid,text,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_store_assignment_remove(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_store_assignment_set_default(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_assign(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_remove(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.permissions_health_check() TO authenticated;

-- =====================================================================
-- 5. Self-test
-- =====================================================================
CREATE OR REPLACE FUNCTION public._test_phase24d1_permissions_admin()
RETURNS TABLE(test text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _has_upsert boolean;
  _has_remove boolean;
  _has_setdef boolean;
  _has_assign boolean;
  _has_role_rm boolean;
  _has_health boolean;
  _has_cols boolean;
  _has_idx boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='user_store_assignment_upsert') INTO _has_upsert;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='user_store_assignment_remove') INTO _has_remove;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='user_store_assignment_set_default') INTO _has_setdef;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='user_role_assign') INTO _has_assign;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='user_role_remove') INTO _has_role_rm;
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='permissions_health_check') INTO _has_health;
  SELECT (
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_store_assignments' AND column_name='removed_at') AND
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_store_assignments' AND column_name='removed_by') AND
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_store_assignments' AND column_name='removed_reason')
  ) INTO _has_cols;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='user_store_assignments_one_default_uq') INTO _has_idx;

  RETURN QUERY VALUES
    ('rpc_upsert_exists', _has_upsert, NULL),
    ('rpc_remove_exists', _has_remove, NULL),
    ('rpc_set_default_exists', _has_setdef, NULL),
    ('rpc_role_assign_exists', _has_assign, NULL),
    ('rpc_role_remove_exists', _has_role_rm, NULL),
    ('rpc_health_check_exists', _has_health, NULL),
    ('soft_delete_columns', _has_cols, NULL),
    ('one_default_partial_unique', _has_idx, NULL);
END $$;
