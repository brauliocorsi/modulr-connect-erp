
ALTER TABLE public.delivery_schedules DROP CONSTRAINT IF EXISTS delivery_schedules_status_chk;
ALTER TABLE public.delivery_schedules ADD CONSTRAINT delivery_schedules_status_chk
  CHECK (status = ANY (ARRAY['requested','scheduled','confirmed','assigned','waiting_confirmation','loading','loaded','in_transit','out_for_delivery','delivered','partial','failed','rescheduled','cancelled']));
