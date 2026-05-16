
CREATE OR REPLACE FUNCTION public.schedule_footprint(_sale_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vol numeric := 0; v_w numeric := 0; v_asm numeric := 0;
  v_max_l numeric := 0; v_max_w numeric := 0; v_max_h numeric := 0;
  v_pkg_count int := 0; v_non_stack int := 0; v_fragile int := 0; v_flat int := 0;
  r record; use_tpl boolean;
  tpl record;
BEGIN
  FOR r IN
    SELECT sol.product_id, sol.quantity, p.package_tracking_enabled,
           COALESCE(p.volume_m3,0) AS p_vol,
           COALESCE(p.weight_kg, p.weight, 0) AS p_w,
           COALESCE(p.assembly_minutes,0) AS p_asm
    FROM sale_order_lines sol
    JOIN products p ON p.id=sol.product_id
    WHERE sol.order_id=_sale_order_id
      AND COALESCE(sol.line_kind,'product')='product'
      AND p.type IN ('storable','consumable')
  LOOP
    use_tpl := COALESCE(r.package_tracking_enabled,false) AND EXISTS (
      SELECT 1 FROM product_package_templates pt WHERE pt.product_id=r.product_id AND pt.active
    );
    IF use_tpl THEN
      FOR tpl IN
        SELECT default_volume_m3, default_weight_kg, default_assembly_minutes,
               default_length_cm, default_width_cm, default_height_cm,
               stackable, fragile, requires_flat_transport
        FROM product_package_templates
        WHERE product_id=r.product_id AND active
      LOOP
        v_vol := v_vol + COALESCE(tpl.default_volume_m3,0) * r.quantity;
        v_w := v_w + COALESCE(tpl.default_weight_kg,0) * r.quantity;
        v_asm := v_asm + COALESCE(tpl.default_assembly_minutes,0) * r.quantity;
        v_max_l := GREATEST(v_max_l, COALESCE(tpl.default_length_cm,0));
        v_max_w := GREATEST(v_max_w, COALESCE(tpl.default_width_cm,0));
        v_max_h := GREATEST(v_max_h, COALESCE(tpl.default_height_cm,0));
        v_pkg_count := v_pkg_count + r.quantity::int;
        IF NOT COALESCE(tpl.stackable,false) THEN v_non_stack := v_non_stack + r.quantity::int; END IF;
        IF COALESCE(tpl.fragile,false) THEN v_fragile := v_fragile + r.quantity::int; END IF;
        IF COALESCE(tpl.requires_flat_transport,false) THEN v_flat := v_flat + r.quantity::int; END IF;
      END LOOP;
    ELSE
      v_vol := v_vol + r.p_vol * r.quantity;
      v_w := v_w + r.p_w * r.quantity;
      v_asm := v_asm + r.p_asm * r.quantity;
      v_pkg_count := v_pkg_count + r.quantity::int;
      v_non_stack := v_non_stack + r.quantity::int;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'deliveries', 1,
    'volume_m3', v_vol,
    'weight_kg', v_w,
    'assembly_minutes', v_asm,
    'package_count', v_pkg_count,
    'max_length_cm', v_max_l,
    'max_width_cm', v_max_w,
    'max_height_cm', v_max_h,
    'non_stackable_count', v_non_stack,
    'fragile_count', v_fragile,
    'flat_transport_count', v_flat
  );
END $function$;
