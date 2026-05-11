CREATE TABLE IF NOT EXISTS public.user_filter_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storage_key)
);

ALTER TABLE public.user_filter_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own filter preferences"
  ON public.user_filter_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own filter preferences"
  ON public.user_filter_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own filter preferences"
  ON public.user_filter_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own filter preferences"
  ON public.user_filter_preferences FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_filter_preferences_updated_at
  BEFORE UPDATE ON public.user_filter_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();