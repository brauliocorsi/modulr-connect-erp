
-- 1) Notifications: novas colunas (compatíveis com leitura existente)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_entity ON public.notifications(entity_type, entity_id);

-- 2) emit_event: grava no log canónico de eventos
CREATE OR REPLACE FUNCTION public.emit_event(
  _source_module app_module,
  _event_type text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.module_events(source_module, event_type, payload, processed)
  VALUES (
    _source_module,
    _event_type,
    COALESCE(_payload,'{}'::jsonb)
      || jsonb_build_object(
           'entity_type', _entity_type,
           'entity_id',   _entity_id,
           'emitted_at',  now()
         ),
    false
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 3) notify_group: envia notificação a todos os membros do grupo (silencioso se vazio)
CREATE OR REPLACE FUNCTION public.notify_group(
  _group text,
  _module app_module,
  _type text,
  _title text,
  _body text DEFAULT NULL,
  _link text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _priority text DEFAULT 'normal',
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.notifications(user_id, module, type, title, body, link, payload,
                                   priority, entity_type, entity_id)
  SELECT ug.user_id, _module, _type, _title, _body, _link, COALESCE(_payload,'{}'::jsonb),
         COALESCE(_priority,'normal'), _entity_type, _entity_id
    FROM public.user_groups ug
    JOIN auth.users u ON u.id = ug.user_id
   WHERE ug.group_name = _group;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- =====================================================================
-- 4) TRIGGERS — somente AFTER, não-bloqueantes
-- =====================================================================

-- 4a) Sale order: state changed to 'confirmed'
CREATE OR REPLACE FUNCTION public.tg_so_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state='confirmed' THEN
      PERFORM public.emit_event('sales','sale.confirmed',
        jsonb_build_object('so_id',NEW.id,'name',NEW.name,'partner_id',NEW.partner_id,'amount_total',NEW.amount_total),
        'sale_order', NEW.id);
      IF NEW.salesperson_id IS NOT NULL THEN
        PERFORM public.notify_user(NEW.salesperson_id,
          'Venda confirmada: '||COALESCE(NEW.name,''),
          'Total: '||COALESCE(NEW.amount_total,0)::text,
          'sales'::app_module, '/sales/orders/'||NEW.id::text);
      END IF;
    ELSIF NEW.state='cancelled' THEN
      PERFORM public.emit_event('sales','sale.cancelled',
        jsonb_build_object('so_id',NEW.id,'name',NEW.name),'sale_order', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_so_emit_events ON public.sale_orders;
CREATE TRIGGER tg_so_emit_events AFTER UPDATE ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_so_emit_events();

-- 4b) Manufacturing order: ready / done / cancelled
CREATE OR REPLACE FUNCTION public.tg_mo_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_so uuid; v_sp uuid; v_so_name text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    -- find originating SO if any
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
        PERFORM public.notify_user(v_sp,
          'Produção concluída: '||COALESCE(NEW.code,''),
          'Venda '||COALESCE(v_so_name,'')||' pronta para entrega',
          'sales'::app_module, '/sales/orders/'||v_so::text);
      END IF;

    ELSIF NEW.state='cancelled' THEN
      PERFORM public.emit_event('manufacturing','manufacturing.cancelled',
        jsonb_build_object('mo_id',NEW.id,'code',NEW.code),'manufacturing_order',NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_mo_emit_events ON public.manufacturing_orders;
CREATE TRIGGER tg_mo_emit_events AFTER UPDATE ON public.manufacturing_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_mo_emit_events();

-- 4c) Picking done
CREATE OR REPLACE FUNCTION public.tg_picking_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.state IS DISTINCT FROM OLD.state AND NEW.state='done' THEN
    PERFORM public.emit_event('inventory','inventory.picking.done',
      jsonb_build_object('picking_id',NEW.id,'name',NEW.name,'kind',NEW.kind,'partner_id',NEW.partner_id,'origin',NEW.origin),
      'stock_picking', NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_picking_emit_events ON public.stock_pickings;
CREATE TRIGGER tg_picking_emit_events AFTER UPDATE ON public.stock_pickings
  FOR EACH ROW EXECUTE FUNCTION public.tg_picking_emit_events();

-- 4d) Customer payment posted
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
        PERFORM public.notify_user(v_sp,
          'Pagamento recebido: '||NEW.amount::text,
          'Venda '||COALESCE(NEW.reference,NEW.name),
          'finance'::app_module, '/sales/orders/'||NEW.order_id::text);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_payment_emit_events ON public.customer_payments;
CREATE TRIGGER tg_payment_emit_events AFTER INSERT OR UPDATE OF state, amount ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_emit_events();
