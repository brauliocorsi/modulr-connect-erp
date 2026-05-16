
ALTER TABLE public.stock_reservation_log DROP CONSTRAINT stock_reservation_log_action_check;
ALTER TABLE public.stock_reservation_log ADD CONSTRAINT stock_reservation_log_action_check
  CHECK (action = ANY (ARRAY[
    'reserve','release','consume',
    'allocate_auto','allocate_suggested','transfer','decision_required'
  ]));
