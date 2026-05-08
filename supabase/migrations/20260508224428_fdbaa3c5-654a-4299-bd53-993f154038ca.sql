
DROP POLICY IF EXISTS stores_insert ON public.stores;
DROP POLICY IF EXISTS stores_update ON public.stores;
DROP POLICY IF EXISTS stores_delete ON public.stores;

CREATE POLICY stores_insert ON public.stores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stores_update ON public.stores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY stores_delete ON public.stores FOR DELETE TO authenticated USING (has_group(auth.uid(), 'system_admin'));

DROP POLICY IF EXISTS store_members_manage ON public.store_members;
CREATE POLICY store_members_manage ON public.store_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
