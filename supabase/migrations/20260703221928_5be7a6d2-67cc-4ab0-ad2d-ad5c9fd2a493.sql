ALTER TABLE public.work_centers
  ADD CONSTRAINT work_centers_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';