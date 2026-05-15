
CREATE OR REPLACE FUNCTION public._test_notify_user_regression()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_partner uuid; v_user uuid; v_so uuid; v_mo uuid;
  v_method uuid; v_journal uuid; v_payment uuid; v_product uuid;
  v_pay_status text;
  r jsonb := '{}'::jsonb;
  c_evt int; c_notif int;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  SELECT id INTO v_user FROM public.profiles LIMIT 1;
  SELECT id INTO v_method FROM public.payment_methods LIMIT 1;
  SELECT id INTO v_journal FROM public.account_journals LIMIT 1;
  SELECT id INTO v_product FROM public.products LIMIT 1;

  -- 1) Sale confirm
  INSERT INTO public.sale_orders(name, partner_id, salesperson_id, state, amount_total)
  VALUES ('REGR-SO-'||substr(gen_random_uuid()::text,1,8), v_partner, v_user, 'draft', 100)
  RETURNING id INTO v_so;

  UPDATE public.sale_orders SET state='confirmed' WHERE id=v_so;

  SELECT count(*) INTO c_evt FROM public.module_events
    WHERE event_type='sale.confirmed' AND (payload->>'so_id')::uuid = v_so;
  SELECT count(*) INTO c_notif FROM public.notifications
    WHERE user_id=v_user AND type='sale_confirmed' AND link LIKE '%'||v_so::text||'%';
  r := r || jsonb_build_object('test1_so_confirm',
        jsonb_build_object('passed', c_evt>=1 AND c_notif>=1, 'events', c_evt, 'notifications', c_notif));

  -- 2) MO done
  INSERT INTO public.manufacturing_orders(code, product_id, qty, state, sale_order_id)
  VALUES ('REGR-MO-'||substr(gen_random_uuid()::text,1,8), v_product, 1, 'draft', v_so)
  RETURNING id INTO v_mo;
  UPDATE public.manufacturing_orders SET state='done' WHERE id=v_mo;

  SELECT count(*) INTO c_evt FROM public.module_events
    WHERE event_type='manufacturing.done' AND (payload->>'mo_id')::uuid = v_mo;
  SELECT count(*) INTO c_notif FROM public.notifications
    WHERE user_id=v_user AND type='mo_done';
  r := r || jsonb_build_object('test2_mo_done',
        jsonb_build_object('passed', c_evt>=1 AND c_notif>=1, 'events', c_evt, 'notifications', c_notif));

  -- 3) Payment posted
  INSERT INTO public.customer_payments(name, partner_id, order_id, amount, method_id, journal_id, state)
  VALUES ('REGR-PAY-'||substr(gen_random_uuid()::text,1,8), v_partner, v_so, 100, v_method, v_journal, 'posted')
  RETURNING id INTO v_payment;

  SELECT count(*) INTO c_evt FROM public.module_events
    WHERE event_type='finance.payment.posted' AND (payload->>'payment_id')::uuid = v_payment;
  SELECT count(*) INTO c_notif FROM public.notifications
    WHERE user_id=v_user AND type='payment_received';
  SELECT payment_status INTO v_pay_status FROM public.sale_orders WHERE id=v_so;
  r := r || jsonb_build_object('test3_payment',
        jsonb_build_object('passed', c_evt>=1 AND c_notif>=1, 'events', c_evt, 'notifications', c_notif, 'payment_status', v_pay_status));

  -- Cleanup
  DELETE FROM public.customer_payments WHERE id=v_payment;
  DELETE FROM public.manufacturing_orders WHERE id=v_mo;
  DELETE FROM public.sale_orders WHERE id=v_so;
  DELETE FROM public.notifications WHERE user_id=v_user AND created_at > now() - interval '1 minute'
    AND type IN ('sale_confirmed','mo_done','payment_received');
  DELETE FROM public.module_events WHERE created_at > now() - interval '1 minute'
    AND event_type IN ('sale.confirmed','manufacturing.done','finance.payment.posted')
    AND (payload->>'so_id' = v_so::text OR payload->>'mo_id' = v_mo::text OR payload->>'payment_id' = v_payment::text);

  RETURN r;
END $$;

GRANT EXECUTE ON FUNCTION public._test_notify_user_regression() TO authenticated, anon, service_role;
