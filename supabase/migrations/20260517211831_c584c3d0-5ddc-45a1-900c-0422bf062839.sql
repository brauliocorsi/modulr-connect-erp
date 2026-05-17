-- Additive: extend mo_issue_kind enum with operational types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.mo_issue_kind'::regtype AND enumlabel = 'machine_unavailable') THEN
    ALTER TYPE public.mo_issue_kind ADD VALUE 'machine_unavailable';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.mo_issue_kind'::regtype AND enumlabel = 'employee_unavailable') THEN
    ALTER TYPE public.mo_issue_kind ADD VALUE 'employee_unavailable';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.mo_issue_kind'::regtype AND enumlabel = 'quality_failed') THEN
    ALTER TYPE public.mo_issue_kind ADD VALUE 'quality_failed';
  END IF;
END$$;