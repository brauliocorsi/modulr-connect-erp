-- Add image_url to product_variants
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS image_url text;

-- Storage bucket for variant images
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-variants', 'product-variants', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "product_variants_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-variants');

-- Authenticated users with product edit permission can write
CREATE POLICY "product_variants_authed_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-variants' AND public.has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'edit'::permission_action));

CREATE POLICY "product_variants_authed_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-variants' AND public.has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'edit'::permission_action));

CREATE POLICY "product_variants_authed_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-variants' AND public.has_permission(auth.uid(), 'products'::app_module, 'products'::text, 'edit'::permission_action));