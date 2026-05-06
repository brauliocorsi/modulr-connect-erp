ALTER TABLE public.companies ALTER COLUMN currency SET DEFAULT 'EUR';
ALTER TABLE public.pricelists ALTER COLUMN currency SET DEFAULT 'EUR';
UPDATE public.companies SET currency='EUR' WHERE currency='BRL';
UPDATE public.pricelists SET currency='EUR' WHERE currency='BRL';