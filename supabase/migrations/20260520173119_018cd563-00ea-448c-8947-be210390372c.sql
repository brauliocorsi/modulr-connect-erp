
-- ============================================================
-- F25-B: Machines + Work Centers + Operations CRUD
-- ============================================================

-- 1) Schema additions: maintenance + archive fields ----------
ALTER TABLE public.manufacturing_machines
  ADD COLUMN IF NOT EXISTS maintenance_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS last_maintenance_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_maintenance_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_machines_maintenance_status_chk') THEN
    ALTER TABLE public.manufacturing_machines
      ADD CONSTRAINT manufacturing_machines_maintenance_status_chk
      CHECK (maintenance_status IN ('ok','due','overdue','blocked'));
  END IF;
END $$;

ALTER TABLE public.work_centers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.manufacturing_operations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- 2) RPC: machine_upsert -------------------------------------
CREATE OR REPLACE FUNCTION public.machine_upsert(_machine_id uuid, _payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_name text;
  v_wc uuid;
  v_status machine_status;
  v_maint text;
  v_cap numeric;
  v_cost numeric;
  v_active boolean;
  v_notes text;
  v_machine_type text;
  v_last_m timestamptz;
  v_next_m timestamptz;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_code := NULLIF(trim(_payload->>'code'), '');
  v_name := NULLIF(trim(_payload->>'name'), '');
  IF v_code IS NULL THEN RAISE EXCEPTION 'code_required'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;

  v_wc := NULLIF(_payload->>'work_center_id','')::uuid;
  IF v_wc IS NULL THEN RAISE EXCEPTION 'work_center_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM work_centers WHERE id = v_wc AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'work_center_not_found_or_archived';
  END IF;

  v_status := COALESCE(NULLIF(_payload->>'status','')::machine_status, 'available');
  v_maint  := COALESCE(NULLIF(_payload->>'maintenance_status',''), 'ok');
  IF v_maint NOT IN ('ok','due','overdue','blocked') THEN RAISE EXCEPTION 'maintenance_status_invalid'; END IF;

  v_cap  := NULLIF(_payload->>'capacity_per_hour','')::numeric;
  v_cost := NULLIF(_payload->>'cost_per_hour','')::numeric;
  IF v_cap IS NOT NULL AND v_cap < 0 THEN RAISE EXCEPTION 'capacity_negative'; END IF;
  IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'cost_negative'; END IF;

  v_active := COALESCE((_payload->>'active')::boolean, true);
  v_notes  := NULLIF(_payload->>'notes','');
  v_machine_type := NULLIF(_payload->>'machine_type','');
  v_last_m := NULLIF(_payload->>'last_maintenance_at','')::timestamptz;
  v_next_m := NULLIF(_payload->>'next_maintenance_at','')::timestamptz;

  IF _machine_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM manufacturing_machines WHERE code = v_code) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    INSERT INTO manufacturing_machines (
      code, name, work_center_id, status, maintenance_status,
      capacity_per_hour, cost_per_hour, active, notes, machine_type,
      last_maintenance_at, next_maintenance_at
    ) VALUES (
      v_code, v_name, v_wc, v_status, v_maint,
      v_cap, v_cost, v_active, v_notes, v_machine_type,
      v_last_m, v_next_m
    ) RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM manufacturing_machines WHERE id = _machine_id) THEN
      RAISE EXCEPTION 'machine_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM manufacturing_machines WHERE code = v_code AND id <> _machine_id) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    UPDATE manufacturing_machines SET
      code = v_code, name = v_name, work_center_id = v_wc,
      status = v_status, maintenance_status = v_maint,
      capacity_per_hour = v_cap, cost_per_hour = v_cost,
      active = v_active, notes = v_notes, machine_type = v_machine_type,
      last_maintenance_at = v_last_m, next_maintenance_at = v_next_m,
      updated_at = now()
    WHERE id = _machine_id;
    v_id := _machine_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.machine_upsert(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.machine_upsert(uuid, jsonb) TO authenticated;

-- 3) RPC: machine_archive ------------------------------------
CREATE OR REPLACE FUNCTION public.machine_archive(_machine_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_use int;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _machine_id IS NULL THEN RAISE EXCEPTION 'machine_id_required'; END IF;
  IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM manufacturing_machines WHERE id = _machine_id) THEN
    RAISE EXCEPTION 'machine_not_found';
  END IF;

  SELECT count(*) INTO v_in_use FROM mo_operations
   WHERE machine_id = _machine_id
     AND state IN ('pending','ready','in_progress','paused','blocked');
  IF v_in_use > 0 THEN
    RAISE EXCEPTION 'machine_in_use' USING DETAIL = format('%s operações ativas', v_in_use);
  END IF;

  UPDATE manufacturing_machines SET
    active = false,
    status = 'inactive',
    archived_at = now(),
    archived_by = auth.uid(),
    archive_reason = _reason,
    updated_at = now()
  WHERE id = _machine_id;

  RETURN jsonb_build_object('ok', true, 'id', _machine_id);
END $$;

REVOKE ALL ON FUNCTION public.machine_archive(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.machine_archive(uuid, text) TO authenticated;

-- 4) RPC: work_center_upsert ---------------------------------
CREATE OR REPLACE FUNCTION public.work_center_upsert(_work_center_id uuid, _payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_name text;
  v_type work_center_type;
  v_warehouse uuid;
  v_cap numeric;
  v_eff numeric;
  v_cost numeric;
  v_active boolean;
  v_notes text;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_code := NULLIF(trim(_payload->>'code'),'');
  v_name := NULLIF(trim(_payload->>'name'),'');
  IF v_code IS NULL THEN RAISE EXCEPTION 'code_required'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;

  v_type := COALESCE(NULLIF(_payload->>'type','')::work_center_type, 'manual');
  v_warehouse := NULLIF(_payload->>'warehouse_id','')::uuid;
  v_cap := NULLIF(_payload->>'capacity_per_day','')::numeric;
  v_eff := COALESCE(NULLIF(_payload->>'efficiency_percent','')::numeric, 100);
  v_cost := NULLIF(_payload->>'cost_per_hour','')::numeric;
  v_active := COALESCE((_payload->>'active')::boolean, true);
  v_notes := NULLIF(_payload->>'notes','');

  IF v_eff <= 0 THEN RAISE EXCEPTION 'efficiency_invalid'; END IF;
  IF v_cap IS NOT NULL AND v_cap < 0 THEN RAISE EXCEPTION 'capacity_negative'; END IF;
  IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'cost_negative'; END IF;

  IF _work_center_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM work_centers WHERE code = v_code) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    INSERT INTO work_centers (code, name, type, warehouse_id, capacity_per_day, efficiency_percent, cost_per_hour, active, notes)
    VALUES (v_code, v_name, v_type, v_warehouse, v_cap, v_eff, v_cost, v_active, v_notes)
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM work_centers WHERE id = _work_center_id) THEN
      RAISE EXCEPTION 'work_center_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM work_centers WHERE code = v_code AND id <> _work_center_id) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    UPDATE work_centers SET
      code = v_code, name = v_name, type = v_type, warehouse_id = v_warehouse,
      capacity_per_day = v_cap, efficiency_percent = v_eff, cost_per_hour = v_cost,
      active = v_active, notes = v_notes, updated_at = now()
    WHERE id = _work_center_id;
    v_id := _work_center_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.work_center_upsert(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_center_upsert(uuid, jsonb) TO authenticated;

-- 5) RPC: work_center_archive --------------------------------
CREATE OR REPLACE FUNCTION public.work_center_archive(_work_center_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_use int;
  v_machines int;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _work_center_id IS NULL THEN RAISE EXCEPTION 'work_center_id_required'; END IF;
  IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM work_centers WHERE id = _work_center_id) THEN
    RAISE EXCEPTION 'work_center_not_found';
  END IF;

  SELECT count(*) INTO v_in_use FROM mo_operations
   WHERE work_center_id = _work_center_id
     AND state IN ('pending','ready','in_progress','paused','blocked');
  IF v_in_use > 0 THEN
    RAISE EXCEPTION 'work_center_in_use' USING DETAIL = format('%s operações de MO ativas', v_in_use);
  END IF;

  SELECT count(*) INTO v_machines FROM manufacturing_machines
   WHERE work_center_id = _work_center_id AND active = true;
  IF v_machines > 0 THEN
    RAISE EXCEPTION 'work_center_has_active_machines' USING DETAIL = format('%s máquinas ativas', v_machines);
  END IF;

  UPDATE work_centers SET
    active = false,
    archived_at = now(),
    archived_by = auth.uid(),
    archive_reason = _reason,
    updated_at = now()
  WHERE id = _work_center_id;
  RETURN jsonb_build_object('ok', true, 'id', _work_center_id);
END $$;

REVOKE ALL ON FUNCTION public.work_center_archive(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_center_archive(uuid, text) TO authenticated;

-- 6) RPC: manufacturing_operation_upsert ---------------------
CREATE OR REPLACE FUNCTION public.manufacturing_operation_upsert(_operation_id uuid, _payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_name text;
  v_desc text;
  v_wc uuid;
  v_rm boolean;
  v_re boolean;
  v_rq boolean;
  v_active boolean;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_code := NULLIF(trim(_payload->>'code'),'');
  v_name := NULLIF(trim(_payload->>'name'),'');
  IF v_code IS NULL THEN RAISE EXCEPTION 'code_required'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;

  v_desc := NULLIF(_payload->>'description','');
  v_wc := NULLIF(_payload->>'default_work_center_id','')::uuid;
  IF v_wc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_centers WHERE id = v_wc AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'work_center_not_found_or_archived';
  END IF;
  v_rm := COALESCE((_payload->>'requires_machine')::boolean, false);
  v_re := COALESCE((_payload->>'requires_employee')::boolean, true);
  v_rq := COALESCE((_payload->>'requires_quality_check')::boolean, false);
  v_active := COALESCE((_payload->>'active')::boolean, true);

  IF _operation_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM manufacturing_operations WHERE code = v_code) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    INSERT INTO manufacturing_operations (code, name, description, default_work_center_id, requires_machine, requires_employee, requires_quality_check, active)
    VALUES (v_code, v_name, v_desc, v_wc, v_rm, v_re, v_rq, v_active)
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM manufacturing_operations WHERE id = _operation_id) THEN
      RAISE EXCEPTION 'operation_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM manufacturing_operations WHERE code = v_code AND id <> _operation_id) THEN
      RAISE EXCEPTION 'code_duplicated';
    END IF;
    UPDATE manufacturing_operations SET
      code = v_code, name = v_name, description = v_desc,
      default_work_center_id = v_wc, requires_machine = v_rm,
      requires_employee = v_re, requires_quality_check = v_rq,
      active = v_active, updated_at = now()
    WHERE id = _operation_id;
    v_id := _operation_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.manufacturing_operation_upsert(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manufacturing_operation_upsert(uuid, jsonb) TO authenticated;

-- 7) RPC: manufacturing_operation_archive --------------------
CREATE OR REPLACE FUNCTION public.manufacturing_operation_archive(_operation_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_use int;
BEGIN
  IF NOT public.mfg_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _operation_id IS NULL THEN RAISE EXCEPTION 'operation_id_required'; END IF;
  IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM manufacturing_operations WHERE id = _operation_id) THEN
    RAISE EXCEPTION 'operation_not_found';
  END IF;

  SELECT count(*) INTO v_in_use FROM mo_operations
   WHERE operation_id = _operation_id
     AND state IN ('pending','ready','in_progress','paused','blocked');
  IF v_in_use > 0 THEN
    RAISE EXCEPTION 'operation_in_use' USING DETAIL = format('%s operações ativas', v_in_use);
  END IF;

  UPDATE manufacturing_operations SET
    active = false,
    archived_at = now(),
    archived_by = auth.uid(),
    archive_reason = _reason,
    updated_at = now()
  WHERE id = _operation_id;
  RETURN jsonb_build_object('ok', true, 'id', _operation_id);
END $$;

REVOKE ALL ON FUNCTION public.manufacturing_operation_archive(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manufacturing_operation_archive(uuid, text) TO authenticated;

-- 8) Self-test -----------------------------------------------
CREATE OR REPLACE FUNCTION public._test_phase25_machines_workcenters_operations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wc uuid;
  v_op uuid;
  v_m uuid;
  v_results jsonb := '[]'::jsonb;
  v_err text;
BEGIN
  -- WC create
  v_wc := public.work_center_upsert(NULL, jsonb_build_object(
    'code', 'WC-TEST-'||substr(gen_random_uuid()::text,1,6),
    'name', 'WC Test', 'type','manual'));
  v_results := v_results || jsonb_build_object('test','wc_upsert_create','ok',v_wc IS NOT NULL);

  -- WC edit
  PERFORM public.work_center_upsert(v_wc, jsonb_build_object(
    'code', (SELECT code FROM work_centers WHERE id = v_wc),
    'name','WC Test v2','type','manual'));
  v_results := v_results || jsonb_build_object('test','wc_upsert_edit','ok',
    (SELECT name FROM work_centers WHERE id = v_wc) = 'WC Test v2');

  -- Operation create
  v_op := public.manufacturing_operation_upsert(NULL, jsonb_build_object(
    'code','OP-TEST-'||substr(gen_random_uuid()::text,1,6),
    'name','Op Test','default_work_center_id', v_wc));
  v_results := v_results || jsonb_build_object('test','op_upsert_create','ok',v_op IS NOT NULL);

  -- Op edit
  PERFORM public.manufacturing_operation_upsert(v_op, jsonb_build_object(
    'code', (SELECT code FROM manufacturing_operations WHERE id = v_op),
    'name','Op Test v2'));
  v_results := v_results || jsonb_build_object('test','op_upsert_edit','ok',
    (SELECT name FROM manufacturing_operations WHERE id = v_op) = 'Op Test v2');

  -- Machine create
  v_m := public.machine_upsert(NULL, jsonb_build_object(
    'code','MCH-TEST-'||substr(gen_random_uuid()::text,1,6),
    'name','Machine Test','work_center_id',v_wc));
  v_results := v_results || jsonb_build_object('test','machine_upsert_create','ok',v_m IS NOT NULL);

  -- Machine duplicate code
  BEGIN
    PERFORM public.machine_upsert(NULL, jsonb_build_object(
      'code',(SELECT code FROM manufacturing_machines WHERE id = v_m),
      'name','dup','work_center_id',v_wc));
    v_results := v_results || jsonb_build_object('test','machine_dup_blocked','ok',false);
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test','machine_dup_blocked','ok',true);
  END;

  -- Machine archive requires reason
  BEGIN
    PERFORM public.machine_archive(v_m, NULL);
    v_results := v_results || jsonb_build_object('test','machine_archive_reason_required','ok',false);
  EXCEPTION WHEN OTHERS THEN
    v_results := v_results || jsonb_build_object('test','machine_archive_reason_required','ok',true);
  END;

  -- Machine archive
  PERFORM public.machine_archive(v_m, 'end of life test');
  v_results := v_results || jsonb_build_object('test','machine_archive','ok',
    (SELECT archived_at IS NOT NULL AND active = false FROM manufacturing_machines WHERE id = v_m));

  -- WC archive (should succeed since no active MO ops and no active machines)
  PERFORM public.work_center_archive(v_wc, 'test cleanup');
  v_results := v_results || jsonb_build_object('test','wc_archive','ok',
    (SELECT archived_at IS NOT NULL FROM work_centers WHERE id = v_wc));

  -- Op archive
  PERFORM public.manufacturing_operation_archive(v_op, 'test cleanup');
  v_results := v_results || jsonb_build_object('test','op_archive','ok',
    (SELECT archived_at IS NOT NULL FROM manufacturing_operations WHERE id = v_op));

  RETURN jsonb_build_object('phase','25-B','results',v_results);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  RETURN jsonb_build_object('phase','25-B','error',v_err,'partial',v_results);
END $$;

REVOKE ALL ON FUNCTION public._test_phase25_machines_workcenters_operations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_phase25_machines_workcenters_operations() TO authenticated;
