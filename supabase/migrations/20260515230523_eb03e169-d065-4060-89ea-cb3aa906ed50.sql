
-- Fix notify_user argument order in event triggers
-- Correct signature: notify_user(_user uuid, _module app_module, _type text, _title text, _body text, _link text)

CREATE OR REPLACE FUNCTION public.tg_so_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state='confirmed' THEN
      PERFORM public.emit_event('sales','sale.confirmed',
        jsonb_build_object('so_id',NEW.id,'name',NEW.name,'partner_id',NEW.partner_id,'amount_total',NEW.amount_total),
        'sale_order', NEW.id);
      IF NEW.salesperson_id IS NOT NULL THEN
        PERFORM public.notify_user(
          NEW.salesperson_id,
          'sales'::app_module,
          'sale_confirmed',
          'Venda confirmada: '||COALESCE(NEW.name,''),
          'Total: '||COALESCE(NEW.amount_total,0)::text,
          '/sales/orders/'||NEW.id::text);
      END IF;
    ELSIF NEW.state='cancelled' THEN
      PERFORM public.emit_event('sales','sale.cancelled',
        jsonb_build_object('so_id',NEW.id,'name',NEW.name),'sale_order', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_mo_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_so uuid; v_sp uuid; v_so_name text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    SELECT id, salesperson_id, name INTO v_so, v_sp, v_so_name
      FROM public.sale_orders
     WHERE id = NEW.sale_order_id;

    IF NEW.state='ready' THEN
      PERFORM public.emit_event('manufacturing','manufacturing.ready',
        jsonb_build_object('mo_id',NEW.id,'code',NEW.code,'product_id',NEW.product_id,'qty',NEW.qty),
        'manufacturing_order', NEW.id);
      PERFORM public.notify_group('manufacturing_user'::text,'manufacturing'::app_module,
        'mo.ready', 'MO pronta: '||COALESCE(NEW.code,''),
        'Componentes reservados — pronta para iniciar', '/manufacturing/orders/'||NEW.id::text,
        jsonb_build_object('mo_id',NEW.id), 'normal','manufacturing_order',NEW.id);

    ELSIF NEW.state='done' THEN
      PERFORM public.emit_event('manufacturing','manufacturing.done',
        jsonb_build_object('mo_id',NEW.id,'code',NEW.code,'product_id',NEW.product_id,'qty',NEW.qty,'sale_order_id',v_so),
        'manufacturing_order', NEW.id);
      IF v_sp IS NOT NULL THEN
        PERFORM public.notify_user(
          v_sp,
          'sales'::app_module,
          'mo_done',
          'Produção concluída: '||COALESCE(NEW.code,''),
          'Venda '||COALESCE(v_so_name,'')||' pronta para entrega',
          '/sales/orders/'||v_so::text);
      END IF;

    ELSIF NEW.state='cancelled' THEN
      PERFORM public.emit_event('manufacturing','manufacturing.cancelled',
        jsonb_build_object('mo_id',NEW.id,'code',NEW.code),'manufacturing_order',NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_payment_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sp uuid;
BEGIN
  IF NEW.state='posted' AND COALESCE(NEW.amount,0) > 0
     AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    PERFORM public.emit_event('finance','finance.payment.posted',
      jsonb_build_object('payment_id',NEW.id,'order_id',NEW.order_id,'amount',NEW.amount,
                         'partner_id',NEW.partner_id,'method_id',NEW.method_id),
      'customer_payment', NEW.id);
    IF NEW.order_id IS NOT NULL THEN
      SELECT salesperson_id INTO v_sp FROM public.sale_orders WHERE id = NEW.order_id;
      IF v_sp IS NOT NULL THEN
        PERFORM public.notify_user(
          v_sp,
          'finance'::app_module,
          'payment_received',
          'Pagamento recebido: '||NEW.amount::text,
          'Venda '||COALESCE(NEW.reference,NEW.name),
          '/sales/orders/'||NEW.order_id::text);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
