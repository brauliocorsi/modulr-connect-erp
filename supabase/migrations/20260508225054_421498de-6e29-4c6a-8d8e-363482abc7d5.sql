DROP POLICY IF EXISTS "im_admin" ON public.installed_modules;
CREATE POLICY "im_write" ON public.installed_modules
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);