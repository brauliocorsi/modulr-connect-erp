CREATE OR REPLACE FUNCTION public.bom_preview_resolved(
  _bom_id uuid,
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _qty numeric DEFAULT 1,
  _context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bom_preview_resolved: not authenticated' USING ERRCODE='28000';
  END IF;

  v_result := public.resolve_bom_for_variant(_product_id, _variant_id, COALESCE(_qty,1), COALESCE(_context,'{}'::jsonb));

  -- attach hint of requested bom_id (informational)
  IF _bom_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('requested_bom_id', _bom_id);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bom_preview_resolved(uuid, uuid, uuid, numeric, jsonb) TO authenticated;