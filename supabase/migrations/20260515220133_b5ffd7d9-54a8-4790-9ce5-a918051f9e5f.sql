
-- Phase 4: SO terminal states (SQL-only, backward compatible)

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Backfill from updated_at as best-effort audit
UPDATE public.sale_orders SET confirmed_at = COALESCE(confirmed_at, updated_at)
  WHERE state IN ('confirmed','done') AND confirmed_at IS NULL;
UPDATE public.sale_orders SET closed_at = COALESCE(closed_at, updated_at)
  WHERE state = 'done' AND closed_at IS NULL;
UPDATE public.sale_orders SET cancelled_at = COALESCE(cancelled_at, updated_at)
  WHERE state = 'cancelled' AND cancelled_at IS NULL;

-- Recompute terminal state. Pure forward transitions only.
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

  -- Never touch terminal/early states
  IF r.state IN ('draft','sent','cancelled','done') THEN
    RETURN;
  END IF;

  is_delivered := r.fulfillment_status IN ('delivered','settled');
  -- Treat zero-value orders as paid once delivered (services etc.)
  is_paid      := r.payment_status IN ('paid','overpaid')
                  OR (COALESCE(r.amount_total,0) = 0 AND is_delivered);

  IF r.state = 'confirmed' AND is_delivered AND is_paid THEN
    UPDATE public.sale_orders
       SET state = 'done', closed_at = COALESCE(closed_at, now())
     WHERE id = _so AND state = 'confirmed';
    PERFORM public.emit_event('sale.closed', 'sale_orders', _so,
      jsonb_build_object('order_id', _so));
  END IF;
END $$;

-- Stamp confirmed/cancelled_at on state transitions
CREATE OR REPLACE FUNCTION public.tg_sale_orders_state_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'confirmed' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at := now();
    END IF;
    IF NEW.state = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
    IF NEW.state = 'done' AND NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_so_state_timestamps ON public.sale_orders;
CREATE TRIGGER trg_so_state_timestamps
BEFORE UPDATE OF state ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_sale_orders_state_timestamps();

-- Auto recompute when fulfillment or payment status changes
CREATE OR REPLACE FUNCTION public.tg_sale_orders_recompute_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
     OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.recompute_sale_state(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_so_recompute_state ON public.sale_orders;
CREATE TRIGGER trg_so_recompute_state
AFTER UPDATE OF fulfillment_status, payment_status ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_sale_orders_recompute_state();

-- Index to speed up reporting on terminal dates
CREATE INDEX IF NOT EXISTS idx_sale_orders_closed_at    ON public.sale_orders(closed_at)    WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_orders_confirmed_at ON public.sale_orders(confirmed_at) WHERE confirmed_at IS NOT NULL;

-- =====================================================================
-- Self test (SECURITY DEFINER) for E2E runner
-- =====================================================================
CREATE OR REPLACE FUNCTION public._test_phase4()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asserts jsonb := '[]'::jsonb;
  v_partner uuid;
  v_so uuid;
  v_state text;
  v_closed timestamptz;
  v_cancelled timestamptz;
BEGIN
  SELECT id INTO v_partner FROM public.partners LIMIT 1;
  IF v_partner IS NULL THEN
    RETURN jsonb_build_object('asserts', jsonb_build_array(
      jsonb_build_object('step','setup','ok',false,'observed','no partner')));
  END IF;

  -- A: confirmed + delivered + paid → done
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, fulfillment_status, payment_status)
       VALUES ('PHASE4-A-'||gen_random_uuid()::text, v_partner, 'confirmed', 100, 'pending', 'unpaid')
    RETURNING id INTO v_so;
  UPDATE public.sale_orders SET fulfillment_status='delivered' WHERE id=v_so;
  UPDATE public.sale_orders SET payment_status='paid'         WHERE id=v_so;
  SELECT state::text, closed_at INTO v_state, v_closed FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','A_close_when_delivered_and_paid',
    'ok', v_state='done' AND v_closed IS NOT NULL,
    'observed', jsonb_build_object('state',v_state,'closed_at',v_closed));

  -- B: cancelled is never promoted
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, fulfillment_status, payment_status, cancelled_at)
       VALUES ('PHASE4-B-'||gen_random_uuid()::text, v_partner, 'cancelled', 50, 'cancelled', 'paid', now())
    RETURNING id INTO v_so;
  UPDATE public.sale_orders SET fulfillment_status='delivered' WHERE id=v_so;
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','B_cancelled_stays_cancelled',
    'ok', v_state='cancelled', 'observed', jsonb_build_object('state',v_state));

  -- C: confirmed + delivered but unpaid → stays confirmed
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, fulfillment_status, payment_status)
       VALUES ('PHASE4-C-'||gen_random_uuid()::text, v_partner, 'confirmed', 80, 'pending', 'unpaid')
    RETURNING id INTO v_so;
  UPDATE public.sale_orders SET fulfillment_status='delivered' WHERE id=v_so;
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','C_delivered_but_unpaid_stays_confirmed',
    'ok', v_state='confirmed', 'observed', jsonb_build_object('state',v_state));

  -- D: zero-value order, only delivered → done
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, fulfillment_status, payment_status)
       VALUES ('PHASE4-D-'||gen_random_uuid()::text, v_partner, 'confirmed', 0, 'pending', 'unpaid')
    RETURNING id INTO v_so;
  UPDATE public.sale_orders SET fulfillment_status='delivered' WHERE id=v_so;
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','D_zero_value_closes_on_delivery',
    'ok', v_state='done', 'observed', jsonb_build_object('state',v_state));

  -- E: confirmed_at / cancelled_at stamps
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total)
       VALUES ('PHASE4-E-'||gen_random_uuid()::text, v_partner, 'draft', 10)
    RETURNING id INTO v_so;
  UPDATE public.sale_orders SET state='confirmed' WHERE id=v_so;
  UPDATE public.sale_orders SET state='cancelled' WHERE id=v_so;
  SELECT cancelled_at INTO v_cancelled FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','E_stamps_set',
    'ok', v_cancelled IS NOT NULL, 'observed', jsonb_build_object('cancelled_at',v_cancelled));

  -- F: idempotency — re-firing same status doesn't break
  INSERT INTO public.sale_orders(name, partner_id, state, amount_total, fulfillment_status, payment_status)
       VALUES ('PHASE4-F-'||gen_random_uuid()::text, v_partner, 'confirmed', 25, 'delivered', 'paid')
    RETURNING id INTO v_so;
  PERFORM public.recompute_sale_state(v_so);
  PERFORM public.recompute_sale_state(v_so);
  SELECT state::text INTO v_state FROM public.sale_orders WHERE id=v_so;
  asserts := asserts || jsonb_build_object('step','F_idempotent_recompute',
    'ok', v_state='done', 'observed', jsonb_build_object('state',v_state));

  RETURN jsonb_build_object('asserts', asserts);
END $$;
