
ALTER TABLE public.delivery_routes
ADD COLUMN IF NOT EXISTS helper_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS delivery_routes_helper_idx ON public.delivery_routes(helper_id);
