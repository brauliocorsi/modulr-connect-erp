-- Replace strict unique on sku with partial (ignore null/empty) and add same for barcode
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key;
DROP INDEX IF EXISTS public.product_variants_sku_key;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_unique
  ON public.product_variants (sku)
  WHERE sku IS NOT NULL AND sku <> '';

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_barcode_unique
  ON public.product_variants (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';