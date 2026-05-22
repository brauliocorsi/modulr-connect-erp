
-- Attachments on bills and payments
ALTER TABLE public.supplier_bills ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Storage bucket for finance attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-attachments', 'finance-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Public read; authenticated write/update/delete on this bucket
DROP POLICY IF EXISTS "finance_attachments_read" ON storage.objects;
CREATE POLICY "finance_attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'finance-attachments');

DROP POLICY IF EXISTS "finance_attachments_write" ON storage.objects;
CREATE POLICY "finance_attachments_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'finance-attachments');

DROP POLICY IF EXISTS "finance_attachments_update" ON storage.objects;
CREATE POLICY "finance_attachments_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'finance-attachments');

DROP POLICY IF EXISTS "finance_attachments_delete" ON storage.objects;
CREATE POLICY "finance_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'finance-attachments');
