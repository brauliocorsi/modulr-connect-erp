
-- ============================================================
-- Multi-step delivery/reception + Batch & Wave picking
-- ============================================================

-- 1. Warehouse step config -----------------------------------
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS delivery_steps text NOT NULL DEFAULT 'one_step',
  ADD COLUMN IF NOT EXISTS reception_steps text NOT NULL DEFAULT 'one_step';

DO $$ BEGIN
  ALTER TABLE public.warehouses
    ADD CONSTRAINT warehouses_delivery_steps_chk
    CHECK (delivery_steps IN ('one_step','two_steps','three_steps'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.warehouses
    ADD CONSTRAINT warehouses_reception_steps_chk
    CHECK (reception_steps IN ('one_step','two_steps','three_steps'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Picking chain + grouping columns ------------------------
ALTER TABLE public.stock_pickings
  ADD COLUMN IF NOT EXISTS previous_picking_id uuid REFERENCES public.stock_pickings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS step_label text;

ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS wave_id uuid;

CREATE INDEX IF NOT EXISTS idx_stock_pickings_previous ON public.stock_pickings(previous_picking_id);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_batch ON public.stock_pickings(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_wave ON public.stock_moves(wave_id);

-- 3. Batches & Waves -----------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_picking_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_progress','done','cancelled')),
  user_id uuid,
  scheduled_at timestamptz DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_picking_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','in_progress','done','cancelled')),
  user_id uuid,
  scheduled_at timestamptz DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.stock_pickings
    ADD CONSTRAINT stock_pickings_batch_fk FOREIGN KEY (batch_id)
    REFERENCES public.stock_picking_batches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.stock_moves
    ADD CONSTRAINT stock_moves_wave_fk FOREIGN KEY (wave_id)
    REFERENCES public.stock_picking_waves(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.stock_picking_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_picking_waves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batches_view" ON public.stock_picking_batches FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','view'::permission_action));
CREATE POLICY "batches_insert" ON public.stock_picking_batches FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'inventory'::app_module,'transfers','create'::permission_action));
CREATE POLICY "batches_update" ON public.stock_picking_batches FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','edit'::permission_action));
CREATE POLICY "batches_delete" ON public.stock_picking_batches FOR DELETE TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','delete'::permission_action));

CREATE POLICY "waves_view" ON public.stock_picking_waves FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','view'::permission_action));
CREATE POLICY "waves_insert" ON public.stock_picking_waves FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'inventory'::app_module,'transfers','create'::permission_action));
CREATE POLICY "waves_update" ON public.stock_picking_waves FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','edit'::permission_action));
CREATE POLICY "waves_delete" ON public.stock_picking_waves FOR DELETE TO authenticated
  USING (has_permission(auth.uid(),'inventory'::app_module,'transfers','delete'::permission_action));

-- 4. Sequences for new docs ----------------------------------
INSERT INTO public.number_sequences (code, prefix, padding, next_number)
VALUES ('picking_batch','BATCH/',5,1), ('picking_wave','WAVE/',5,1)
ON CONFLICT (code) DO NOTHING;

-- 5. Helper: ensure step location exists ---------------------
CREATE OR REPLACE FUNCTION public.ensure_step_location(_warehouse uuid, _name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_wh_name text;
BEGIN
  SELECT id INTO v_id FROM stock_locations
   WHERE warehouse_id = _warehouse AND name = _name LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT name INTO v_wh_name FROM warehouses WHERE id = _warehouse;
  INSERT INTO stock_locations(warehouse_id, name, full_path, type, is_zone)
    VALUES (_warehouse, _name, coalesce(v_wh_name,'WH')||'/'||_name, 'internal'::location_type, true)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 6. Auto-create step locations for existing warehouses ------
DO $$ DECLARE w record; BEGIN
  FOR w IN SELECT id FROM warehouses LOOP
    PERFORM ensure_step_location(w.id,'Cais de Carga');
    PERFORM ensure_step_location(w.id,'Zona Carrinha');
  END LOOP;
END $$;

-- and on insert
CREATE OR REPLACE FUNCTION public.tg_warehouse_create_steps()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM ensure_step_location(NEW.id,'Cais de Carga');
  PERFORM ensure_step_location(NEW.id,'Zona Carrinha');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS warehouse_create_steps ON public.warehouses;
CREATE TRIGGER warehouse_create_steps AFTER INSERT ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.tg_warehouse_create_steps();

-- 7. Build outgoing chain for a sale order -------------------
CREATE OR REPLACE FUNCTION public.create_outgoing_chain(_order uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record; wh uuid; mode text;
  loc_stock uuid; loc_dock uuid; loc_van uuid; loc_cust uuid;
  prev_pick uuid; first_pick uuid; pick_id uuid;
  l record; phantom_bom uuid; comp record;
  src uuid; dst uuid; nm text; lbl text;
BEGIN
  SELECT * INTO o FROM sale_orders WHERE id=_order;
  wh := coalesce(o.warehouse_id, default_warehouse_id());
  SELECT delivery_steps INTO mode FROM warehouses WHERE id = wh;
  mode := coalesce(mode,'one_step');
  loc_stock := default_location(wh,'Stock');
  loc_cust := customer_location_id();
  loc_dock := ensure_step_location(wh,'Cais de Carga');
  loc_van := ensure_step_location(wh,'Zona Carrinha');

  -- Build steps array dynamically
  FOR i IN 1..(CASE mode WHEN 'one_step' THEN 1 WHEN 'two_steps' THEN 2 ELSE 3 END) LOOP
    IF mode='one_step' THEN
      src := loc_stock; dst := loc_cust; lbl := 'Saída';
    ELSIF mode='two_steps' THEN
      IF i=1 THEN src:=loc_stock; dst:=loc_dock; lbl:='Pick (Stock → Cais)';
      ELSE src:=loc_dock; dst:=loc_cust; lbl:='Ship (Cais → Cliente)'; END IF;
    ELSE
      IF i=1 THEN src:=loc_stock; dst:=loc_dock; lbl:='Pick (Stock → Cais)';
      ELSIF i=2 THEN src:=loc_dock; dst:=loc_van; lbl:='Pack (Cais → Carrinha)';
      ELSE src:=loc_van; dst:=loc_cust; lbl:='Ship (Carrinha → Cliente)'; END IF;
    END IF;
    nm := next_sequence('picking_out');
    INSERT INTO stock_pickings(name, kind, state, warehouse_id, source_location_id,
        destination_location_id, partner_id, origin, created_by, previous_picking_id, step_label)
      VALUES (nm,'outgoing'::picking_kind,'draft'::picking_state, wh, src, dst, o.partner_id,
              o.name, auth.uid(), prev_pick, lbl)
      RETURNING id INTO pick_id;
    IF first_pick IS NULL THEN first_pick := pick_id; END IF;

    -- Insert moves for this step
    FOR l IN SELECT * FROM sale_order_lines WHERE order_id=_order AND line_kind='product' LOOP
      SELECT id INTO phantom_bom FROM boms WHERE product_id=l.product_id AND type='phantom' AND active LIMIT 1;
      IF phantom_bom IS NOT NULL THEN
        FOR comp IN SELECT * FROM bom_lines WHERE bom_id=phantom_bom LOOP
          INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
                  source_location_id, destination_location_id, quantity, state, reference)
            VALUES(pick_id, comp.component_product_id, comp.component_variant_id, comp.uom_id,
                   src, dst, comp.quantity * l.quantity, 'draft'::picking_state, o.name);
        END LOOP;
      ELSE
        INSERT INTO stock_moves(picking_id, product_id, variant_id, uom_id,
                source_location_id, destination_location_id, quantity, state, reference)
          VALUES(pick_id, l.product_id, l.variant_id, l.uom_id, src, dst,
                 l.quantity, 'draft'::picking_state, o.name);
      END IF;
    END LOOP;
    UPDATE stock_pickings SET state='waiting'::picking_state WHERE id=pick_id;
    prev_pick := pick_id;
  END LOOP;

  RETURN first_pick;
END $$;

-- 8. RPCs: batches & waves -----------------------------------
CREATE OR REPLACE FUNCTION public.create_batch(_pickings uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; nm text;
BEGIN
  IF _pickings IS NULL OR array_length(_pickings,1) IS NULL THEN
    RAISE EXCEPTION 'No pickings selected'; END IF;
  nm := next_sequence('picking_batch');
  INSERT INTO stock_picking_batches(name, created_by, user_id)
    VALUES(nm, auth.uid(), auth.uid()) RETURNING id INTO v_id;
  UPDATE stock_pickings SET batch_id = v_id WHERE id = ANY(_pickings) AND batch_id IS NULL;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.validate_batch(_batch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id FROM stock_pickings WHERE batch_id=_batch
           AND state NOT IN ('done','cancelled') LOOP
    PERFORM validate_picking(p.id);
  END LOOP;
  UPDATE stock_picking_batches SET state='done', updated_at=now() WHERE id=_batch;
END $$;

CREATE OR REPLACE FUNCTION public.create_wave(_moves uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; nm text;
BEGIN
  IF _moves IS NULL OR array_length(_moves,1) IS NULL THEN
    RAISE EXCEPTION 'No moves selected'; END IF;
  nm := next_sequence('picking_wave');
  INSERT INTO stock_picking_waves(name, created_by, user_id)
    VALUES(nm, auth.uid(), auth.uid()) RETURNING id INTO v_id;
  UPDATE stock_moves SET wave_id = v_id WHERE id = ANY(_moves) AND wave_id IS NULL;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.validate_wave(_wave uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; pickings uuid[];
BEGIN
  SELECT array_agg(DISTINCT picking_id) INTO pickings
    FROM stock_moves WHERE wave_id=_wave;
  UPDATE stock_moves SET quantity_done = quantity, state='done'::picking_state
   WHERE wave_id=_wave AND state NOT IN ('done','cancelled');
  -- Recalc each picking
  IF pickings IS NOT NULL THEN
    FOR i IN 1..array_length(pickings,1) LOOP
      PERFORM recalc_picking_state(pickings[i]);
    END LOOP;
  END IF;
  UPDATE stock_picking_waves SET state='done', updated_at=now() WHERE id=_wave;
END $$;
