-- F16-B0.7: Allocation Engine Health Check
CREATE OR REPLACE FUNCTION public.erp_allocation_health_check(_threshold_hours integer DEFAULT 48)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_findings jsonb := '[]'::jsonb;
  v_p0 int := 0; v_p1 int := 0; v_p2 int := 0;
  v_started_at timestamptz := clock_timestamp();
  v_row record;
  v_threshold timestamptz := now() - make_interval(hours => _threshold_hours);
BEGIN
  FOR v_row IN
    SELECT sol.id, sol.order_id, sol.product_id, sol.qty_reserved, so.name AS so_name, so.state
    FROM sale_order_lines sol JOIN sale_orders so ON so.id = sol.order_id
    WHERE so.state = 'cancelled' AND COALESCE(sol.qty_reserved,0) > 0
  LOOP
    v_findings := v_findings || jsonb_build_object('code','stock_reserved_to_cancelled_sale','severity','P0','entity','sale_order_line','entity_id',v_row.id,
      'detail', format('SOL %s SO %s qty_reserved=%s', v_row.id, v_row.so_name, v_row.qty_reserved));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sp.id, sp.sale_order_id, sp.sale_order_line_id, sp.status, so.name AS so_name
    FROM stock_packages sp JOIN sale_orders so ON so.id = sp.sale_order_id
    WHERE so.state = 'cancelled' AND (sp.status='reserved' OR sp.sale_order_line_id IS NOT NULL)
      AND sp.status NOT IN ('delivered','cancelled','returned')
  LOOP
    v_findings := v_findings || jsonb_build_object('code','package_reserved_to_cancelled_sale','severity','P0','entity','stock_package','entity_id',v_row.id,
      'detail', format('Pkg %s SO %s status=%s', v_row.id, v_row.so_name, v_row.status));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT id, product_id, quantity, reserved_quantity FROM stock_quants WHERE reserved_quantity > quantity + 1e-9
  LOOP
    v_findings := v_findings || jsonb_build_object('code','reserved_quantity_exceeds_quantity','severity','P0','entity','stock_quant','entity_id',v_row.id,
      'detail', format('Quant prod=%s reserved=%s qty=%s', v_row.product_id, v_row.reserved_quantity, v_row.quantity));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sp.id, sp.status FROM stock_packages sp
    LEFT JOIN sale_order_lines sol ON sol.id = sp.sale_order_line_id
    LEFT JOIN sale_orders so ON so.id = sol.order_id
    WHERE sp.status IN ('at_dock','loaded','delivered') AND so.state = 'cancelled'
  LOOP
    v_findings := v_findings || jsonb_build_object('code','package_in_truck_reallocated','severity','P0','entity','stock_package','entity_id',v_row.id,
      'detail', format('Pkg %s fluxo físico %s SO cancelada', v_row.id, v_row.status));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sp.id, sp.condition, sp.status FROM stock_packages sp
    WHERE sp.condition IN ('damaged','quarantine','missing')
      AND (sp.status = 'reserved' OR sp.sale_order_line_id IS NOT NULL)
      AND sp.status NOT IN ('cancelled','delivered','returned')
  LOOP
    v_findings := v_findings || jsonb_build_object('code','package_damaged_or_quarantine_allocated','severity','P0','entity','stock_package','entity_id',v_row.id,
      'detail', format('Pkg %s condition=%s status=%s', v_row.id, v_row.condition, v_row.status));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT mo.id, mo.code, mo.qty, sol.qty_reserved FROM manufacturing_orders mo
    JOIN sale_order_lines sol ON sol.id = mo.sale_order_line_id
    JOIN sale_orders so ON so.id = sol.order_id
    WHERE mo.state = 'done' AND so.state IN ('confirmed','sale')
      AND COALESCE(sol.qty_reserved,0) < mo.qty - 1e-9
  LOOP
    v_findings := v_findings || jsonb_build_object('code','mo_of_active_so_finished_but_available_free','severity','P0','entity','manufacturing_order','entity_id',v_row.id,
      'detail', format('MO %s done qty_reserved=%s < qty=%s', v_row.code, v_row.qty_reserved, v_row.qty));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sol.id, sol.product_id, sol.qty_reserved FROM sale_order_lines sol
    JOIN products p ON p.id = sol.product_id JOIN sale_orders so ON so.id = sol.order_id
    WHERE p.package_tracking_enabled = true AND COALESCE(sol.qty_reserved,0) > 0
      AND so.state IN ('confirmed','sale')
      AND NOT EXISTS (SELECT 1 FROM stock_packages sp WHERE sp.sale_order_line_id = sol.id AND sp.status='reserved')
  LOOP
    v_findings := v_findings || jsonb_build_object('code','package_tracking_on_allocated_without_stock_package','severity','P0','entity','sale_order_line','entity_id',v_row.id,
      'detail', format('SOL %s reservado=%s sem stock_package', v_row.id, v_row.qty_reserved));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT id, event_type, error_message FROM allocation_hook_events
    WHERE status='failed' AND created_at > now()-interval '7 days'
  LOOP
    v_findings := v_findings || jsonb_build_object('code','allocation_hook_failed_p0','severity','P0','entity','allocation_hook_event','entity_id',v_row.id,
      'detail', format('Hook %s falhou: %s', v_row.event_type, COALESCE(v_row.error_message,'(sem msg)')));
    v_p0 := v_p0+1;
  END LOOP;

  FOR v_row IN
    SELECT sol.id, sol.product_id, sol.quantity, sol.qty_reserved FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id JOIN products p ON p.id = sol.product_id
    WHERE so.state IN ('confirmed','sale') AND COALESCE(sol.qty_reserved,0) < sol.quantity - 1e-9
      AND p.allocation_policy IN ('oldest_order_first','stock_pool_first','delivery_date_first','paid_priority')
      AND EXISTS (SELECT 1 FROM stock_quants q JOIN stock_locations sl ON sl.id=q.location_id
        WHERE q.product_id=sol.product_id AND sl.type='internal' AND (q.quantity - q.reserved_quantity) > 0)
  LOOP
    v_findings := v_findings || jsonb_build_object('code','allocation_candidate_exists_but_not_reserved','severity','P1','entity','sale_order_line','entity_id',v_row.id,
      'detail', format('SOL %s qty=%s reservado=%s', v_row.id, v_row.quantity, v_row.qty_reserved));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT id, created_at FROM allocation_decisions WHERE state='pending' AND created_at < v_threshold
  LOOP
    v_findings := v_findings || jsonb_build_object('code','manual_allocation_pending_too_long','severity','P1','entity','allocation_decision','entity_id',v_row.id,
      'detail', format('pending desde %s', v_row.created_at));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT ad.id, ad.product_id FROM allocation_decisions ad JOIN products p ON p.id = ad.product_id
    WHERE ad.state='pending' AND p.allocation_policy='strict_order'
  LOOP
    v_findings := v_findings || jsonb_build_object('code','strict_order_pending_decision','severity','P1','entity','allocation_decision','entity_id',v_row.id,
      'detail', format('strict_order prod=%s', v_row.product_id));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT id, name FROM products WHERE allocation_policy='custom_priority'
      AND (allocation_priority_weights IS NULL OR jsonb_typeof(allocation_priority_weights) <> 'object' OR allocation_priority_weights = '{}'::jsonb)
  LOOP
    v_findings := v_findings || jsonb_build_object('code','custom_priority_without_weights','severity','P1','entity','product','entity_id',v_row.id,
      'detail', format('Produto %s custom sem pesos', v_row.name));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN
    SELECT mo.id, mo.code, mo.product_id FROM manufacturing_orders mo
    JOIN sale_order_lines sol ON sol.id = mo.sale_order_line_id
    JOIN sale_orders so ON so.id = sol.order_id
    WHERE mo.state='in_progress' AND so.state='cancelled'
      AND NOT EXISTS (SELECT 1 FROM allocation_decisions ad WHERE ad.product_id = mo.product_id AND ad.state='pending')
  LOOP
    v_findings := v_findings || jsonb_build_object('code','mo_in_progress_for_cancelled_so_without_decision','severity','P1','entity','manufacturing_order','entity_id',v_row.id,
      'detail', format('MO %s in_progress SO cancelada', v_row.code));
    v_p1 := v_p1+1;
  END LOOP;

  FOR v_row IN SELECT id, name FROM products WHERE can_be_sold=true AND allocation_policy IS NULL LIMIT 100 LOOP
    v_findings := v_findings || jsonb_build_object('code','allocation_policy_missing','severity','P2','entity','product','entity_id',v_row.id,
      'detail', format('Produto %s sem allocation_policy', v_row.name));
    v_p2 := v_p2+1;
  END LOOP;

  FOR v_row IN SELECT id FROM allocation_decisions WHERE state='pending' AND created_at < now() - interval '7 days' LOOP
    v_findings := v_findings || jsonb_build_object('code','allocation_suggestion_ignored','severity','P2','entity','allocation_decision','entity_id',v_row.id,'detail','Sugestão ignorada >7d');
    v_p2 := v_p2+1;
  END LOOP;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object('run_at', now(),'total', v_p0+v_p1+v_p2, 'p0', v_p0, 'p1', v_p1, 'p2', v_p2,
      'duration_ms', EXTRACT(MILLISECOND FROM (clock_timestamp()-v_started_at))::int),
    'findings', v_findings
  );
END $$;

CREATE OR REPLACE FUNCTION public.erp_allocation_safe_remediation(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actions jsonb := '[]'::jsonb;
  v_row record; v_res jsonb; v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ahe.id, ahe.product_id, ahe.variant_id, ahe.location_id, ahe.event_type FROM allocation_hook_events ahe
    WHERE ahe.status='failed' AND ahe.created_at > now()-interval '7 days'
      AND EXISTS (SELECT 1 FROM stock_quants q JOIN stock_locations sl ON sl.id=q.location_id
        WHERE q.product_id=ahe.product_id AND sl.type='internal' AND (q.quantity - q.reserved_quantity) > 0)
    LIMIT 50
  LOOP
    v_count := v_count + 1;
    IF _dry_run THEN
      v_actions := v_actions || jsonb_build_object('action','retry_failed_hook','hook_id',v_row.id,'dry_run',true);
    ELSE
      BEGIN
        v_res := public.run_inventory_allocation(v_row.product_id, v_row.variant_id, v_row.location_id, NULL, 'safe_remediation_retry');
        UPDATE allocation_hook_events SET status='ok', error_message=NULL, error_detail=NULL, result=v_res WHERE id=v_row.id;
        v_actions := v_actions || jsonb_build_object('action','retry_failed_hook','hook_id',v_row.id,'result',v_res);
      EXCEPTION WHEN OTHERS THEN
        v_actions := v_actions || jsonb_build_object('action','retry_failed_hook','hook_id',v_row.id,'error',SQLERRM);
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run',_dry_run,'count',v_count,'actions',v_actions);
END $$;