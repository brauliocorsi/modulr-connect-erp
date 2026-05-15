
ALTER TABLE public.mo_quality_checks ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.mo_issues ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('mfg-attachments', 'mfg-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "mfg attachments public read" ON storage.objects;
CREATE POLICY "mfg attachments public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'mfg-attachments');

DROP POLICY IF EXISTS "mfg attachments authenticated insert" ON storage.objects;
CREATE POLICY "mfg attachments authenticated insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'mfg-attachments');

DROP POLICY IF EXISTS "mfg attachments authenticated update" ON storage.objects;
CREATE POLICY "mfg attachments authenticated update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'mfg-attachments');

DROP POLICY IF EXISTS "mfg attachments authenticated delete" ON storage.objects;
CREATE POLICY "mfg attachments authenticated delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'mfg-attachments');
