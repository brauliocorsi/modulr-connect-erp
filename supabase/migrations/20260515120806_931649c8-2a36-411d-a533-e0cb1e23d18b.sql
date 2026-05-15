
CREATE OR REPLACE FUNCTION public.tg_so_confirm_create_purchase_needs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_avail numeric; v_short numeric; v_need uuid; v_count int := 0;
BEGIN
  IF NEW.state = 'confirmed' AND COALESCE(OLD.state::text,'') <> 'confirmed' THEN
    FOR r IN
      SELECT sol.product_id, sol.quantity, p.can_be_purchased, p.can_be_manufactured, p.name
        FROM sale_order_lines sol
        JOIN products p ON p.id = sol.product_id
       WHERE sol.order_id = NEW.id AND p.type = 'storable' AND p.can_be_purchased
    LOOP
      SELECT COALESCE(SUM(available),0) INTO v_avail
        FROM product_stock_forecast WHERE product_id = r.product_id;
      v_short := r.quantity - COALESCE(v_avail,0);
      IF v_short > 0 AND NOT r.can_be_manufactured THEN
        v_need := create_purchase_need(r.product_id, v_short, 'sale'::purchase_need_origin,
          NEW.id, NULL, COALESCE(NEW.commitment_date::date, NEW.validity_date),
          'Auto: stock insuficiente para venda ' || NEW.name);
        IF v_need IS NOT NULL THEN v_count := v_count + 1; END IF;
      END IF;
    END LOOP;
    IF v_count > 0 AND NEW.salesperson_id IS NOT NULL THEN
      PERFORM notify_user(NEW.salesperson_id, 'sales'::app_module, 'purchase_need',
        'Necessidades de compra geradas',
        format('Venda %s gerou %s necessidade(s) de compra.', NEW.name, v_count),
        '/sales/orders/' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_po_state_to_needs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'confirmed' THEN
      UPDATE purchase_needs SET state = 'po_created' WHERE purchase_order_id = NEW.id AND state IN ('pending','quoting','approved');
    ELSIF NEW.state = 'done' THEN
      UPDATE purchase_needs SET state = 'received' WHERE purchase_order_id = NEW.id AND state <> 'cancelled';
      FOR r IN SELECT DISTINCT pn.sale_order_id, so.salesperson_id, so.name
                 FROM purchase_needs pn
                 LEFT JOIN sale_orders so ON so.id = pn.sale_order_id
                WHERE pn.purchase_order_id = NEW.id AND pn.sale_order_id IS NOT NULL
      LOOP
        IF r.salesperson_id IS NOT NULL THEN
          PERFORM notify_user(r.salesperson_id, 'sales'::app_module, 'po_received',
            'Compra recebida',
            format('PO %s recebida — venda %s pode avançar.', NEW.name, COALESCE(r.name,'')),
            '/sales/orders/' || r.sale_order_id::text);
        END IF;
      END LOOP;
    ELSIF NEW.state = 'cancelled' THEN
      UPDATE purchase_needs SET state = 'cancelled' WHERE purchase_order_id = NEW.id AND state NOT IN ('received','cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $$;
