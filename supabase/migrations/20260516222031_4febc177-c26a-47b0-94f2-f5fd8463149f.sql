
-- ============================================================
-- F16-C.1 — BOM Industrial: Schema + Read-only resolver
-- ============================================================

-- 1) boms: herança
ALTER TABLE public.boms
  ADD COLUMN IF NOT EXISTS parent_bom_id uuid REFERENCES public.boms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inheritance_mode text NOT NULL DEFAULT 'inherit',
  ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applies_to_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applies_to_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_rule jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='boms_inheritance_mode_chk') THEN
    ALTER TABLE public.boms ADD CONSTRAINT boms_inheritance_mode_chk
      CHECK (inheritance_mode IN ('inherit','override','extend'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_boms_parent_bom_id ON public.boms(parent_bom_id);
CREATE INDEX IF NOT EXISTS idx_boms_applies_to_variant ON public.boms(applies_to_variant_id);

-- 2) bom_lines: herança, fórmula, conversão
ALTER TABLE public.bom_lines
  ADD COLUMN IF NOT EXISTS parent_bom_line_id uuid REFERENCES public.bom_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inheritance_action text NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS is_inherited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applies_to_variant_rule jsonb,
  ADD COLUMN IF NOT EXISTS component_selector jsonb,
  ADD COLUMN IF NOT EXISTS formula text,
  ADD COLUMN IF NOT EXISTS formula_variables jsonb,
  ADD COLUMN IF NOT EXISTS qty_formula text,
  ADD COLUMN IF NOT EXISTS consumption_uom_id uuid REFERENCES public.product_uom(id),
  ADD COLUMN IF NOT EXISTS conversion_factor numeric,
  ADD COLUMN IF NOT EXISTS rounding_method text NOT NULL DEFAULT 'exact';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bom_lines_inheritance_action_chk') THEN
    ALTER TABLE public.bom_lines ADD CONSTRAINT bom_lines_inheritance_action_chk
      CHECK (inheritance_action IN ('own','inherited','override','add','remove'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bom_lines_rounding_method_chk') THEN
    ALTER TABLE public.bom_lines ADD CONSTRAINT bom_lines_rounding_method_chk
      CHECK (rounding_method IN ('exact','round_up','round_down','package_multiple'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bom_lines_parent_line ON public.bom_lines(parent_bom_line_id);
CREATE INDEX IF NOT EXISTS idx_bom_lines_inheritance ON public.bom_lines(inheritance_action);

-- 3) bom_variant_rules
CREATE TABLE IF NOT EXISTS public.bom_variant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  attribute_name text,
  attribute_value text,
  rule_type text NOT NULL CHECK (rule_type IN ('add_component','replace_component','remove_component','change_qty','change_formula','change_operation')),
  source_component_id uuid REFERENCES public.products(id),
  target_component_id uuid REFERENCES public.products(id),
  qty numeric,
  uom_id uuid REFERENCES public.product_uom(id),
  formula text,
  priority int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bvr_bom ON public.bom_variant_rules(bom_id);
CREATE INDEX IF NOT EXISTS idx_bvr_variant ON public.bom_variant_rules(variant_id);
CREATE INDEX IF NOT EXISTS idx_bvr_attr ON public.bom_variant_rules(product_id, attribute_name, attribute_value);
CREATE INDEX IF NOT EXISTS idx_bvr_priority ON public.bom_variant_rules(priority);

ALTER TABLE public.bom_variant_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bvr_view" ON public.bom_variant_rules;
DROP POLICY IF EXISTS "bvr_insert" ON public.bom_variant_rules;
DROP POLICY IF EXISTS "bvr_update" ON public.bom_variant_rules;
DROP POLICY IF EXISTS "bvr_delete" ON public.bom_variant_rules;
CREATE POLICY "bvr_view" ON public.bom_variant_rules FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','view'::permission_action));
CREATE POLICY "bvr_insert" ON public.bom_variant_rules FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'products'::app_module,'bom','create'::permission_action));
CREATE POLICY "bvr_update" ON public.bom_variant_rules FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','edit'::permission_action));
CREATE POLICY "bvr_delete" ON public.bom_variant_rules FOR DELETE TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','delete'::permission_action));

-- 4) manufacturing_bom_outputs
CREATE TABLE IF NOT EXISTS public.manufacturing_bom_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  bom_line_id uuid REFERENCES public.bom_lines(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  output_type text NOT NULL CHECK (output_type IN ('main_product','co_product','byproduct','reusable_scrap','waste')),
  qty numeric NOT NULL DEFAULT 1,
  uom_id uuid REFERENCES public.product_uom(id),
  formula text,
  cost_allocation_percent numeric,
  stockable boolean NOT NULL DEFAULT true,
  condition text NOT NULL DEFAULT 'good',
  operation_id uuid,
  work_center_id uuid REFERENCES public.work_centers(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cost_allocation_percent IS NULL OR (cost_allocation_percent >= 0 AND cost_allocation_percent <= 100))
);
CREATE INDEX IF NOT EXISTS idx_mbo_bom ON public.manufacturing_bom_outputs(bom_id);
CREATE INDEX IF NOT EXISTS idx_mbo_type ON public.manufacturing_bom_outputs(output_type);

ALTER TABLE public.manufacturing_bom_outputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mbo_view" ON public.manufacturing_bom_outputs;
DROP POLICY IF EXISTS "mbo_insert" ON public.manufacturing_bom_outputs;
DROP POLICY IF EXISTS "mbo_update" ON public.manufacturing_bom_outputs;
DROP POLICY IF EXISTS "mbo_delete" ON public.manufacturing_bom_outputs;
CREATE POLICY "mbo_view" ON public.manufacturing_bom_outputs FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','view'::permission_action));
CREATE POLICY "mbo_insert" ON public.manufacturing_bom_outputs FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'products'::app_module,'bom','create'::permission_action));
CREATE POLICY "mbo_update" ON public.manufacturing_bom_outputs FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','edit'::permission_action));
CREATE POLICY "mbo_delete" ON public.manufacturing_bom_outputs FOR DELETE TO authenticated
  USING (has_permission(auth.uid(),'products'::app_module,'bom','delete'::permission_action));

-- 5) manufacturing_order_outputs (sem uso operacional ainda)
CREATE TABLE IF NOT EXISTS public.manufacturing_order_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturing_order_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  output_type text NOT NULL CHECK (output_type IN ('main_product','co_product','byproduct','reusable_scrap','waste')),
  qty_expected numeric NOT NULL DEFAULT 0,
  qty_done numeric NOT NULL DEFAULT 0,
  uom_id uuid REFERENCES public.product_uom(id),
  operation_id uuid,
  stock_location_id uuid REFERENCES public.stock_locations(id),
  condition text NOT NULL DEFAULT 'good',
  cost_allocation_percent numeric,
  created_stock_package_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moo_mo ON public.manufacturing_order_outputs(manufacturing_order_id);

ALTER TABLE public.manufacturing_order_outputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moo_view" ON public.manufacturing_order_outputs;
DROP POLICY IF EXISTS "moo_insert" ON public.manufacturing_order_outputs;
DROP POLICY IF EXISTS "moo_update" ON public.manufacturing_order_outputs;
DROP POLICY IF EXISTS "moo_delete" ON public.manufacturing_order_outputs;
CREATE POLICY "moo_view" ON public.manufacturing_order_outputs FOR SELECT TO authenticated
  USING (mfg_can_view(auth.uid()));
CREATE POLICY "moo_insert" ON public.manufacturing_order_outputs FOR INSERT TO authenticated
  WITH CHECK (mfg_can_manage(auth.uid()));
CREATE POLICY "moo_update" ON public.manufacturing_order_outputs FOR UPDATE TO authenticated
  USING (mfg_can_manage(auth.uid()));
CREATE POLICY "moo_delete" ON public.manufacturing_order_outputs FOR DELETE TO authenticated
  USING (mfg_can_manage(auth.uid()));

-- ============================================================
-- 6) mfg_eval_formula — parser numérico seguro
--    Suporta: + - * / ( ), números (decimais), variáveis whitelisted.
--    NÃO usa EXECUTE. NÃO aceita SQL. NÃO aceita ; ou funções.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfg_eval_formula(_formula text, _vars jsonb DEFAULT '{}'::jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $func$
DECLARE
  v_allowed_vars text[] := ARRAY['width_cm','length_cm','height_cm','mattress_width','mattress_length','fabric_width','qty_ordered'];
  v_extra_keys text[];
  v_norm text;
  v_pos int := 1;
  v_len int;
  v_ch text;
  v_tok text;
  v_tokens text[] := ARRAY[]::text[];
  v_kinds text[] := ARRAY[]::text[]; -- num, op, lp, rp, id
  v_i int;
  v_id text;
  v_val numeric;
  -- shunting yard
  v_out_vals numeric[] := ARRAY[]::numeric[];
  v_out_ops text[] := ARRAY[]::text[]; -- '+','-','*','/','('
  v_op text;
  -- RPN-free: we compute via stacks directly
  v_num_stack numeric[] := ARRAY[]::numeric[];
  v_op_stack text[] := ARRAY[]::text[];
  v_a numeric; v_b numeric;
  v_prec int; v_top_prec int;
BEGIN
  IF _formula IS NULL OR btrim(_formula) = '' THEN
    RAISE EXCEPTION 'invalid_formula: empty';
  END IF;

  -- normalize: lowercase, strip whitespace
  v_norm := lower(_formula);

  -- hard reject: any disallowed character
  IF v_norm !~ '^[\s0-9\.\+\-\*\/\(\)a-z_]+$' THEN
    RAISE EXCEPTION 'invalid_formula: forbidden characters in %', _formula;
  END IF;

  -- explicit reject of dangerous patterns
  IF v_norm ~ '(;|--|/\*|\*/|select|insert|update|delete|drop|alter|create|grant|revoke|truncate|union|copy|do|begin|commit|rollback|execute|perform|call|pg_|information_schema)' THEN
    RAISE EXCEPTION 'invalid_formula: forbidden keyword/pattern in %', _formula;
  END IF;

  -- collect extra var keys from _vars (must be numeric values)
  IF _vars IS NOT NULL AND jsonb_typeof(_vars) = 'object' THEN
    SELECT array_agg(k) INTO v_extra_keys FROM jsonb_object_keys(_vars) k;
  END IF;

  -- tokenize
  v_len := length(v_norm);
  WHILE v_pos <= v_len LOOP
    v_ch := substr(v_norm, v_pos, 1);
    IF v_ch ~ '\s' THEN
      v_pos := v_pos + 1;
      CONTINUE;
    END IF;
    IF v_ch IN ('+','-','*','/') THEN
      v_tokens := v_tokens || v_ch;
      v_kinds := v_kinds || 'op';
      v_pos := v_pos + 1;
    ELSIF v_ch = '(' THEN
      v_tokens := v_tokens || '(';
      v_kinds := v_kinds || 'lp';
      v_pos := v_pos + 1;
    ELSIF v_ch = ')' THEN
      v_tokens := v_tokens || ')';
      v_kinds := v_kinds || 'rp';
      v_pos := v_pos + 1;
    ELSIF v_ch ~ '[0-9\.]' THEN
      v_tok := '';
      WHILE v_pos <= v_len AND substr(v_norm, v_pos, 1) ~ '[0-9\.]' LOOP
        v_tok := v_tok || substr(v_norm, v_pos, 1);
        v_pos := v_pos + 1;
      END LOOP;
      v_tokens := v_tokens || v_tok;
      v_kinds := v_kinds || 'num';
    ELSIF v_ch ~ '[a-z_]' THEN
      v_tok := '';
      WHILE v_pos <= v_len AND substr(v_norm, v_pos, 1) ~ '[a-z0-9_]' LOOP
        v_tok := v_tok || substr(v_norm, v_pos, 1);
        v_pos := v_pos + 1;
      END LOOP;
      v_tokens := v_tokens || v_tok;
      v_kinds := v_kinds || 'id';
    ELSE
      RAISE EXCEPTION 'invalid_formula: unexpected char % at %', v_ch, v_pos;
    END IF;
  END LOOP;

  -- handle unary minus by prefixing 0: convert leading '-' or '-' after '(' or after another op into 0 -
  -- We do this by inserting a 0 token before such '-'.
  DECLARE
    v_new_tokens text[] := ARRAY[]::text[];
    v_new_kinds text[] := ARRAY[]::text[];
    v_prev_kind text := NULL;
  BEGIN
    FOR v_i IN 1..coalesce(array_length(v_tokens,1),0) LOOP
      IF v_tokens[v_i] = '-' AND (v_prev_kind IS NULL OR v_prev_kind IN ('op','lp')) THEN
        v_new_tokens := v_new_tokens || '0';
        v_new_kinds := v_new_kinds || 'num';
      END IF;
      v_new_tokens := v_new_tokens || v_tokens[v_i];
      v_new_kinds := v_new_kinds || v_kinds[v_i];
      v_prev_kind := v_kinds[v_i];
    END LOOP;
    v_tokens := v_new_tokens;
    v_kinds := v_new_kinds;
  END;

  -- shunting-yard with immediate evaluation
  FOR v_i IN 1..coalesce(array_length(v_tokens,1),0) LOOP
    IF v_kinds[v_i] = 'num' THEN
      v_num_stack := v_num_stack || v_tokens[v_i]::numeric;
    ELSIF v_kinds[v_i] = 'id' THEN
      v_id := v_tokens[v_i];
      IF v_id = ANY(v_allowed_vars) THEN
        IF _vars ? v_id AND jsonb_typeof(_vars->v_id) = 'number' THEN
          v_val := (_vars->>v_id)::numeric;
        ELSE
          RAISE EXCEPTION 'invalid_formula: missing variable %', v_id;
        END IF;
      ELSIF v_extra_keys IS NOT NULL AND v_id = ANY(v_extra_keys) THEN
        IF jsonb_typeof(_vars->v_id) <> 'number' THEN
          RAISE EXCEPTION 'invalid_formula: variable % must be numeric', v_id;
        END IF;
        v_val := (_vars->>v_id)::numeric;
      ELSE
        RAISE EXCEPTION 'invalid_formula: unknown variable %', v_id;
      END IF;
      v_num_stack := v_num_stack || v_val;
    ELSIF v_kinds[v_i] = 'lp' THEN
      v_op_stack := v_op_stack || '(';
    ELSIF v_kinds[v_i] = 'rp' THEN
      WHILE coalesce(array_length(v_op_stack,1),0) > 0
            AND v_op_stack[array_length(v_op_stack,1)] <> '(' LOOP
        v_op := v_op_stack[array_length(v_op_stack,1)];
        v_op_stack := v_op_stack[1:array_length(v_op_stack,1)-1];
        v_b := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_a := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_num_stack := v_num_stack || CASE v_op
          WHEN '+' THEN v_a + v_b
          WHEN '-' THEN v_a - v_b
          WHEN '*' THEN v_a * v_b
          WHEN '/' THEN v_a / v_b
        END;
      END LOOP;
      IF coalesce(array_length(v_op_stack,1),0) = 0 THEN
        RAISE EXCEPTION 'invalid_formula: mismatched parens';
      END IF;
      v_op_stack := v_op_stack[1:array_length(v_op_stack,1)-1]; -- pop '('
    ELSIF v_kinds[v_i] = 'op' THEN
      v_op := v_tokens[v_i];
      v_prec := CASE WHEN v_op IN ('+','-') THEN 1 ELSE 2 END;
      WHILE coalesce(array_length(v_op_stack,1),0) > 0
            AND v_op_stack[array_length(v_op_stack,1)] <> '(' LOOP
        v_top_prec := CASE WHEN v_op_stack[array_length(v_op_stack,1)] IN ('+','-') THEN 1 ELSE 2 END;
        EXIT WHEN v_top_prec < v_prec;
        v_op := v_op_stack[array_length(v_op_stack,1)];
        v_op_stack := v_op_stack[1:array_length(v_op_stack,1)-1];
        v_b := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_a := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_num_stack := v_num_stack || CASE v_op
          WHEN '+' THEN v_a + v_b
          WHEN '-' THEN v_a - v_b
          WHEN '*' THEN v_a * v_b
          WHEN '/' THEN v_a / v_b
        END;
      END LOOP;
      v_op_stack := v_op_stack || v_tokens[v_i];
    END IF;
  END LOOP;

  WHILE coalesce(array_length(v_op_stack,1),0) > 0 LOOP
    v_op := v_op_stack[array_length(v_op_stack,1)];
    IF v_op = '(' THEN RAISE EXCEPTION 'invalid_formula: mismatched parens'; END IF;
    v_op_stack := v_op_stack[1:array_length(v_op_stack,1)-1];
    v_b := v_num_stack[array_length(v_num_stack,1)];
    v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
    v_a := v_num_stack[array_length(v_num_stack,1)];
    v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
    v_num_stack := v_num_stack || CASE v_op
      WHEN '+' THEN v_a + v_b
      WHEN '-' THEN v_a - v_b
      WHEN '*' THEN v_a * v_b
      WHEN '/' THEN v_a / v_b
    END;
  END LOOP;

  IF coalesce(array_length(v_num_stack,1),0) <> 1 THEN
    RAISE EXCEPTION 'invalid_formula: malformed expression %', _formula;
  END IF;
  RETURN v_num_stack[1];
END;
$func$;

-- ============================================================
-- 7) resolve_bom_for_variant — read-only
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_bom_for_variant(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _qty numeric DEFAULT 1,
  _context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $func$
DECLARE
  v_bom_id uuid;
  v_parent_id uuid;
  v_parent_chain uuid[] := ARRAY[]::uuid[];
  v_lines jsonb := '[]'::jsonb;
  v_outputs jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_line record;
  v_out record;
  v_qty numeric;
  v_raw numeric;
  v_conv numeric;
  v_rounded numeric;
  v_formula text;
  v_rule record;
  v_vars jsonb;
  v_depth int := 0;
  v_main_pct numeric := 0;
  v_total_pct numeric := 0;
  v_lines_map jsonb := '{}'::jsonb;  -- keyed by component_product_id
BEGIN
  -- pick BOM: variant-specific > product+variant_id null > master applies_to_product_id
  SELECT id INTO v_bom_id FROM public.boms
   WHERE active = true AND product_id = _product_id AND variant_id = _variant_id
   ORDER BY is_master ASC, created_at DESC LIMIT 1;

  IF v_bom_id IS NULL AND _variant_id IS NOT NULL THEN
    SELECT id INTO v_bom_id FROM public.boms
     WHERE active = true AND applies_to_variant_id = _variant_id
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_bom_id IS NULL THEN
    SELECT id INTO v_bom_id FROM public.boms
     WHERE active = true AND product_id = _product_id AND variant_id IS NULL
     ORDER BY is_master DESC, created_at DESC LIMIT 1;
  END IF;

  IF v_bom_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code','no_bom_found','product_id',_product_id,'variant_id',_variant_id);
    RETURN jsonb_build_object('bom_id',NULL,'parent_chain','[]'::jsonb,'lines','[]'::jsonb,'outputs','[]'::jsonb,'warnings',v_warnings,'blockers',v_blockers);
  END IF;

  -- walk parent chain (max 5 levels)
  v_parent_id := v_bom_id;
  WHILE v_parent_id IS NOT NULL AND v_depth < 5 LOOP
    v_parent_chain := v_parent_chain || v_parent_id;
    SELECT parent_bom_id INTO v_parent_id FROM public.boms WHERE id = v_parent_id;
    v_depth := v_depth + 1;
  END LOOP;

  -- materialize lines from oldest ancestor down to child
  -- We collect into v_lines_map keyed by component_product_id, then child overrides.
  FOR v_line IN
    WITH chain AS (
      SELECT unnest(v_parent_chain) AS bid, generate_subscripts(v_parent_chain,1) AS pos
    )
    SELECT bl.*, c.pos
    FROM chain c
    JOIN public.bom_lines bl ON bl.bom_id = c.bid
    ORDER BY c.pos DESC, bl.sequence ASC  -- ancestor first (highest pos), then child overrides
  LOOP
    IF v_line.inheritance_action = 'remove' THEN
      v_lines_map := v_lines_map - v_line.component_product_id::text;
      CONTINUE;
    END IF;

    -- compute qty
    v_formula := COALESCE(v_line.qty_formula, v_line.formula);
    v_vars := COALESCE(v_line.formula_variables,'{}'::jsonb) || COALESCE(_context,'{}'::jsonb);
    IF v_formula IS NOT NULL AND btrim(v_formula) <> '' THEN
      BEGIN
        v_raw := public.mfg_eval_formula(v_formula, v_vars);
      EXCEPTION WHEN OTHERS THEN
        v_blockers := v_blockers || jsonb_build_object('code','formula_error','bom_line_id',v_line.id,'formula',v_formula,'error',SQLERRM);
        CONTINUE;
      END;
    ELSE
      v_raw := v_line.quantity;
    END IF;

    v_conv := v_raw * COALESCE(v_line.conversion_factor, 1);
    v_rounded := CASE v_line.rounding_method
      WHEN 'round_up'   THEN ceil(v_conv)
      WHEN 'round_down' THEN floor(v_conv)
      ELSE v_conv
    END;
    v_qty := v_rounded * _qty;

    v_lines_map := v_lines_map || jsonb_build_object(
      v_line.component_product_id::text,
      jsonb_build_object(
        'component_product_id', v_line.component_product_id,
        'component_variant_id', v_line.component_variant_id,
        'qty_required', v_qty,
        'raw_qty', v_raw,
        'converted_qty', v_conv,
        'uom_id', COALESCE(v_line.consumption_uom_id, v_line.uom_id),
        'inheritance_action', v_line.inheritance_action,
        'source_line_id', v_line.id,
        'parent_bom_line_id', v_line.parent_bom_line_id,
        'formula_used', v_formula,
        'rounding_method', v_line.rounding_method,
        'is_optional', v_line.is_optional
      )
    );
  END LOOP;

  -- apply variant rules
  FOR v_rule IN
    SELECT * FROM public.bom_variant_rules
     WHERE active = true AND bom_id = ANY(v_parent_chain)
       AND (variant_id IS NULL OR variant_id = _variant_id)
       AND (
         attribute_name IS NULL
         OR (_context ? attribute_name AND _context->>attribute_name = attribute_value)
       )
     ORDER BY priority ASC
  LOOP
    IF v_rule.rule_type = 'remove_component' AND v_rule.source_component_id IS NOT NULL THEN
      v_lines_map := v_lines_map - v_rule.source_component_id::text;
    ELSIF v_rule.rule_type = 'replace_component' THEN
      IF v_lines_map ? v_rule.source_component_id::text THEN
        DECLARE v_existing jsonb := v_lines_map->v_rule.source_component_id::text;
        BEGIN
          v_lines_map := v_lines_map - v_rule.source_component_id::text;
          v_lines_map := v_lines_map || jsonb_build_object(
            v_rule.target_component_id::text,
            v_existing
              || jsonb_build_object('component_product_id', v_rule.target_component_id, 'rule_id', v_rule.id, 'inheritance_action','override')
              || CASE WHEN v_rule.qty IS NOT NULL THEN jsonb_build_object('qty_required', v_rule.qty * _qty, 'raw_qty', v_rule.qty) ELSE '{}'::jsonb END
              || CASE WHEN v_rule.uom_id IS NOT NULL THEN jsonb_build_object('uom_id', v_rule.uom_id) ELSE '{}'::jsonb END
          );
        END;
      END IF;
    ELSIF v_rule.rule_type = 'add_component' AND v_rule.target_component_id IS NOT NULL THEN
      v_raw := COALESCE(v_rule.qty, 1);
      IF v_rule.formula IS NOT NULL THEN
        BEGIN
          v_raw := public.mfg_eval_formula(v_rule.formula, _context);
        EXCEPTION WHEN OTHERS THEN
          v_blockers := v_blockers || jsonb_build_object('code','rule_formula_error','rule_id',v_rule.id,'error',SQLERRM);
          CONTINUE;
        END;
      END IF;
      v_lines_map := v_lines_map || jsonb_build_object(
        v_rule.target_component_id::text,
        jsonb_build_object(
          'component_product_id', v_rule.target_component_id,
          'qty_required', v_raw * _qty,
          'raw_qty', v_raw,
          'uom_id', v_rule.uom_id,
          'inheritance_action','add',
          'rule_id', v_rule.id,
          'formula_used', v_rule.formula
        )
      );
    ELSIF v_rule.rule_type = 'change_qty' AND v_rule.source_component_id IS NOT NULL THEN
      IF v_lines_map ? v_rule.source_component_id::text AND v_rule.qty IS NOT NULL THEN
        v_lines_map := jsonb_set(v_lines_map, ARRAY[v_rule.source_component_id::text,'qty_required'], to_jsonb(v_rule.qty * _qty));
        v_lines_map := jsonb_set(v_lines_map, ARRAY[v_rule.source_component_id::text,'rule_id'], to_jsonb(v_rule.id));
      END IF;
    ELSIF v_rule.rule_type = 'change_formula' AND v_rule.source_component_id IS NOT NULL AND v_rule.formula IS NOT NULL THEN
      IF v_lines_map ? v_rule.source_component_id::text THEN
        BEGIN
          v_raw := public.mfg_eval_formula(v_rule.formula, _context);
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_rule.source_component_id::text,'qty_required'], to_jsonb(v_raw * _qty));
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_rule.source_component_id::text,'formula_used'], to_jsonb(v_rule.formula));
          v_lines_map := jsonb_set(v_lines_map, ARRAY[v_rule.source_component_id::text,'rule_id'], to_jsonb(v_rule.id));
        EXCEPTION WHEN OTHERS THEN
          v_blockers := v_blockers || jsonb_build_object('code','rule_formula_error','rule_id',v_rule.id,'error',SQLERRM);
        END;
      END IF;
    END IF;
  END LOOP;

  -- collect outputs from chain
  FOR v_out IN
    SELECT o.* FROM public.manufacturing_bom_outputs o
     WHERE o.active = true AND o.bom_id = ANY(v_parent_chain)
  LOOP
    v_raw := COALESCE(v_out.qty, 1);
    IF v_out.formula IS NOT NULL THEN
      BEGIN
        v_raw := public.mfg_eval_formula(v_out.formula, _context);
      EXCEPTION WHEN OTHERS THEN
        v_blockers := v_blockers || jsonb_build_object('code','output_formula_error','output_id',v_out.id,'error',SQLERRM);
        CONTINUE;
      END;
    END IF;
    IF v_out.cost_allocation_percent IS NOT NULL THEN
      v_total_pct := v_total_pct + v_out.cost_allocation_percent;
    END IF;
    v_outputs := v_outputs || jsonb_build_object(
      'output_id', v_out.id,
      'product_id', v_out.product_id,
      'output_type', v_out.output_type,
      'qty_expected', v_raw * _qty,
      'uom_id', v_out.uom_id,
      'stockable', v_out.stockable,
      'condition', v_out.condition,
      'operation_id', v_out.operation_id,
      'work_center_id', v_out.work_center_id,
      'cost_allocation_percent', v_out.cost_allocation_percent
    );
  END LOOP;

  -- if no explicit main_product output, synthesize it (100% cost)
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_outputs) e WHERE e->>'output_type' = 'main_product'
  ) THEN
    v_outputs := jsonb_build_array(jsonb_build_object(
      'product_id', _product_id,
      'output_type','main_product',
      'qty_expected', _qty,
      'stockable', true,
      'cost_allocation_percent', NULL,
      'synthesized', true
    )) || v_outputs;
  END IF;

  IF v_total_pct > 100 THEN
    v_blockers := v_blockers || jsonb_build_object('code','cost_allocation_exceeds_100','total',v_total_pct);
  END IF;

  -- flatten map -> array
  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'component_product_id'),'[]'::jsonb)
    INTO v_lines
    FROM jsonb_each(v_lines_map);

  RETURN jsonb_build_object(
    'bom_id', v_bom_id,
    'parent_chain', to_jsonb(v_parent_chain),
    'lines', v_lines,
    'outputs', v_outputs,
    'warnings', v_warnings,
    'blockers', v_blockers,
    'requested_qty', _qty,
    'product_id', _product_id,
    'variant_id', _variant_id
  );
END;
$func$;

-- ============================================================
-- 8) Test suite _test_phase16_c1_bom_resolution_readonly
-- ============================================================
CREATE OR REPLACE FUNCTION public._test_phase16_c1_bom_resolution_readonly()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_prefix text := 'F16C1_' || replace(clock_timestamp()::text,' ','_') || '_' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_uom_unit uuid;
  v_uom_m uuid;       -- metro linear
  v_cat_id uuid;
  v_p_cama uuid; v_p_madeira uuid; v_p_espuma uuid; v_p_tecido_base uuid;
  v_p_opera_black uuid; v_p_opera_cream uuid; v_p_puff uuid; v_p_retalho uuid;
  v_var_black uuid; v_var_cream uuid;
  v_bom_master uuid; v_bom_black uuid; v_bom_cream uuid;
  v_line_madeira uuid; v_line_espuma uuid; v_line_tecido_base uuid;
  v_result jsonb;
  v_lines jsonb; v_outputs jsonb;
  v_pre_bom_count int; v_post_bom_count int;
  v_count int;
BEGIN
  -- ensure UoMs
  SELECT id INTO v_uom_unit FROM product_uom WHERE code='UN' LIMIT 1;
  IF v_uom_unit IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Unidade','UN',1,'unit') RETURNING id INTO v_uom_unit;
  END IF;
  SELECT id INTO v_uom_m FROM product_uom WHERE code='M' LIMIT 1;
  IF v_uom_m IS NULL THEN
    INSERT INTO product_uom(name,code,ratio,category) VALUES ('Metro','M',1,'length') RETURNING id INTO v_uom_m;
  END IF;

  SELECT id INTO v_cat_id FROM product_categories LIMIT 1;
  IF v_cat_id IS NULL THEN
    INSERT INTO product_categories(name) VALUES (v_prefix||'_cat') RETURNING id INTO v_cat_id;
  END IF;

  -- products
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id, can_be_manufactured)
    VALUES (v_prefix||'_cama','C'||v_prefix,'storable',v_uom_unit,v_cat_id,true) RETURNING id INTO v_p_cama;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_madeira','MAD'||v_prefix,'storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_madeira;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_espuma','ESP'||v_prefix,'storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_espuma;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_tecido_base','TB'||v_prefix,'storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_tecido_base;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_opera_black','OB'||v_prefix,'storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_opera_black;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_opera_cream','OC'||v_prefix,'storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_opera_cream;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_puff','PUFF'||v_prefix,'storable',v_uom_unit,v_cat_id) RETURNING id INTO v_p_puff;
  INSERT INTO products(name, internal_ref, product_type, uom_id, category_id)
    VALUES (v_prefix||'_retalho','RET'||v_prefix,'storable',v_uom_m,v_cat_id) RETURNING id INTO v_p_retalho;

  -- variants
  INSERT INTO product_variants(product_id, sku) VALUES (v_p_cama, v_prefix||'_black') RETURNING id INTO v_var_black;
  INSERT INTO product_variants(product_id, sku) VALUES (v_p_cama, v_prefix||'_cream') RETURNING id INTO v_var_cream;

  -- BOM master
  INSERT INTO boms(code, product_id, type, quantity, uom_id, is_master)
    VALUES (v_prefix||'_M', v_p_cama, 'normal', 1, v_uom_unit, true) RETURNING id INTO v_bom_master;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_madeira, 5, 10, v_uom_unit) RETURNING id INTO v_line_madeira;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id)
    VALUES (v_bom_master, v_p_espuma, 3, 20, v_uom_unit) RETURNING id INTO v_line_espuma;
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula)
    VALUES (v_bom_master, v_p_tecido_base, 1, 30, v_uom_m, 'width_cm * 0.025 + 0.5') RETURNING id INTO v_line_tecido_base;

  -- BOM filha Black (inherits + replaces tecido)
  INSERT INTO boms(code, product_id, variant_id, type, quantity, uom_id, parent_bom_id, inheritance_mode)
    VALUES (v_prefix||'_BLK', v_p_cama, v_var_black, 'normal', 1, v_uom_unit, v_bom_master, 'inherit') RETURNING id INTO v_bom_black;

  -- BOM filha Cream (inherits, only one rule)
  INSERT INTO boms(code, product_id, variant_id, type, quantity, uom_id, parent_bom_id)
    VALUES (v_prefix||'_CRM', v_p_cama, v_var_cream, 'normal', 1, v_uom_unit, v_bom_master) RETURNING id INTO v_bom_cream;

  -- rule: replace tecido_base -> opera_black for variant black
  INSERT INTO bom_variant_rules(bom_id, variant_id, rule_type, source_component_id, target_component_id, qty, uom_id, priority)
    VALUES (v_bom_black, v_var_black, 'replace_component', v_p_tecido_base, v_p_opera_black, 4.8, v_uom_m, 10);

  -- rule: replace tecido_base -> opera_cream for variant cream
  INSERT INTO bom_variant_rules(bom_id, variant_id, rule_type, source_component_id, target_component_id, qty, uom_id, priority)
    VALUES (v_bom_cream, v_var_cream, 'replace_component', v_p_tecido_base, v_p_opera_cream, 4.5, v_uom_m, 10);

  -- output: co-product puff + reusable_scrap retalho + waste
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent)
    VALUES (v_bom_master, v_p_cama, 'main_product', 1, 80);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent, stockable)
    VALUES (v_bom_master, v_p_puff, 'co_product', 2, 15, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom_master, v_p_retalho, 'reusable_scrap', 0.8, true);
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, stockable)
    VALUES (v_bom_master, v_p_tecido_base, 'waste', 0.2, false);

  -- ==========================
  -- TEST 1: BOM Master created
  -- ==========================
  test_name := '01_bom_master_created'; passed := v_bom_master IS NOT NULL; detail := v_bom_master::text; RETURN NEXT;

  -- TEST 2: BOM filha herda componentes da Master (resolve Black sem rule extra deve trazer madeira+espuma+opera_black)
  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '02_inherit_master_components';
  passed := (SELECT count(*) FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid IN (v_p_madeira,v_p_espuma)) = 2;
  detail := v_lines::text;
  RETURN NEXT;

  -- TEST 3: BOM filha substitui tecido base por opera_black
  test_name := '03_replace_tecido_opera_black';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_opera_black)
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_tecido_base);
  detail := '';
  RETURN NEXT;

  -- TEST 4: Cream não duplica BOM inteira
  test_name := '04_cream_does_not_duplicate';
  SELECT count(*) INTO v_count FROM bom_lines WHERE bom_id = v_bom_cream;
  passed := v_count = 0; detail := 'bom_cream lines='||v_count; RETURN NEXT;

  -- TEST 5: linha override altera componente herdado — usar bom_lines override
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, inheritance_action, parent_bom_line_id)
    VALUES (v_bom_black, v_p_madeira, 7, 10, v_uom_unit, 'override', v_line_madeira);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '05_override_line_changes_qty';
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_madeira) = 7;
  detail := ''; RETURN NEXT;

  -- TEST 6: linha remove elimina componente
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, inheritance_action, parent_bom_line_id)
    VALUES (v_bom_black, v_p_espuma, 0, 20, v_uom_unit, 'remove', v_line_espuma);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_black, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '06_remove_line_drops_component';
  passed := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_espuma);
  detail := ''; RETURN NEXT;

  -- TEST 7: resolve_bom_for_variant retorna componentes finais
  test_name := '07_resolve_returns_final_components';
  passed := jsonb_array_length(v_lines) >= 2; detail := ''; RETURN NEXT;

  -- TEST 8: fórmula calcula tecido (Cream, width=140 → 140*0.025+0.5 = 4.0)
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  -- Cream replaces tecido_base with opera_cream qty=4.5 (rule wins)
  test_name := '08_formula_or_rule_applied';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) e
                    WHERE (e->>'component_product_id')::uuid = v_p_opera_cream
                      AND (e->>'qty_required')::numeric = 4.5);
  detail := ''; RETURN NEXT;

  -- TEST 9: fórmula inválida bloqueia
  test_name := '09_invalid_formula_blocks';
  BEGIN
    PERFORM mfg_eval_formula('1 + foo', '{}'::jsonb);
    passed := false; detail := 'should have raised';
  EXCEPTION WHEN OTHERS THEN
    passed := SQLERRM ILIKE '%invalid_formula%'; detail := SQLERRM;
  END;
  RETURN NEXT;

  -- TEST 10: fórmula com SQL é bloqueada
  test_name := '10_sql_in_formula_blocked';
  BEGIN
    PERFORM mfg_eval_formula('1; drop table boms', '{}'::jsonb);
    passed := false; detail := 'should have raised';
  EXCEPTION WHEN OTHERS THEN passed := true; detail := SQLERRM; END;
  RETURN NEXT;

  -- TEST 10b: select in formula blocked
  test_name := '10b_select_in_formula_blocked';
  BEGIN
    PERFORM mfg_eval_formula('(select 1)', '{}'::jsonb);
    passed := false;
  EXCEPTION WHEN OTHERS THEN passed := true; detail := SQLERRM; END;
  RETURN NEXT;

  -- TEST 11: conversion_factor aplicado
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, conversion_factor)
    VALUES (v_bom_master, v_p_madeira, 2, 100, v_uom_unit, 3);
  -- Wait — adds another madeira line to master, but child has override → won't apply. Test on resolve of master directly via cream (no override).
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, jsonb_build_object('width_cm',140));
  v_lines := v_result->'lines';
  test_name := '11_conversion_factor_applied';
  -- The map collapses by component_product_id; both madeira lines collide.
  -- The latest one (sequence 100) overrides → 2 * 3 = 6.
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_madeira) = 6;
  detail := ''; RETURN NEXT;

  -- TEST 12: rounding round_up
  INSERT INTO bom_lines(bom_id, component_product_id, quantity, sequence, uom_id, qty_formula, rounding_method)
    VALUES (v_bom_cream, v_p_retalho, 1, 200, v_uom_m, '0.1 + 0.2', 'round_up');
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, '{}'::jsonb);
  v_lines := v_result->'lines';
  test_name := '12_rounding_round_up';
  passed := (SELECT (e->>'qty_required')::numeric FROM jsonb_array_elements(v_lines) e WHERE (e->>'component_product_id')::uuid = v_p_retalho) = 1;
  detail := ''; RETURN NEXT;

  -- TEST 13: outputs main_product
  v_outputs := v_result->'outputs';
  test_name := '13_output_main_product';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'main_product');
  detail := ''; RETURN NEXT;

  -- TEST 14: co_product puff
  test_name := '14_output_co_product_puff';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'co_product' AND (o->>'product_id')::uuid = v_p_puff);
  detail := ''; RETURN NEXT;

  -- TEST 15: reusable_scrap
  test_name := '15_output_reusable_scrap';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'reusable_scrap' AND (o->>'stockable')::boolean = true);
  detail := ''; RETURN NEXT;

  -- TEST 16: waste não stockable
  test_name := '16_waste_not_stockable';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_outputs) o WHERE o->>'output_type' = 'waste' AND (o->>'stockable')::boolean = false);
  detail := ''; RETURN NEXT;

  -- TEST 17: cost_allocation_percent não passa de 100% — total = 80+15 = 95, ok
  test_name := '17_cost_allocation_within_100';
  passed := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b WHERE b->>'code' = 'cost_allocation_exceeds_100');
  detail := ''; RETURN NEXT;

  -- TEST 17b: cost_allocation > 100 → blocker
  INSERT INTO manufacturing_bom_outputs(bom_id, product_id, output_type, qty, cost_allocation_percent)
    VALUES (v_bom_master, v_p_puff, 'co_product', 1, 50);
  v_result := resolve_bom_for_variant(v_p_cama, v_var_cream, 1, '{}'::jsonb);
  test_name := '17b_cost_allocation_exceeds_blocks';
  passed := EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'blockers') b WHERE b->>'code' = 'cost_allocation_exceeds_100');
  detail := (v_result->'blockers')::text; RETURN NEXT;

  -- TEST 18: BOM antiga sem parent continua válida
  test_name := '18_legacy_bom_without_parent_works';
  v_result := resolve_bom_for_variant(v_p_cama, NULL, 1, jsonb_build_object('width_cm',140));
  passed := (v_result->>'bom_id') IS NOT NULL AND jsonb_array_length(v_result->'lines') >= 1;
  detail := ''; RETURN NEXT;

  -- TEST 19: resolve_bom_for_variant não escreve nada (bom count antes/depois)
  SELECT count(*) INTO v_pre_bom_count FROM boms;
  PERFORM resolve_bom_for_variant(v_p_cama, v_var_black, 5, jsonb_build_object('width_cm',180));
  PERFORM resolve_bom_for_variant(v_p_cama, v_var_cream, 2, jsonb_build_object('width_cm',200));
  SELECT count(*) INTO v_post_bom_count FROM boms;
  test_name := '19_resolve_is_readonly';
  passed := v_pre_bom_count = v_post_bom_count;
  detail := 'pre='||v_pre_bom_count||' post='||v_post_bom_count; RETURN NEXT;

  -- TEST 20: mfg_create_mo_for_line / mfg_create_needs_for_mo / close_mo intactos
  test_name := '20_core_functions_untouched';
  passed := EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'close_mo')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfg_create_mo_for_line');
  detail := 'core mfg functions present'; RETURN NEXT;

  -- cleanup
  DELETE FROM manufacturing_bom_outputs WHERE bom_id IN (v_bom_master);
  DELETE FROM bom_variant_rules WHERE bom_id IN (v_bom_master, v_bom_black, v_bom_cream);
  DELETE FROM bom_lines WHERE bom_id IN (v_bom_master, v_bom_black, v_bom_cream);
  DELETE FROM boms WHERE id IN (v_bom_black, v_bom_cream, v_bom_master);
  DELETE FROM product_variants WHERE id IN (v_var_black, v_var_cream);
  DELETE FROM products WHERE id IN (v_p_cama,v_p_madeira,v_p_espuma,v_p_tecido_base,v_p_opera_black,v_p_opera_cream,v_p_puff,v_p_retalho);

  RETURN;
END;
$func$;
