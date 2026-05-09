ALTER TABLE public.stock_locations ADD COLUMN IF NOT EXISTS barcode text;
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_barcode_uidx ON public.stock_locations(barcode) WHERE barcode IS NOT NULL;

UPDATE public.stock_locations SET barcode = 'LOC-DOCK' WHERE id = 'bfe2a0e0-9036-471b-b07e-2b7560399274' AND barcode IS NULL;
UPDATE public.stock_locations SET barcode = 'LOC-VAN' WHERE id = 'b9c4f4ff-2905-44bc-9311-020956a4f97a' AND barcode IS NULL;