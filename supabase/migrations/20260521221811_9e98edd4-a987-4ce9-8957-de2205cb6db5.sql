
CREATE TABLE public.user_list_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  view_key text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_list_views_user_view_idx ON public.user_list_views (user_id, view_key);
CREATE UNIQUE INDEX user_list_views_user_view_name_uq ON public.user_list_views (user_id, view_key, name);
CREATE UNIQUE INDEX user_list_views_one_default_per_view
  ON public.user_list_views (user_id, view_key)
  WHERE is_default;

ALTER TABLE public.user_list_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read their own list views"
  ON public.user_list_views FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert their own list views"
  ON public.user_list_views FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update their own list views"
  ON public.user_list_views FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete their own list views"
  ON public.user_list_views FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER user_list_views_set_updated_at
  BEFORE UPDATE ON public.user_list_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
