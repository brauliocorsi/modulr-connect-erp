
DROP FUNCTION IF EXISTS public.calc_delivery_price(uuid);

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS delivery_region_rule_id uuid REFERENCES public.delivery_region_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_zip_rule_id uuid REFERENCES public.delivery_zip_rules(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.calc_delivery_price(_order uuid)
 RETURNS TABLE(price numeric, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o record; p record; pref text; r record;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN price := 0; label := NULL; RETURN NEXT; RETURN; END IF;

  IF o.delivery_zip_rule_id IS NOT NULL THEN
    SELECT * INTO r FROM public.delivery_zip_rules WHERE id = o.delivery_zip_rule_id;
    IF FOUND THEN
      price := r.price; label := COALESCE(r.label, r.zip_from || '-' || r.zip_to);
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF o.delivery_region_rule_id IS NOT NULL THEN
    SELECT * INTO r FROM public.delivery_region_rules WHERE id = o.delivery_region_rule_id;
    IF FOUND THEN
      price := r.price; label := r.region;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF o.partner_id IS NOT NULL THEN
    SELECT zip, state, country INTO p FROM public.partners WHERE id = o.partner_id;
    IF FOUND THEN
      pref := regexp_replace(COALESCE(p.zip,''), '[^0-9]', '', 'g');
      IF length(pref) >= 4 THEN
        pref := substring(pref from 1 for 4);
        SELECT * INTO r FROM public.delivery_zip_rules
          WHERE active AND pref BETWEEN zip_from AND zip_to
          ORDER BY (zip_to::int - zip_from::int) ASC LIMIT 1;
        IF FOUND THEN
          price := r.price; label := COALESCE(r.label, r.zip_from || '-' || r.zip_to);
          RETURN NEXT; RETURN;
        END IF;
      END IF;
      IF p.state IS NOT NULL THEN
        SELECT * INTO r FROM public.delivery_region_rules
          WHERE active AND lower(region) = lower(p.state)
          ORDER BY (CASE WHEN country = COALESCE(p.country,'PT') THEN 0 ELSE 1 END) ASC
          LIMIT 1;
        IF FOUND THEN
          price := r.price; label := r.region;
          RETURN NEXT; RETURN;
        END IF;
      END IF;
    END IF;
  END IF;

  price := 0; label := NULL;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.refresh_order_services(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o record;
  asm_total numeric := 0;
  surcharge numeric := 0;
  base_price numeric := 0;
  zone_label text;
  total_delivery numeric := 0;
  untaxed numeric;
BEGIN
  SELECT * INTO o FROM public.sale_orders WHERE id = _order;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.sale_order_lines WHERE order_id = _order AND line_kind IN ('assembly','delivery');

  IF o.include_assembly THEN
    SELECT COALESCE(SUM(sol.quantity * COALESCE(p.assembly_fee,0)), 0)
      INTO asm_total
      FROM public.sale_order_lines sol
      JOIN public.products p ON p.id = sol.product_id
      WHERE sol.order_id = _order AND sol.line_kind = 'product';
    IF asm_total > 0 THEN
      INSERT INTO public.sale_order_lines(order_id, line_kind, description, quantity, unit_price, subtotal, sequence)
      VALUES (_order, 'assembly', 'Serviço de montagem', 1, asm_total, asm_total, 9000);
    END IF;
  END IF;

  IF o.include_delivery THEN
    SELECT COALESCE(SUM(sol.quantity * COALESCE(p.delivery_surcharge,0)), 0)
      INTO surcharge
      FROM public.sale_order_lines sol
      JOIN public.products p ON p.id = sol.product_id
      WHERE sol.order_id = _order AND sol.line_kind = 'product';
    SELECT cdp.price, cdp.label INTO base_price, zone_label
      FROM public.calc_delivery_price(_order) cdp;
    base_price := COALESCE(base_price, 0);
    total_delivery := base_price + surcharge;
    UPDATE public.sale_orders SET delivery_zone_label = zone_label WHERE id = _order;
    IF total_delivery > 0 THEN
      INSERT INTO public.sale_order_lines(order_id, line_kind, description, quantity, unit_price, subtotal, sequence)
      VALUES (_order, 'delivery',
              'Entrega' || CASE WHEN zone_label IS NOT NULL THEN ' — ' || zone_label ELSE '' END,
              1, total_delivery, total_delivery, 9100);
    END IF;
  ELSE
    UPDATE public.sale_orders SET delivery_zone_label = NULL WHERE id = _order;
  END IF;

  SELECT COALESCE(SUM(subtotal),0) INTO untaxed FROM public.sale_order_lines WHERE order_id = _order;
  UPDATE public.sale_orders
     SET amount_untaxed = untaxed,
         amount_total = untaxed + COALESCE(amount_tax,0)
   WHERE id = _order;
END $function$;
