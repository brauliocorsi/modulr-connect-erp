CREATE TABLE IF NOT EXISTS public._m3_test_result(id serial primary key, ran_at timestamptz default now(), result jsonb);
ALTER TABLE public._m3_test_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read m3 test" ON public._m3_test_result FOR SELECT USING (true);