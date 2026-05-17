CREATE OR REPLACE FUNCTION public.reserve_mo(_mo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mo record; comp record; loc uuid; q record;
  needed numeric; reserved_now numeric; before_res numeric; available numeric;
  total numeric := 0;
BEGIN
  SELECT * INTO mo FROM public.manufacturing_orders WHERE id=_mo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MO não encontrada'; END IF;
  loc := public._wh_main_internal_loc(mo.warehouse_id);
  IF loc IS NULL THEN RAISE EXCEPTION 'Sem localização interna'; END IF;

  FOR comp IN SELECT * FROM public.mo_components WHERE mo_id=_mo FOR UPDATE LOOP
    PERFORM public.lock_quant(comp.product_id, loc);

    needed := GREATEST(0, COALESCE(comp.qty_required,0) - COALESCE(comp.qty_reserved,0) - COALESCE(comp.qty_consumed,0));
    IF needed <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(GREATEST(0, quantity-reserved_quantity)),0) INTO available
      FROM public.stock_quants WHERE product_id=comp.product_id AND location_id=loc;
    IF available < needed THEN needed := available; END IF;

    reserved_now := 0;
    FOR q IN SELECT * FROM public.stock_quants
              WHERE product_id=comp.product_id AND location_id=loc
                AND quantity-reserved_quantity > 0
              ORDER BY updated_at FOR UPDATE LOOP
      EXIT WHEN reserved_now >= needed;
      DECLARE free_qty numeric := GREATEST(0, q.quantity-q.reserved_quantity);
              take numeric := LEAST(free_qty, needed-reserved_now);
      BEGIN
        IF take<=0 THEN CONTINUE; END IF;
        before_res := q.reserved_quantity;
        UPDATE public.stock_quants SET reserved_quantity=reserved_quantity+take, updated_at=now() WHERE id=q.id;
        PERFORM public.log_stock_reservation(comp.product_id, comp.variant_id, q.location_id, q.lot_id,
          take, before_res, before_res+take, 'MO', _mo, 'reserve',
          'reserve_mo comp='||comp.id::text);
        reserved_now := reserved_now + take;
      END;
    END LOOP;

    IF reserved_now > 0 THEN
      UPDATE public.mo_components
         SET qty_reserved = COALESCE(qty_reserved,0) + reserved_now,
             status = CASE WHEN COALESCE(qty_reserved,0)+reserved_now >= qty_required THEN 'reserved'::mo_component_status ELSE 'partial'::mo_component_status END
       WHERE id = comp.id;
      total := total + reserved_now;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reserved_total', total);
END $function$;