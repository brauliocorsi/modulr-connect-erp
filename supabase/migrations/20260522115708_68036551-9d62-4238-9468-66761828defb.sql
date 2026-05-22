
-- Chart of Accounts
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read chart_of_accounts" ON public.chart_of_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write chart_of_accounts" ON public.chart_of_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add account_id to financial tables
ALTER TABLE public.supplier_bills      ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id);
ALTER TABLE public.supplier_payments   ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id);
ALTER TABLE public.customer_payments   ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id);
ALTER TABLE public.recurring_expenses  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id);
ALTER TABLE public.recurring_expenses  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id);
ALTER TABLE public.recurring_expenses  ADD COLUMN IF NOT EXISTS journal_id uuid REFERENCES public.account_journals(id);
ALTER TABLE public.cash_movements      ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.chart_of_accounts(id);

-- Bank statement imports
CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  journal_id uuid REFERENCES public.account_journals(id),
  file_name text,
  file_kind text,
  rows_total integer NOT NULL DEFAULT 0,
  rows_matched integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','mapped','matched','confirmed','cancelled')),
  column_map jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bsi" ON public.bank_statement_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write bsi" ON public.bank_statement_imports FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  line_hash text NOT NULL,
  occurred_on date NOT NULL,
  description text,
  reference text,
  amount numeric NOT NULL,
  balance numeric,
  raw jsonb,
  suggested_payment_id uuid REFERENCES public.customer_payments(id),
  suggested_supplier_payment_id uuid REFERENCES public.supplier_payments(id),
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','suggested','confirmed','rejected','manual')),
  matched_at timestamptz,
  matched_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(import_id, line_hash)
);
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bsl" ON public.bank_statement_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write bsl" ON public.bank_statement_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bsl_import ON public.bank_statement_lines(import_id);
CREATE INDEX IF NOT EXISTS idx_bsl_amount_date ON public.bank_statement_lines(amount, occurred_on);

-- updated_at trigger for chart_of_accounts
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_coa_touch ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_touch BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RPCs
CREATE OR REPLACE FUNCTION public.account_upsert(
  _id uuid,
  _code text,
  _name text,
  _type text,
  _parent_id uuid DEFAULT NULL,
  _active boolean DEFAULT true,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out uuid;
BEGIN
  IF _id IS NULL THEN
    INSERT INTO chart_of_accounts(code,name,type,parent_id,active,notes)
    VALUES (_code,_name,_type,_parent_id,_active,_notes)
    RETURNING id INTO _out;
  ELSE
    UPDATE chart_of_accounts
       SET code=_code,name=_name,type=_type,parent_id=_parent_id,active=_active,notes=_notes
     WHERE id=_id
    RETURNING id INTO _out;
  END IF;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.account_archive(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE chart_of_accounts SET active=false WHERE id=_id; END $$;

CREATE OR REPLACE FUNCTION public.bank_statement_import_create(
  _name text, _journal_id uuid, _file_name text, _file_kind text, _column_map jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out uuid;
BEGIN
  INSERT INTO bank_statement_imports(name,journal_id,file_name,file_kind,column_map,created_by)
  VALUES (_name,_journal_id,_file_name,_file_kind,_column_map,auth.uid())
  RETURNING id INTO _out;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.bank_statement_line_insert(
  _import_id uuid, _occurred_on date, _description text, _reference text,
  _amount numeric, _balance numeric, _raw jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out uuid; _hash text;
BEGIN
  _hash := md5(coalesce(_occurred_on::text,'')||'|'||coalesce(_description,'')||'|'||coalesce(_reference,'')||'|'||_amount::text);
  INSERT INTO bank_statement_lines(import_id,line_hash,occurred_on,description,reference,amount,balance,raw)
  VALUES (_import_id,_hash,_occurred_on,_description,_reference,_amount,_balance,_raw)
  ON CONFLICT (import_id,line_hash) DO UPDATE SET amount=EXCLUDED.amount
  RETURNING id INTO _out;
  UPDATE bank_statement_imports SET rows_total = (SELECT count(*) FROM bank_statement_lines WHERE import_id=_import_id) WHERE id=_import_id;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.bank_reconciliation_confirm_match(
  _line_id uuid, _customer_payment_id uuid DEFAULT NULL, _supplier_payment_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _customer_payment_id IS NOT NULL THEN
    UPDATE customer_payments
       SET reconciled_at = now(),
           reconciled_by = auth.uid(),
           reconciliation_status = 'matched'
     WHERE id = _customer_payment_id AND reconciled_at IS NULL;
  END IF;
  IF _supplier_payment_id IS NOT NULL THEN
    UPDATE supplier_payments SET state = 'reconciled' WHERE id = _supplier_payment_id;
  END IF;
  UPDATE bank_statement_lines
     SET match_status = 'confirmed',
         matched_at = now(),
         matched_by = auth.uid(),
         suggested_payment_id = COALESCE(_customer_payment_id, suggested_payment_id),
         suggested_supplier_payment_id = COALESCE(_supplier_payment_id, suggested_supplier_payment_id)
   WHERE id = _line_id;
END $$;
