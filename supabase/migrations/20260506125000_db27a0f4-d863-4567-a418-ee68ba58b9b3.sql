
-- 1. Extend products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS height numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depth numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_woo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS woo_product_id bigint,
  ADD COLUMN IF NOT EXISTS woo_slug text,
  ADD COLUMN IF NOT EXISTS woo_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS woo_sync_status text,
  ADD COLUMN IF NOT EXISTS woo_last_sync_at timestamptz;

-- 2. Extend variants
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS woo_variation_id bigint,
  ADD COLUMN IF NOT EXISTS woo_sync_status text;

-- 3. Tags
CREATE TABLE IF NOT EXISTS public.product_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text DEFAULT '#6366f1',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_tags_view ON public.product_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY product_tags_admin ON public.product_tags FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action))
  WITH CHECK (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action));

CREATE TABLE IF NOT EXISTS public.product_tag_rel (
  product_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  PRIMARY KEY (product_id, tag_id)
);
ALTER TABLE public.product_tag_rel ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptr_view ON public.product_tag_rel FOR SELECT TO authenticated USING (true);
CREATE POLICY ptr_admin ON public.product_tag_rel FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action))
  WITH CHECK (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action));

-- 4. Woo categories
CREATE TABLE IF NOT EXISTS public.woo_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  woo_id bigint,
  name text NOT NULL,
  parent_id uuid,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.woo_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY wc_view ON public.woo_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY wc_admin ON public.woo_categories FOR ALL TO authenticated
  USING (has_group(auth.uid(),'system_admin'))
  WITH CHECK (has_group(auth.uid(),'system_admin'));

CREATE TABLE IF NOT EXISTS public.product_woo_categories (
  product_id uuid NOT NULL,
  woo_category_id uuid NOT NULL,
  PRIMARY KEY (product_id, woo_category_id)
);
ALTER TABLE public.product_woo_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY pwc_view ON public.product_woo_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY pwc_admin ON public.product_woo_categories FOR ALL TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action))
  WITH CHECK (has_permission(auth.uid(),'products'::app_module,'products','edit'::permission_action));

-- 5. Sync log
CREATE TABLE IF NOT EXISTS public.woo_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.woo_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY wsl_admin ON public.woo_sync_log FOR ALL TO authenticated
  USING (has_group(auth.uid(),'system_admin'))
  WITH CHECK (has_group(auth.uid(),'system_admin'));
CREATE POLICY wsl_view ON public.woo_sync_log FOR SELECT TO authenticated USING (true);

-- 6. Generate variants function (cartesian product)
CREATE OR REPLACE FUNCTION public.generate_product_variants(_product uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attr record;
  combos jsonb := '[[]]'::jsonb;
  next_combos jsonb;
  combo jsonb;
  val record;
  v_id uuid;
  created int := 0;
  arr_text text;
  combo_text text[];
BEGIN
  -- Build cartesian product of attribute value ids
  FOR attr IN
    SELECT pta.id AS template_attr_id, pta.attribute_id
    FROM product_template_attributes pta
    WHERE pta.product_id = _product
  LOOP
    next_combos := '[]'::jsonb;
    FOR combo IN SELECT * FROM jsonb_array_elements(combos) LOOP
      FOR val IN
        SELECT ptav.value_id
        FROM product_template_attribute_values ptav
        WHERE ptav.template_attribute_id = attr.template_attr_id
      LOOP
        next_combos := next_combos || jsonb_build_array(combo || to_jsonb(val.value_id::text));
      END LOOP;
    END LOOP;
    combos := next_combos;
  END LOOP;

  IF jsonb_array_length(combos) = 0 OR combos = '[[]]'::jsonb THEN
    RETURN 0;
  END IF;

  FOR combo IN SELECT * FROM jsonb_array_elements(combos) LOOP
    SELECT array_agg(value::text) INTO combo_text
    FROM jsonb_array_elements_text(combo);

    -- Skip if a variant with the same value set already exists
    IF NOT EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.product_id = _product
        AND (
          SELECT array_agg(pvv.value_id::text ORDER BY pvv.value_id::text)
          FROM product_variant_values pvv
          WHERE pvv.variant_id = pv.id
        ) = (SELECT array_agg(x ORDER BY x) FROM unnest(combo_text) x)
    ) THEN
      INSERT INTO product_variants(product_id, active) VALUES (_product, true) RETURNING id INTO v_id;
      INSERT INTO product_variant_values(variant_id, value_id)
        SELECT v_id, x::uuid FROM unnest(combo_text) x;
      created := created + 1;
    END IF;
  END LOOP;

  RETURN created;
END $$;

-- 7. Stock forecast view
CREATE OR REPLACE VIEW public.product_stock_forecast AS
WITH on_hand AS (
  SELECT q.product_id, l.warehouse_id,
         SUM(q.quantity) AS on_hand,
         SUM(q.reserved_quantity) AS reserved
  FROM stock_quants q
  JOIN stock_locations l ON l.id = q.location_id
  WHERE l.type = 'internal'
  GROUP BY q.product_id, l.warehouse_id
),
incoming AS (
  SELECT pol.product_id, po.warehouse_id, SUM(pol.quantity) AS qty
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.order_id
  WHERE po.state IN ('confirmed','rfq_sent','draft')
  GROUP BY pol.product_id, po.warehouse_id
),
outgoing AS (
  SELECT sol.product_id, so.warehouse_id, SUM(sol.quantity) AS qty
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('confirmed','sent')
  GROUP BY sol.product_id, so.warehouse_id
),
sold_30 AS (
  SELECT sol.product_id, SUM(sol.quantity) AS qty
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('confirmed','done') AND so.date_order >= now() - interval '30 days'
  GROUP BY sol.product_id
),
sold_90 AS (
  SELECT sol.product_id, SUM(sol.quantity) AS qty
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('confirmed','done') AND so.date_order >= now() - interval '90 days'
  GROUP BY sol.product_id
)
SELECT
  p.id AS product_id,
  w.id AS warehouse_id,
  COALESCE(oh.on_hand,0) AS on_hand,
  COALESCE(oh.reserved,0) AS reserved,
  COALESCE(oh.on_hand,0) - COALESCE(oh.reserved,0) AS available,
  COALESCE(i.qty,0) AS incoming,
  COALESCE(o.qty,0) AS outgoing,
  COALESCE(oh.on_hand,0) - COALESCE(oh.reserved,0) + COALESCE(i.qty,0) - COALESCE(o.qty,0) AS forecasted,
  COALESCE(s30.qty,0) AS sold_30d,
  COALESCE(s90.qty,0) AS sold_90d
FROM products p
CROSS JOIN warehouses w
LEFT JOIN on_hand oh ON oh.product_id = p.id AND oh.warehouse_id = w.id
LEFT JOIN incoming i ON i.product_id = p.id AND i.warehouse_id = w.id
LEFT JOIN outgoing o ON o.product_id = p.id AND o.warehouse_id = w.id
LEFT JOIN sold_30 s30 ON s30.product_id = p.id
LEFT JOIN sold_90 s90 ON s90.product_id = p.id;

-- 8. Update confirm_sale_order to explode phantom BOMs
CREATE OR REPLACE FUNCTION public.confirm_sale_order(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; l record; wh uuid; src uuid; dst uuid;
  v_picking_id uuid; picking_name text;
  shortage numeric; available numeric; pref_supplier uuid;
  po_id uuid; po_name text; expected date;
  phantom_bom uuid;
  comp record;
  effective_product uuid;
  effective_qty numeric;
begin
  select * into o from public.sale_orders where id = _order;
  if not found then raise exception 'Order not found'; end if;
  if o.state <> 'draft' and o.state <> 'sent' then raise exception 'Order must be draft/sent'; end if;

  wh := coalesce(o.warehouse_id, public.default_warehouse_id());
  src := public.default_location(wh,'Stock');
  dst := public.customer_location_id();

  picking_name := public.next_sequence('picking_out');
  insert into public.stock_pickings(name, kind, state, warehouse_id, source_location_id, destination_location_id, partner_id, origin, created_by)
  values(picking_name,'outgoing'::picking_kind,'draft'::picking_state,wh,src,dst,o.partner_id,o.name,auth.uid())
  returning id into v_picking_id;

  for l in select * from public.sale_order_lines where order_id = _order loop
    -- Detect phantom BOM (kit)
    select id into phantom_bom from public.boms
      where product_id = l.product_id and type='phantom' and active limit 1;
    if phantom_bom is not null then
      for comp in select * from public.bom_lines where bom_id = phantom_bom loop
        insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
        values (v_picking_id, comp.component_product_id, comp.component_variant_id, comp.uom_id, src, dst,
                comp.quantity * l.quantity, 'draft'::picking_state, o.name);
      end loop;
    else
      insert into public.stock_moves(picking_id, product_id, variant_id, uom_id, source_location_id, destination_location_id, quantity, state, reference)
      values (v_picking_id, l.product_id, l.variant_id, l.uom_id, src, dst, l.quantity, 'draft'::picking_state, o.name);
    end if;
  end loop;

  update public.stock_pickings set state='waiting'::picking_state where id = v_picking_id;

  -- Reserve & shortage handling per move
  for l in select sm.* from public.stock_moves sm where sm.picking_id = v_picking_id loop
    declare reserved numeric;
    begin
      reserved := public.reserve_for_move(l.id);
      if reserved < l.quantity then
        shortage := l.quantity - reserved;
        if public.is_module_installed('purchase') then
          select partner_id into pref_supplier from public.product_suppliers where product_id = l.product_id order by priority limit 1;
          if pref_supplier is not null then
            select id into po_id from public.purchase_orders
              where partner_id = pref_supplier and state='draft' and warehouse_id = wh
              order by created_at desc limit 1;
            if po_id is null then
              po_name := public.next_sequence('purchase_order');
              expected := current_date + coalesce((select min(lead_time_days) from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier),7);
              insert into public.purchase_orders(name, partner_id, state, warehouse_id, origin, created_by, expected_date)
                values(po_name, pref_supplier,'draft', wh, o.name, auth.uid(), expected) returning id into po_id;
            end if;
            insert into public.purchase_order_lines(order_id, product_id, variant_id, uom_id, quantity, unit_price, subtotal)
              select po_id, l.product_id, l.variant_id, l.uom_id, shortage,
                     coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0),
                     shortage * coalesce((select price from public.product_suppliers where product_id=l.product_id and partner_id=pref_supplier order by priority limit 1),0);
          end if;
        end if;
      end if;
    end;
  end loop;

  update public.sale_orders set state='confirmed' where id = _order;
  perform public.log_record_event('sale_order', _order, format('Pedido confirmado, transferência %s criada', picking_name), '{}'::jsonb);
  if o.salesperson_id is not null then
    perform public.notify_user(o.salesperson_id,'sales','sale_confirmed','Pedido confirmado',
      format('%s para %s', o.name, (select name from public.partners where id=o.partner_id)), '/sales/orders');
  end if;
end $function$;
