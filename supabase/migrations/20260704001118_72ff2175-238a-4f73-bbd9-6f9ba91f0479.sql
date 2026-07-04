
ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS mo_component_id uuid REFERENCES public.mo_components(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_moves_mo_component_id ON public.stock_moves(mo_component_id);
