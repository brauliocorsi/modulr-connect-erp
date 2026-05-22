/**
 * F28-FIN Entrega C — Shared CC + Plano de Contas picker.
 * Used across BillForm, RecurringExpense, RegisterPayment dialogs, sales, purchases, cash.
 *
 * Rule:
 *  - required=true → bloqueia submit sem CC + conta (despesas/AP)
 *  - required=false → opcional, sugerido via defaults
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CostCenterOpt = { id: string; code: string; name: string };
export type AccountOpt = { id: string; code: string; name: string; type: string };

export type FinanceContext = {
  storeId?: string | null;
  methodId?: string | null;
  supplierId?: string | null;
};

export type CostCenterAccountValue = {
  cost_center_id: string | null;
  account_id: string | null;
};

interface Props {
  value: CostCenterAccountValue;
  onChange: (v: CostCenterAccountValue) => void;
  required?: boolean;
  context?: FinanceContext;
  disabled?: boolean;
  /** Filtrar contas por tipo. Default: expense,liability,asset */
  accountTypes?: string[];
  compact?: boolean;
  className?: string;
  /** Quando true, mostra origem da sugestão como texto auxiliar */
  showHints?: boolean;
}

const NONE = "__none__";

export function CostCenterAccountPicker({
  value, onChange, required = false, context, disabled = false,
  accountTypes = ["expense", "liability", "asset", "revenue"],
  compact = false, className, showHints = true,
}: Props) {
  const [centers, setCenters] = useState<CostCenterOpt[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [hint, setHint] = useState<{ cc?: string; acc?: string }>({});

  useEffect(() => {
    (async () => {
      const [{ data: cc }, { data: ac }] = await Promise.all([
        supabase.from("cost_centers").select("id,code,name").eq("active", true).order("code"),
        supabase.from("chart_of_accounts").select("id,code,name,type").eq("active", true).in("type", accountTypes).order("code"),
      ]);
      setCenters((cc ?? []) as CostCenterOpt[]);
      setAccounts((ac ?? []) as AccountOpt[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountTypes.join(",")]);

  // Apply defaults from context if value is empty
  useEffect(() => {
    if (!context) return;
    if (value.cost_center_id && value.account_id) return;

    (async () => {
      const patch: Partial<CostCenterAccountValue> = {};
      const newHint: { cc?: string; acc?: string } = {};

      if (!value.cost_center_id && context.storeId) {
        const { data: s } = await supabase.from("stores").select("default_cost_center_id, name").eq("id", context.storeId).maybeSingle();
        if (s?.default_cost_center_id) {
          patch.cost_center_id = s.default_cost_center_id;
          newHint.cc = `Sugerido pela loja ${s.name ?? ""}`.trim();
        }
      }
      if (!value.account_id && context.methodId) {
        const { data: m } = await supabase.from("payment_methods").select("default_account_id, name").eq("id", context.methodId).maybeSingle();
        if (m?.default_account_id) {
          patch.account_id = m.default_account_id;
          newHint.acc = `Sugerido pelo método ${m.name ?? ""}`.trim();
        }
      }
      if (!value.account_id && !patch.account_id && context.supplierId) {
        const { data: p } = await supabase.from("partners").select("default_expense_account_id, name").eq("id", context.supplierId).maybeSingle();
        if (p?.default_expense_account_id) {
          patch.account_id = p.default_expense_account_id;
          newHint.acc = `Sugerido pelo fornecedor ${p.name ?? ""}`.trim();
        }
      }

      if (Object.keys(patch).length) {
        onChange({ ...value, ...patch });
        setHint(newHint);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.storeId, context?.methodId, context?.supplierId]);

  const star = required ? <span className="text-destructive ml-0.5">*</span> : null;

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2", className)}>
      <div>
        <Label className="text-xs">Centro de Custo{star}</Label>
        <Select
          value={value.cost_center_id ?? NONE}
          onValueChange={(v) => onChange({ ...value, cost_center_id: v === NONE ? null : v })}
          disabled={disabled}
        >
          <SelectTrigger className={cn(required && !value.cost_center_id && "border-destructive/50")}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {!required && <SelectItem value={NONE}>— Nenhum —</SelectItem>}
            {centers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="font-mono text-xs mr-1">{c.code}</span> · {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showHints && hint.cc && <div className="text-[10px] text-muted-foreground mt-0.5">{hint.cc}</div>}
      </div>
      <div>
        <Label className="text-xs">Plano de Contas{star}</Label>
        <Select
          value={value.account_id ?? NONE}
          onValueChange={(v) => onChange({ ...value, account_id: v === NONE ? null : v })}
          disabled={disabled}
        >
          <SelectTrigger className={cn(required && !value.account_id && "border-destructive/50")}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {!required && <SelectItem value={NONE}>— Nenhuma —</SelectItem>}
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="font-mono text-xs mr-1">{a.code}</span> · {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showHints && hint.acc && <div className="text-[10px] text-muted-foreground mt-0.5">{hint.acc}</div>}
      </div>
    </div>
  );
}

export function isCostCenterAccountValid(v: CostCenterAccountValue, required: boolean): boolean {
  if (!required) return true;
  return !!(v.cost_center_id && v.account_id);
}
