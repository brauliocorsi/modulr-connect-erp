
CREATE OR REPLACE FUNCTION public.recompute_sale_state(_so uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  is_delivered boolean;
  is_paid      boolean;
BEGIN
  SELECT id, state::text AS state, fulfillment_status, payment_status, amount_total
    INTO r FROM public.sale_orders WHERE id = _so FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.state IN ('draft','sent','cancelled','done') THEN
    RETURN;
  END IF;

  is_delivered := r.fulfillment_status IN ('delivered','settled');
  is_paid      := r.payment_status IN ('paid','overpaid')
                  OR (COALESCE(r.amount_total,0) = 0 AND is_delivered);

  IF r.state = 'confirmed' AND is_delivered AND is_paid THEN
    UPDATE public.sale_orders
       SET state = 'done', closed_at = COALESCE(closed_at, now())
     WHERE id = _so AND state = 'confirmed';
    PERFORM public.emit_event('sales'::app_module, 'sale.closed',
      jsonb_build_object('order_id', _so), 'sale_orders', _so);
  END IF;
END $$;
