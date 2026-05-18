
-- ============================================================================
-- F18-C — Repair, Quarantine and Disposition (BACKEND ONLY, ADDITIVE)
-- ============================================================================

ALTER TABLE public.service_case_items
  ADD COLUMN IF NOT EXISTS repair_status text,
  ADD COLUMN IF NOT EXISTS repair_result text,
  ADD COLUMN IF NOT EXISTS repair_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_notes text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_case_items_repair_status_chk') THEN
    ALTER TABLE public.service_case_items
      ADD CONSTRAINT service_case_items_repair_status_chk
      CHECK (repair_status IS NULL OR repair_status IN
        ('not_required','waiting_repair','in_repair','repaired_pending_qc',
         'repaired_approved','repair_failed','scrapped','outlet','supplier_claim'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_case_items_repair_result_chk') THEN
    ALTER TABLE public.service_case_items
      ADD CONSTRAINT service_case_items_repair_result_chk
      CHECK (repair_result IS NULL OR repair_result IN
        ('pass','fail','rework','scrap','outlet','supplier_claim'));
  END IF;
END $$;

ALTER TABLE public.stock_packages
  ADD COLUMN IF NOT EXISTS service_case_id uuid REFERENCES public.service_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_case_item_id uuid REFERENCES public.service_case_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposition_status text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_packages_disposition_status_chk') THEN
    ALTER TABLE public.stock_packages
      ADD CONSTRAINT stock_packages_disposition_status_chk
      CHECK (disposition_status IS NULL OR disposition_status IN
        ('pending_decision','repair','repaired','scrap','outlet',
         'supplier_claim','returned_to_stock'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_packages_service_case
  ON public.stock_packages(service_case_id) WHERE service_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_packages_disposition
  ON public.stock_packages(disposition_status) WHERE disposition_status IS NOT NULL;

INSERT INTO public.stock_locations (warehouse_id, name, full_path, type, is_zone, active)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, 'REPAIR', 'WH/REPAIR', 'internal', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010' AND name='REPAIR'
);

INSERT INTO public.stock_locations (warehouse_id, name, full_path, type, is_zone, active)
SELECT '00000000-0000-0000-0000-000000000010'::uuid, 'OUTLET', 'WH/OUTLET', 'internal', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010' AND name='OUTLET'
);

-- ============================================================================
-- Helpers (internal)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._svc_repair_loc(_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.stock_locations
  WHERE warehouse_id='00000000-0000-0000-0000-000000000010'
    AND name=_name
  ORDER BY active DESC, created_at ASC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._svc_pkg_quant_relocate(
  _package_id uuid, _to_location uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pkg public.stock_packages%ROWTYPE;
  v_from uuid;
BEGIN
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=_package_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_from := v_pkg.current_location_id;
  IF v_from = _to_location THEN RETURN; END IF;

  UPDATE public.stock_quants
     SET quantity = GREATEST(0, quantity - v_pkg.qty), updated_at = now()
   WHERE product_id = v_pkg.product_id AND location_id = v_from
     AND COALESCE(variant_id::text,'') = '';

  IF EXISTS (
    SELECT 1 FROM public.stock_quants
     WHERE product_id=v_pkg.product_id AND location_id=_to_location
       AND COALESCE(variant_id::text,'') = ''
  ) THEN
    UPDATE public.stock_quants
       SET quantity = quantity + v_pkg.qty, updated_at = now()
     WHERE product_id=v_pkg.product_id AND location_id=_to_location
       AND COALESCE(variant_id::text,'') = '';
  ELSE
    INSERT INTO public.stock_quants(product_id, location_id, quantity, reserved_quantity)
    VALUES (v_pkg.product_id, _to_location, v_pkg.qty, 0);
  END IF;
END $$;

-- ============================================================================
-- RPC 1: service_case_create_from_damaged_package
-- ============================================================================
CREATE OR REPLACE FUNCTION public.service_case_create_from_damaged_package(
  _stock_package_id uuid,
  _description text DEFAULT NULL,
  _action text DEFAULT 'repair'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_pkg public.stock_packages%ROWTYPE;
  v_case_id uuid;
  v_item_id uuid;
  v_report_id uuid;
  v_quarantine uuid;
  v_action service_case_item_action;
  v_case_number text;
BEGIN
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=_stock_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_case_create_from_damaged_package: package_not_found %', _stock_package_id;
  END IF;

  SELECT sc.id INTO v_case_id FROM public.service_cases sc
   WHERE sc.stock_package_id = _stock_package_id
     AND sc.status NOT IN ('done','cancelled','rejected')
   LIMIT 1;
  IF v_case_id IS NOT NULL THEN RETURN v_case_id; END IF;

  v_quarantine := public._svc_repair_loc('QUARANTINE');
  IF v_quarantine IS NULL THEN RAISE EXCEPTION 'QUARANTINE location not found'; END IF;

  v_action := CASE COALESCE(_action,'repair')
                WHEN 'inspect' THEN 'inspect'::service_case_item_action
                WHEN 'replace' THEN 'replace'::service_case_item_action
                WHEN 'supplier_claim' THEN 'supplier_claim'::service_case_item_action
                ELSE 'repair'::service_case_item_action
              END;

  SELECT id INTO v_report_id FROM public.package_damage_reports
   WHERE stock_package_id=_stock_package_id
     AND status IN ('reported','in_quarantine','in_repair')
   LIMIT 1;
  IF v_report_id IS NULL THEN
    INSERT INTO public.package_damage_reports(stock_package_id, damage_type, description, status)
    VALUES (_stock_package_id, 'internal_inventory', COALESCE(_description,'Damaged found in stock'), 'in_quarantine')
    RETURNING id INTO v_report_id;
  ELSE
    UPDATE public.package_damage_reports SET status='in_quarantine', updated_at=now() WHERE id=v_report_id;
  END IF;

  PERFORM public._svc_pkg_quant_relocate(_stock_package_id, v_quarantine);
  UPDATE public.stock_packages
     SET condition='damaged'::package_condition,
         status='returned'::package_status,
         current_location_id=v_quarantine,
         disposition_status='pending_decision',
         updated_at=now()
   WHERE id=_stock_package_id;

  v_case_number := 'SVC-INT-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substring(_stock_package_id::text,1,4);

  INSERT INTO public.service_cases(
    case_number, stock_package_id, product_id,
    case_type, source, status, responsibility, description, reported_at
  ) VALUES (
    v_case_number, _stock_package_id, v_pkg.product_id,
    'internal_rework'::service_case_type,
    'warehouse'::service_case_source,
    'triage'::service_case_status,
    'internal_manufacturing'::service_case_responsibility,
    COALESCE(_description,'Damaged package detected in inventory'),
    now()
  ) RETURNING id INTO v_case_id;

  INSERT INTO public.service_case_items(
    service_case_id, product_id, stock_package_id,
    issue_type, required_action, qty, status, repair_status
  ) VALUES (
    v_case_id, v_pkg.product_id, _stock_package_id,
    'damaged'::service_case_item_issue_type,
    v_action,
    v_pkg.qty,
    'open'::service_case_item_status,
    CASE WHEN v_action='repair'::service_case_item_action THEN 'waiting_repair' ELSE 'not_required' END
  ) RETURNING id INTO v_item_id;

  UPDATE public.stock_packages
     SET service_case_id=v_case_id, service_case_item_id=v_item_id, updated_at=now()
   WHERE id=_stock_package_id;

  INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
  VALUES (v_case_id, v_item_id,
          CASE WHEN v_action='repair'::service_case_item_action THEN 'repair'::service_task_type
               ELSE 'triage'::service_task_type END,
          'open'::service_task_status,
          'Auto-created from damaged package');

  RETURN v_case_id;
END $$;

-- ============================================================================
-- RPC 2: service_case_repair_start
-- ============================================================================
CREATE OR REPLACE FUNCTION public.service_case_repair_start(
  _case_item_id uuid, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.service_case_items%ROWTYPE;
  v_repair_loc uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'repair_start: item_not_found'; END IF;
  IF v_item.stock_package_id IS NULL THEN RAISE EXCEPTION 'repair_start: item has no stock_package'; END IF;
  IF v_item.repair_status IS NOT NULL AND v_item.repair_status NOT IN ('waiting_repair','repair_failed') THEN
    RAISE EXCEPTION 'repair_start: invalid transition from %', v_item.repair_status;
  END IF;

  v_repair_loc := public._svc_repair_loc('REPAIR');
  IF v_repair_loc IS NULL THEN RAISE EXCEPTION 'REPAIR location missing'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_item.stock_package_id, v_repair_loc);
  UPDATE public.stock_packages
     SET current_location_id=v_repair_loc, disposition_status='repair',
         status='returned'::package_status, updated_at=now()
   WHERE id=v_item.stock_package_id;

  UPDATE public.service_case_items
     SET repair_status='in_repair',
         repair_started_at=COALESCE(repair_started_at, now()),
         repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
   WHERE id=_case_item_id;

  IF NOT EXISTS (SELECT 1 FROM public.service_tasks
                  WHERE service_case_item_id=_case_item_id
                    AND task_type='repair'::service_task_type
                    AND status IN ('open','in_progress')) THEN
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'repair'::service_task_type, 'in_progress'::service_task_status, _notes);
  ELSE
    UPDATE public.service_tasks SET status='in_progress'::service_task_status, updated_at=now()
     WHERE service_case_item_id=_case_item_id AND task_type='repair'::service_task_type
       AND status IN ('open','in_progress');
  END IF;

  RETURN jsonb_build_object('ok',true,'item_id',_case_item_id,'repair_status','in_repair');
END $$;

-- ============================================================================
-- RPC 3: service_case_repair_complete
-- ============================================================================
CREATE OR REPLACE FUNCTION public.service_case_repair_complete(
  _case_item_id uuid, _result text, _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.service_case_items%ROWTYPE;
  v_case public.service_cases%ROWTYPE;
  v_pkg public.stock_packages%ROWTYPE;
  v_scrap uuid; v_outlet uuid;
  v_has_customer_link boolean;
BEGIN
  IF _result NOT IN ('pass','fail','rework','scrap','outlet','supplier_claim') THEN
    RAISE EXCEPTION 'repair_complete: invalid_result %', _result;
  END IF;
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'repair_complete: item_not_found'; END IF;
  IF v_item.repair_status IS NULL OR v_item.repair_status NOT IN ('in_repair','waiting_repair') THEN
    RAISE EXCEPTION 'repair_complete: invalid transition from %', v_item.repair_status;
  END IF;

  SELECT * INTO v_case FROM public.service_cases WHERE id=v_item.service_case_id;
  SELECT * INTO v_pkg  FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;
  v_has_customer_link := (v_case.customer_id IS NOT NULL OR v_case.sale_order_id IS NOT NULL);

  IF _result = 'pass' THEN
    UPDATE public.stock_packages
       SET condition='repaired'::package_condition, disposition_status='repaired', updated_at=now()
     WHERE id=v_pkg.id;
    IF v_has_customer_link THEN
      PERFORM public._service_reserve_quant(
        v_pkg.product_id, NULL, v_pkg.current_location_id, v_pkg.qty,
        v_case.id, v_item.id, 'service_case_item', v_item.id);
      UPDATE public.stock_packages SET status='reserved'::package_status WHERE id=v_pkg.id;
    END IF;
    UPDATE public.service_case_items
       SET repair_status='repaired_pending_qc', repair_result='pass',
           repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;

  ELSIF _result = 'rework' THEN
    UPDATE public.service_case_items
       SET repair_status='waiting_repair', repair_result='rework',
           repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'repair'::service_task_type, 'open'::service_task_status,
            COALESCE(_notes,'Rework required'));

  ELSIF _result = 'fail' THEN
    UPDATE public.service_case_items
       SET repair_status='repair_failed', repair_result='fail',
           repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_item.service_case_id, _case_item_id, 'triage'::service_task_type, 'open'::service_task_status,
            'Repair failed - decide next action');

  ELSIF _result = 'scrap' THEN
    v_scrap := COALESCE(public._svc_repair_loc('Sucata'), public._svc_repair_loc('SCRAP'));
    IF v_scrap IS NULL THEN RAISE EXCEPTION 'scrap location missing'; END IF;
    PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_scrap);
    UPDATE public.stock_packages
       SET current_location_id=v_scrap, condition='damaged'::package_condition,
           status='cancelled'::package_status, disposition_status='scrap', updated_at=now()
     WHERE id=v_pkg.id;
    UPDATE public.service_case_items
       SET repair_status='scrapped', repair_result='scrap',
           repair_completed_at=now(), status='done'::service_case_item_status,
           repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;

  ELSIF _result = 'outlet' THEN
    v_outlet := public._svc_repair_loc('OUTLET');
    IF v_outlet IS NULL THEN RAISE EXCEPTION 'OUTLET location missing'; END IF;
    PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_outlet);
    UPDATE public.stock_packages
       SET current_location_id=v_outlet, condition='repaired'::package_condition,
           status='returned'::package_status, disposition_status='outlet', updated_at=now()
     WHERE id=v_pkg.id;
    UPDATE public.service_case_items
       SET repair_status='outlet', repair_result='outlet',
           repair_completed_at=now(), status='done'::service_case_item_status,
           repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;

  ELSIF _result = 'supplier_claim' THEN
    UPDATE public.stock_packages
       SET disposition_status='supplier_claim', status='returned'::package_status, updated_at=now()
     WHERE id=v_pkg.id;
    UPDATE public.service_cases
       SET responsibility='supplier'::service_case_responsibility,
           status='waiting_supplier'::service_case_status, updated_at=now()
     WHERE id=v_case.id;
    UPDATE public.service_case_items
       SET repair_status='supplier_claim', repair_result='supplier_claim',
           repair_completed_at=now(), repair_notes=COALESCE(_notes, repair_notes), updated_at=now()
     WHERE id=_case_item_id;
    INSERT INTO public.service_tasks(service_case_id, service_case_item_id, task_type, status, notes)
    VALUES (v_case.id, _case_item_id, 'supplier_claim'::service_task_type, 'open'::service_task_status,
            COALESCE(_notes,'Supplier claim filed'));
  END IF;

  IF _result <> 'rework' THEN
    UPDATE public.service_tasks SET status='done'::service_task_status, updated_at=now()
     WHERE service_case_item_id=_case_item_id AND task_type='repair'::service_task_type
       AND status IN ('open','in_progress');
  END IF;

  RETURN jsonb_build_object('ok',true,'result',_result,'item_id',_case_item_id);
END $$;

-- ============================================================================
-- RPC 4: service_case_dispose_package
-- ============================================================================
CREATE OR REPLACE FUNCTION public.service_case_dispose_package(
  _case_item_id uuid, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.service_case_items%ROWTYPE;
  v_pkg public.stock_packages%ROWTYPE;
  v_scrap uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispose: item_not_found'; END IF;
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispose: package_not_found'; END IF;
  v_scrap := COALESCE(public._svc_repair_loc('Sucata'), public._svc_repair_loc('SCRAP'));
  IF v_scrap IS NULL THEN RAISE EXCEPTION 'scrap location missing'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_scrap);
  UPDATE public.stock_packages
     SET current_location_id=v_scrap, condition='damaged'::package_condition,
         status='cancelled'::package_status, disposition_status='scrap', updated_at=now()
   WHERE id=v_pkg.id;
  UPDATE public.service_case_items
     SET repair_status='scrapped', repair_result='scrap',
         repair_completed_at=now(), status='done'::service_case_item_status,
         repair_notes=COALESCE(_reason, repair_notes), updated_at=now()
   WHERE id=_case_item_id;
  UPDATE public.service_tasks SET status='done'::service_task_status, updated_at=now()
   WHERE service_case_item_id=_case_item_id AND status IN ('open','in_progress');

  RETURN jsonb_build_object('ok',true,'disposed',true,'item_id',_case_item_id);
END $$;

-- ============================================================================
-- RPC 5: service_case_release_repaired_to_stock
-- ============================================================================
CREATE OR REPLACE FUNCTION public.service_case_release_repaired_to_stock(
  _case_item_id uuid, _target_location_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.service_case_items%ROWTYPE;
  v_case public.service_cases%ROWTYPE;
  v_pkg public.stock_packages%ROWTYPE;
  v_target uuid;
BEGIN
  SELECT * INTO v_item FROM public.service_case_items WHERE id=_case_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release: item_not_found'; END IF;
  IF v_item.repair_status NOT IN ('repaired_pending_qc','repaired_approved') THEN
    RAISE EXCEPTION 'release: repair not approved (status=%)', v_item.repair_status;
  END IF;
  SELECT * INTO v_case FROM public.service_cases WHERE id=v_item.service_case_id;
  SELECT * INTO v_pkg  FROM public.stock_packages WHERE id=v_item.stock_package_id FOR UPDATE;

  IF v_case.customer_id IS NOT NULL OR v_case.sale_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'REPAIRED_ITEM_RESERVED_TO_CASE';
  END IF;

  v_target := COALESCE(_target_location_id, public._svc_repair_loc('Stock'), public._svc_repair_loc('STOCK'));
  IF v_target IS NULL THEN RAISE EXCEPTION 'release: no target stock location'; END IF;

  PERFORM public._svc_pkg_quant_relocate(v_pkg.id, v_target);
  UPDATE public.stock_packages
     SET current_location_id=v_target, condition='repaired'::package_condition,
         status='available'::package_status, disposition_status='returned_to_stock', updated_at=now()
   WHERE id=v_pkg.id;
  UPDATE public.service_case_items
     SET repair_status='repaired_approved', status='done'::service_case_item_status, updated_at=now()
   WHERE id=_case_item_id;

  RETURN jsonb_build_object('ok',true,'released',true,'location_id',v_target);
END $$;

-- ============================================================================
-- Health check
-- ============================================================================
CREATE OR REPLACE FUNCTION public.erp_service_repair_health_check(_threshold_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_row record;
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_quar uuid := public._svc_repair_loc('QUARANTINE');
  v_dmg  uuid := public._svc_repair_loc('DAMAGED');
  v_outlet uuid := public._svc_repair_loc('OUTLET');
BEGIN
  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE condition='damaged'::package_condition AND status='available'::package_status
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','damaged_package_available','severity','P0','entity','stock_package','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE current_location_id IN (v_quar, v_dmg) AND sale_order_id IS NOT NULL
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','quarantine_package_reserved_for_sale','severity','P0','entity','stock_package','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT sc.id FROM public.service_cases sc
     WHERE sc.status='done'
       AND EXISTS (SELECT 1 FROM public.stock_packages p WHERE p.service_case_id=sc.id AND p.disposition_status IN ('pending_decision','repair'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','service_case_closed_with_unresolved_damaged_package','severity','P0','entity','service_case','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT p.id FROM public.stock_packages p
     WHERE p.condition='repaired'::package_condition AND p.status='available'::package_status
       AND COALESCE(p.disposition_status,'') <> 'returned_to_stock'
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','repaired_package_available_without_qc','severity','P0','entity','stock_package','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE disposition_status='scrap' AND status='available'::package_status
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','scrapped_package_still_available','severity','P0','entity','stock_package','entity_id',v_row.id);
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE condition='damaged'::package_condition AND disposition_status IS NULL
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','damaged_package_without_disposition','severity','P1','entity','stock_package','entity_id',v_row.id);
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT sci.id FROM public.service_case_items sci
     WHERE sci.repair_status='in_repair'
       AND sci.repair_started_at < now() - make_interval(days => _threshold_days)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','package_in_repair_too_long','severity','P1','entity','service_case_item','entity_id',v_row.id);
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT sci.id FROM public.service_case_items sci
     WHERE sci.repair_status='repair_failed'
       AND NOT EXISTS (SELECT 1 FROM public.service_tasks st
                        WHERE st.service_case_item_id=sci.id AND st.status IN ('open','in_progress'))
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','repair_failed_without_next_action','severity','P1','entity','service_case_item','entity_id',v_row.id);
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE disposition_status='outlet' AND current_location_id <> v_outlet
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','outlet_package_in_regular_stock','severity','P1','entity','stock_package','entity_id',v_row.id);
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id FROM public.stock_packages
     WHERE current_location_id=v_quar
       AND updated_at < now() - make_interval(days => _threshold_days*2)
  LOOP
    v_findings := v_findings || jsonb_build_object('category','repair','code','old_quarantine_without_movement','severity','P2','entity','stock_package','entity_id',v_row.id);
    v_p2 := v_p2+1;
  END LOOP;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('p0',v_p0,'p1',v_p1,'p2',v_p2,'total', jsonb_array_length(v_findings)),
    'findings', v_findings
  );
END $$;

-- ============================================================================
-- Self-test: _test_phase18_repair_disposition_flow (inline assertions)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._test_phase18_repair_disposition_flow(_cleanup boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tests jsonb := '[]'::jsonb;
  v_pass int := 0; v_fail int := 0;
  v_prod uuid; v_loc_stock uuid; v_loc_quar uuid; v_loc_repair uuid; v_loc_scrap uuid; v_loc_outlet uuid;
  v_pkg1 uuid; v_pkg2 uuid; v_pkg3 uuid; v_pkg4 uuid; v_pkg5 uuid; v_pkg6 uuid; v_pkgh uuid;
  v_case1 uuid; v_case2 uuid; v_case_dup uuid;
  v_item1 uuid; v_item2 uuid; v_item5 uuid; v_item6 uuid;
  v_customer uuid;
  v_rec record; v_pkg record;
  v_ok boolean; v_err text;
  v_hres jsonb;
BEGIN
  v_loc_stock  := public._svc_repair_loc('Stock');
  v_loc_quar   := public._svc_repair_loc('QUARANTINE');
  v_loc_repair := public._svc_repair_loc('REPAIR');
  v_loc_scrap  := COALESCE(public._svc_repair_loc('Sucata'), public._svc_repair_loc('SCRAP'));
  v_loc_outlet := public._svc_repair_loc('OUTLET');

  v_ok := v_loc_stock IS NOT NULL AND v_loc_quar IS NOT NULL AND v_loc_repair IS NOT NULL
          AND v_loc_scrap IS NOT NULL AND v_loc_outlet IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','01_locations_bootstrapped','passed',v_ok,
    'detail',format('stock=%s quar=%s repair=%s scrap=%s outlet=%s',v_loc_stock,v_loc_quar,v_loc_repair,v_loc_scrap,v_loc_outlet));
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  SELECT id INTO v_prod FROM public.products WHERE active LIMIT 1;
  v_ok := v_prod IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','02_product_exists','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  SELECT id INTO v_customer FROM public.partners WHERE is_customer LIMIT 1;
  IF v_customer IS NULL THEN SELECT id INTO v_customer FROM public.partners LIMIT 1; END IF;

  -- Seed pkg1
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg1;

  v_case1 := public.service_case_create_from_damaged_package(v_pkg1, 'Damaged in inventory', 'repair');
  v_ok := v_case1 IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','03_case_created','passed',v_ok,'detail',v_case1::text);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  v_case_dup := public.service_case_create_from_damaged_package(v_pkg1, 'second call', 'repair');
  v_ok := (v_case_dup = v_case1);
  v_tests := v_tests || jsonb_build_object('name','04_case_not_duplicated','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  v_ok := EXISTS (SELECT 1 FROM public.package_damage_reports WHERE stock_package_id=v_pkg1);
  v_tests := v_tests || jsonb_build_object('name','05_damage_report_exists','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg1;
  v_ok := v_pkg.current_location_id=v_loc_quar AND v_pkg.condition='damaged' AND v_pkg.status<>'available'
          AND v_pkg.service_case_id=v_case1 AND v_pkg.disposition_status='pending_decision';
  v_tests := v_tests || jsonb_build_object('name','06_pkg_in_quarantine','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  SELECT * INTO v_rec FROM public.service_case_items WHERE service_case_id=v_case1 AND stock_package_id=v_pkg1 LIMIT 1;
  v_item1 := v_rec.id;
  v_ok := v_rec.repair_status='waiting_repair' AND v_rec.required_action='repair';
  v_tests := v_tests || jsonb_build_object('name','07_item_waiting_repair','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.service_case_repair_start(v_item1, 'Begin repair');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg1;
  SELECT * INTO v_rec FROM public.service_case_items WHERE id=v_item1;
  v_ok := v_pkg.current_location_id=v_loc_repair AND v_rec.repair_status='in_repair' AND v_rec.repair_started_at IS NOT NULL;
  v_tests := v_tests || jsonb_build_object('name','08_repair_started','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.service_case_repair_complete(v_item1, 'pass', 'Looks good');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg1;
  SELECT * INTO v_rec FROM public.service_case_items WHERE id=v_item1;
  v_ok := v_pkg.condition='repaired' AND v_rec.repair_status='repaired_pending_qc' AND v_pkg.status<>'available';
  v_tests := v_tests || jsonb_build_object('name','09_repaired_pending_qc','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  PERFORM public.service_case_release_repaired_to_stock(v_item1, v_loc_stock);
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg1;
  SELECT * INTO v_rec FROM public.service_case_items WHERE id=v_item1;
  v_ok := v_pkg.current_location_id=v_loc_stock AND v_pkg.condition='repaired' AND v_pkg.status='available'
          AND v_rec.repair_status='repaired_approved' AND v_pkg.disposition_status='returned_to_stock';
  v_tests := v_tests || jsonb_build_object('name','10_released_to_stock_available','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Customer-linked
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg2;
  v_case2 := public.service_case_create_from_damaged_package(v_pkg2, 'customer-linked', 'repair');
  UPDATE public.service_cases SET customer_id=v_customer WHERE id=v_case2;
  SELECT id INTO v_item2 FROM public.service_case_items WHERE service_case_id=v_case2 LIMIT 1;
  PERFORM public.service_case_repair_start(v_item2);
  PERFORM public.service_case_repair_complete(v_item2, 'pass');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg2;
  v_ok := v_pkg.condition='repaired' AND v_pkg.status='reserved';
  v_tests := v_tests || jsonb_build_object('name','11_customer_pass_reserved','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  v_ok := false; v_err := NULL;
  BEGIN
    PERFORM public.service_case_release_repaired_to_stock(v_item2);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v_ok := (v_err LIKE '%REPAIRED_ITEM_RESERVED_TO_CASE%');
  END;
  v_tests := v_tests || jsonb_build_object('name','12_release_blocked_when_customer_linked','passed',v_ok,'detail',v_err);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Scrap
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg3;
  PERFORM public.service_case_create_from_damaged_package(v_pkg3, 'scrap candidate', 'repair');
  SELECT id INTO v_item1 FROM public.service_case_items WHERE stock_package_id=v_pkg3 LIMIT 1;
  PERFORM public.service_case_repair_start(v_item1);
  PERFORM public.service_case_repair_complete(v_item1, 'scrap', 'irreparable');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg3;
  v_ok := v_pkg.current_location_id=v_loc_scrap AND v_pkg.status='cancelled' AND v_pkg.disposition_status='scrap';
  v_tests := v_tests || jsonb_build_object('name','13_scrap_moved_and_cancelled','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Supplier claim
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg4;
  PERFORM public.service_case_create_from_damaged_package(v_pkg4, 'supplier defect', 'repair');
  SELECT id INTO v_item1 FROM public.service_case_items WHERE stock_package_id=v_pkg4 LIMIT 1;
  PERFORM public.service_case_repair_start(v_item1);
  PERFORM public.service_case_repair_complete(v_item1, 'supplier_claim', 'vendor fault');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg4;
  SELECT * INTO v_rec FROM public.service_cases WHERE id=v_pkg.service_case_id;
  v_ok := v_pkg.disposition_status='supplier_claim' AND v_pkg.status<>'available'
          AND v_rec.responsibility='supplier' AND v_rec.status='waiting_supplier';
  v_tests := v_tests || jsonb_build_object('name','14_supplier_claim_blocks_package','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  v_ok := EXISTS (SELECT 1 FROM public.service_tasks WHERE service_case_item_id=v_item1 AND task_type='supplier_claim');
  v_tests := v_tests || jsonb_build_object('name','15_supplier_claim_task_created','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Rework
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg5;
  PERFORM public.service_case_create_from_damaged_package(v_pkg5, 'rework', 'repair');
  SELECT id INTO v_item5 FROM public.service_case_items WHERE stock_package_id=v_pkg5 LIMIT 1;
  PERFORM public.service_case_repair_start(v_item5);
  PERFORM public.service_case_repair_complete(v_item5, 'rework', 'try again');
  SELECT * INTO v_pkg FROM public.stock_packages WHERE id=v_pkg5;
  SELECT * INTO v_rec FROM public.service_case_items WHERE id=v_item5;
  v_ok := v_rec.repair_status='waiting_repair' AND v_pkg.status<>'available';
  v_tests := v_tests || jsonb_build_object('name','16_rework_keeps_out_of_stock','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  v_ok := (SELECT count(*) FROM public.service_tasks WHERE service_case_item_id=v_item5
            AND task_type='repair' AND status='open') >= 1;
  v_tests := v_tests || jsonb_build_object('name','17_rework_new_task_open','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Release without QC must fail
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status)
  VALUES (v_prod, 1, v_loc_stock, 'good', 'available') RETURNING id INTO v_pkg6;
  PERFORM public.service_case_create_from_damaged_package(v_pkg6, 'no qc', 'repair');
  SELECT id INTO v_item6 FROM public.service_case_items WHERE stock_package_id=v_pkg6 LIMIT 1;
  v_ok := false; v_err := NULL;
  BEGIN
    PERFORM public.service_case_release_repaired_to_stock(v_item6, v_loc_stock);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_err := SQLERRM; END;
  v_tests := v_tests || jsonb_build_object('name','18_release_without_qc_blocked','passed',v_ok,'detail',v_err);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;

  -- Health check fires
  INSERT INTO public.stock_packages(product_id, qty, current_location_id, condition, status, disposition_status)
  VALUES (v_prod, 1, v_loc_stock, 'damaged', 'available', 'pending_decision') RETURNING id INTO v_pkgh;
  v_hres := public.erp_service_repair_health_check();
  v_ok := EXISTS (SELECT 1 FROM jsonb_array_elements(v_hres->'findings') f
                   WHERE f->>'code'='damaged_package_available'
                     AND (f->>'entity_id')::uuid = v_pkgh);
  v_tests := v_tests || jsonb_build_object('name','19_health_damaged_available_detected','passed',v_ok);
  IF v_ok THEN v_pass:=v_pass+1; ELSE v_fail:=v_fail+1; END IF;
  DELETE FROM public.stock_packages WHERE id=v_pkgh;

  -- Cleanup
  IF _cleanup THEN
    DELETE FROM public.service_tasks WHERE service_case_id IN (
      SELECT id FROM public.service_cases WHERE stock_package_id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6));
    DELETE FROM public.stock_reservation_log WHERE to_service_case_id IN (
      SELECT id FROM public.service_cases WHERE stock_package_id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6));
    UPDATE public.stock_packages SET service_case_id=NULL, service_case_item_id=NULL
      WHERE id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6);
    DELETE FROM public.service_case_items WHERE stock_package_id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6);
    DELETE FROM public.service_cases WHERE stock_package_id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6);
    DELETE FROM public.package_damage_reports WHERE stock_package_id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6);
    DELETE FROM public.stock_packages WHERE id IN (v_pkg1,v_pkg2,v_pkg3,v_pkg4,v_pkg5,v_pkg6);
  END IF;

  RETURN jsonb_build_object(
    'phase','18-C-repair-disposition',
    'passed', v_pass, 'failed', v_fail, 'total', v_pass+v_fail, 'tests', v_tests
  );
END $$;
