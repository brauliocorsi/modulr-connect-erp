
CREATE OR REPLACE FUNCTION public.mfg_eval_formula(_formula text, _vars jsonb DEFAULT '{}'::jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allowed_vars text[] := ARRAY['width_cm','length_cm','height_cm','mattress_width','mattress_length','fabric_width','qty_ordered'];
  v_extra_keys text[] := ARRAY[]::text[];
  v_norm text;
  v_pos int := 1;
  v_len int;
  v_ch text;
  v_tok text;
  v_tokens text[] := ARRAY[]::text[];
  v_kinds text[] := ARRAY[]::text[];
  v_new_tokens text[];
  v_new_kinds text[];
  v_prev_kind text;
  v_i int;
  v_id text;
  v_val numeric;
  v_num_stack numeric[] := ARRAY[]::numeric[];
  v_op_stack text[] := ARRAY[]::text[];
  v_op text;
  v_a numeric; v_b numeric;
  v_prec int; v_top_prec int;
  v_stack_len int;
BEGIN
  IF _formula IS NULL OR btrim(_formula) = '' THEN
    RAISE EXCEPTION 'invalid_formula: empty';
  END IF;

  v_norm := lower(_formula);

  IF v_norm !~ '^[[:space:]0-9\.\+\-\*\/\(\)a-z_]+$' THEN
    RAISE EXCEPTION 'invalid_formula: forbidden characters in %', _formula;
  END IF;

  IF v_norm ~ '(;|--|/\*|\*/|select|insert|update|delete|drop|alter|create|grant|revoke|truncate|union|copy|do|begin|commit|rollback|execute|perform|call|pg_|information_schema)' THEN
    RAISE EXCEPTION 'invalid_formula: forbidden keyword/pattern in %', _formula;
  END IF;

  IF _vars IS NOT NULL AND jsonb_typeof(_vars) = 'object' THEN
    SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_extra_keys FROM jsonb_object_keys(_vars) k;
  END IF;

  v_len := length(v_norm);
  WHILE v_pos <= v_len LOOP
    v_ch := substr(v_norm, v_pos, 1);
    IF v_ch ~ '[[:space:]]' THEN
      v_pos := v_pos + 1;
    ELSIF v_ch IN ('+','-','*','/') THEN
      v_tokens := array_append(v_tokens, v_ch);
      v_kinds := array_append(v_kinds, 'op'::text);
      v_pos := v_pos + 1;
    ELSIF v_ch = '(' THEN
      v_tokens := array_append(v_tokens, '('::text);
      v_kinds := array_append(v_kinds, 'lp'::text);
      v_pos := v_pos + 1;
    ELSIF v_ch = ')' THEN
      v_tokens := array_append(v_tokens, ')'::text);
      v_kinds := array_append(v_kinds, 'rp'::text);
      v_pos := v_pos + 1;
    ELSIF v_ch ~ '[0-9\.]' THEN
      v_tok := '';
      WHILE v_pos <= v_len AND substr(v_norm, v_pos, 1) ~ '[0-9\.]' LOOP
        v_tok := v_tok || substr(v_norm, v_pos, 1);
        v_pos := v_pos + 1;
      END LOOP;
      v_tokens := array_append(v_tokens, v_tok);
      v_kinds := array_append(v_kinds, 'num'::text);
    ELSIF v_ch ~ '[a-z_]' THEN
      v_tok := '';
      WHILE v_pos <= v_len AND substr(v_norm, v_pos, 1) ~ '[a-z0-9_]' LOOP
        v_tok := v_tok || substr(v_norm, v_pos, 1);
        v_pos := v_pos + 1;
      END LOOP;
      v_tokens := array_append(v_tokens, v_tok);
      v_kinds := array_append(v_kinds, 'id'::text);
    ELSE
      RAISE EXCEPTION 'invalid_formula: unexpected char % at %', v_ch, v_pos;
    END IF;
  END LOOP;

  -- inject 0 before unary minus
  v_new_tokens := ARRAY[]::text[];
  v_new_kinds := ARRAY[]::text[];
  v_prev_kind := NULL;
  FOR v_i IN 1..COALESCE(array_length(v_tokens,1),0) LOOP
    IF v_tokens[v_i] = '-' AND (v_prev_kind IS NULL OR v_prev_kind IN ('op','lp')) THEN
      v_new_tokens := array_append(v_new_tokens, '0'::text);
      v_new_kinds := array_append(v_new_kinds, 'num'::text);
    END IF;
    v_new_tokens := array_append(v_new_tokens, v_tokens[v_i]);
    v_new_kinds := array_append(v_new_kinds, v_kinds[v_i]);
    v_prev_kind := v_kinds[v_i];
  END LOOP;
  v_tokens := v_new_tokens;
  v_kinds := v_new_kinds;

  FOR v_i IN 1..COALESCE(array_length(v_tokens,1),0) LOOP
    IF v_kinds[v_i] = 'num' THEN
      v_num_stack := array_append(v_num_stack, v_tokens[v_i]::numeric);
    ELSIF v_kinds[v_i] = 'id' THEN
      v_id := v_tokens[v_i];
      IF v_id = ANY(v_allowed_vars) THEN
        IF _vars ? v_id AND jsonb_typeof(_vars->v_id) = 'number' THEN
          v_val := (_vars->>v_id)::numeric;
        ELSE
          RAISE EXCEPTION 'invalid_formula: missing variable %', v_id;
        END IF;
      ELSIF v_id = ANY(v_extra_keys) THEN
        IF jsonb_typeof(_vars->v_id) <> 'number' THEN
          RAISE EXCEPTION 'invalid_formula: variable % must be numeric', v_id;
        END IF;
        v_val := (_vars->>v_id)::numeric;
      ELSE
        RAISE EXCEPTION 'invalid_formula: unknown variable %', v_id;
      END IF;
      v_num_stack := array_append(v_num_stack, v_val);
    ELSIF v_kinds[v_i] = 'lp' THEN
      v_op_stack := array_append(v_op_stack, '('::text);
    ELSIF v_kinds[v_i] = 'rp' THEN
      LOOP
        v_stack_len := COALESCE(array_length(v_op_stack,1),0);
        EXIT WHEN v_stack_len = 0 OR v_op_stack[v_stack_len] = '(';
        v_op := v_op_stack[v_stack_len];
        v_op_stack := v_op_stack[1:v_stack_len-1];
        v_b := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_a := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_num_stack := array_append(v_num_stack, CASE v_op
          WHEN '+' THEN v_a + v_b WHEN '-' THEN v_a - v_b
          WHEN '*' THEN v_a * v_b WHEN '/' THEN v_a / v_b END);
      END LOOP;
      v_stack_len := COALESCE(array_length(v_op_stack,1),0);
      IF v_stack_len = 0 THEN RAISE EXCEPTION 'invalid_formula: mismatched parens'; END IF;
      v_op_stack := v_op_stack[1:v_stack_len-1];
    ELSIF v_kinds[v_i] = 'op' THEN
      v_op := v_tokens[v_i];
      v_prec := CASE WHEN v_op IN ('+','-') THEN 1 ELSE 2 END;
      LOOP
        v_stack_len := COALESCE(array_length(v_op_stack,1),0);
        EXIT WHEN v_stack_len = 0 OR v_op_stack[v_stack_len] = '(';
        v_top_prec := CASE WHEN v_op_stack[v_stack_len] IN ('+','-') THEN 1 ELSE 2 END;
        EXIT WHEN v_top_prec < v_prec;
        v_op := v_op_stack[v_stack_len];
        v_op_stack := v_op_stack[1:v_stack_len-1];
        v_b := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_a := v_num_stack[array_length(v_num_stack,1)];
        v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
        v_num_stack := array_append(v_num_stack, CASE v_op
          WHEN '+' THEN v_a + v_b WHEN '-' THEN v_a - v_b
          WHEN '*' THEN v_a * v_b WHEN '/' THEN v_a / v_b END);
      END LOOP;
      v_op_stack := array_append(v_op_stack, v_tokens[v_i]);
    END IF;
  END LOOP;

  LOOP
    v_stack_len := COALESCE(array_length(v_op_stack,1),0);
    EXIT WHEN v_stack_len = 0;
    v_op := v_op_stack[v_stack_len];
    IF v_op = '(' THEN RAISE EXCEPTION 'invalid_formula: mismatched parens'; END IF;
    v_op_stack := v_op_stack[1:v_stack_len-1];
    v_b := v_num_stack[array_length(v_num_stack,1)];
    v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
    v_a := v_num_stack[array_length(v_num_stack,1)];
    v_num_stack := v_num_stack[1:array_length(v_num_stack,1)-1];
    v_num_stack := array_append(v_num_stack, CASE v_op
      WHEN '+' THEN v_a + v_b WHEN '-' THEN v_a - v_b
      WHEN '*' THEN v_a * v_b WHEN '/' THEN v_a / v_b END);
  END LOOP;

  IF COALESCE(array_length(v_num_stack,1),0) <> 1 THEN
    RAISE EXCEPTION 'invalid_formula: malformed expression %', _formula;
  END IF;
  RETURN v_num_stack[1];
END;
$func$;
