import { useEffect, useMemo, useState } from "react";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/lib/format";

import { toast } from "sonner";

type ReportKey =
  | "payables_by_supplier"
  | "receivables_by_customer"
  | "receipts_by_method"
  | "payments_by_account"
  | "expenses_by_cost_center"
  | "expenses_by_account"
  | "reconciliation_pending"
  | "overdue";

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  { key: "payables_by_supplier", title: "Contas a Pagar por Fornecedor", desc: "Saldos abertos agrupados por fornecedor." },
  { key: "receivables_by_customer", title: "Contas a Receber por Cliente", desc: "Parcelas em aberto por cliente." },
  { key: "receipts_by_method", title: "Recebimentos por Método", desc: "Recebimentos pagos no período." },
  { key: "payments_by_account", title: "Pagamentos por Conta/Diário", desc: "Pagamentos a fornecedor por diário." },
  { key: "expenses_by_cost_center", title: "Despesas por Centro de Custo", desc: "Faturas pagas agrupadas por CC." },
  { key: "expenses_by_account", title: "Despesas por Plano de Contas", desc: "Faturas por conta contábil." },
  { key: "reconciliation_pending", title: "Pendências de Conciliação", desc: "Recebimentos por conciliar." },
  { key: "overdue", title: "Vencidos", desc: "Faturas e parcelas vencidas." },
];

function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return toast.warning("Sem dados");
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function runReport(key: ReportKey) {
  switch (key) {
    case "payables_by_supplier": {
      const { data } = await supabase
        .from("supplier_bills")
        .select("partner_id,amount_total,amount_paid,state,partners(name)")
        .neq("state", "cancelled");
      const map = new Map<string, { fornecedor: string; total: number; pago: number; saldo: number }>();
      (data ?? []).forEach((b: any) => {
        const k = b.partner_id ?? "—";
        const cur = map.get(k) ?? { fornecedor: b.partners?.name ?? "—", total: 0, pago: 0, saldo: 0 };
        cur.total += Number(b.amount_total || 0);
        cur.pago += Number(b.amount_paid || 0);
        cur.saldo = +(cur.total - cur.pago).toFixed(2);
        map.set(k, cur);
      });
      return Array.from(map.values()).sort((a, b) => b.saldo - a.saldo);
    }
    case "receivables_by_customer": {
      const { data } = await supabase
        .from("sale_payment_schedules")
        .select("amount,paid_amount,state,sale_orders(partner_id,partners(name))")
        .neq("state", "paid");
      const map = new Map<string, { cliente: string; aberto: number; parcelas: number }>();
      (data ?? []).forEach((r: any) => {
        const k = r.sale_orders?.partner_id ?? "—";
        const open = Number(r.amount || 0) - Number(r.paid_amount || 0);
        const cur = map.get(k) ?? { cliente: r.sale_orders?.partners?.name ?? "—", aberto: 0, parcelas: 0 };
        cur.aberto += open;
        cur.parcelas += 1;
        map.set(k, cur);
      });
      return Array.from(map.values()).map((r) => ({ ...r, aberto: +r.aberto.toFixed(2) })).sort((a, b) => b.aberto - a.aberto);
    }
    case "receipts_by_method": {
      const { data } = await supabase
        .from("customer_payments")
        .select("amount,state,payment_methods(name)")
        .eq("state", "posted");
      const map = new Map<string, { metodo: string; total: number; nº: number }>();
      (data ?? []).forEach((p: any) => {
        const k = p.payment_methods?.name ?? "—";
        const cur = map.get(k) ?? { metodo: k, total: 0, "nº": 0 };
        cur.total += Number(p.amount || 0); cur["nº"] += 1;
        map.set(k, cur);
      });
      return Array.from(map.values()).map((r) => ({ ...r, total: +r.total.toFixed(2) }));
    }
    case "payments_by_account": {
      const { data } = await supabase
        .from("supplier_payments")
        .select("amount,state,account_journals(name)")
        .eq("state", "posted");
      const map = new Map<string, { conta: string; total: number; nº: number }>();
      (data ?? []).forEach((p: any) => {
        const k = p.account_journals?.name ?? "—";
        const cur = map.get(k) ?? { conta: k, total: 0, "nº": 0 };
        cur.total += Number(p.amount || 0); cur["nº"] += 1;
        map.set(k, cur);
      });
      return Array.from(map.values()).map((r) => ({ ...r, total: +r.total.toFixed(2) }));
    }
    case "expenses_by_cost_center": {
      const { data } = await supabase
        .from("supplier_bills")
        .select("amount_total,state,cost_centers(name)")
        .neq("state", "cancelled");
      const map = new Map<string, { centro: string; total: number }>();
      (data ?? []).forEach((b: any) => {
        const k = b.cost_centers?.name ?? "Sem CC";
        const cur = map.get(k) ?? { centro: k, total: 0 };
        cur.total += Number(b.amount_total || 0);
        map.set(k, cur);
      });
      return Array.from(map.values()).map((r) => ({ ...r, total: +r.total.toFixed(2) })).sort((a, b) => b.total - a.total);
    }
    case "expenses_by_account": {
      const { data } = await supabase
        .from("supplier_bills")
        .select("amount_total,state,chart_of_accounts(code,name)")
        .neq("state", "cancelled");
      const map = new Map<string, { conta: string; total: number }>();
      (data ?? []).forEach((b: any) => {
        const k = b.chart_of_accounts ? `${b.chart_of_accounts.code} — ${b.chart_of_accounts.name}` : "Sem conta";
        const cur = map.get(k) ?? { conta: k, total: 0 };
        cur.total += Number(b.amount_total || 0);
        map.set(k, cur);
      });
      return Array.from(map.values()).map((r) => ({ ...r, total: +r.total.toFixed(2) })).sort((a, b) => b.total - a.total);
    }
    case "reconciliation_pending": {
      const { data } = await supabase
        .from("customer_payments")
        .select("name,payment_date,amount,reconciliation_status,partners(name),payment_methods(name)")
        .in("reconciliation_status", ["pending"]);
      return (data ?? []).map((p: any) => ({
        nº: p.name, data: p.payment_date, cliente: p.partners?.name ?? "—",
        metodo: p.payment_methods?.name ?? "—", valor: +Number(p.amount).toFixed(2),
      }));
    }
    case "overdue": {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: bills }, { data: scheds }] = await Promise.all([
        supabase.from("supplier_bills").select("name,due_date,amount_total,amount_paid,partners(name)").lt("due_date", today).not("state", "in", "(paid,cancelled)"),
        supabase.from("sale_payment_schedules").select("label,due_date,amount,paid_amount,sale_orders(name,partners(name))").lt("due_date", today).neq("state", "paid"),
      ]);
      const a = (bills ?? []).map((b: any) => ({ tipo: "AP", documento: b.name, parte: b.partners?.name ?? "—", vencimento: b.due_date, saldo: +(Number(b.amount_total) - Number(b.amount_paid)).toFixed(2) }));
      const c = (scheds ?? []).map((s: any) => ({ tipo: "AR", documento: s.sale_orders?.name ?? "—", parte: s.sale_orders?.partners?.name ?? "—", vencimento: s.due_date, saldo: +(Number(s.amount) - Number(s.paid_amount)).toFixed(2) }));
      return [...a, ...c].sort((x, y) => (x.vencimento ?? "").localeCompare(y.vencimento ?? ""));
    }
  }
}

export default function FinanceReportsPage() {
  const [selected, setSelected] = useState<ReportKey>("payables_by_supplier");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await runReport(selected);
      setRows(r ?? []);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao gerar relatório");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void run(); /* eslint-disable-next-line */ }, [selected]);

  const cols = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  const def = REPORTS.find((r) => r.key === selected)!;

  return (
    <>
      <PageHeader title="Relatórios Financeiros" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Relatórios" }]} />
      <PageBody>
        <div className="grid md:grid-cols-4 gap-3 mb-4">
          {REPORTS.map((r) => (
            <Card key={r.key}
              className={`p-3 cursor-pointer hover:bg-muted/50 ${selected === r.key ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelected(r.key)}>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{r.desc}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold">{def.title}</h2>
              <p className="text-xs text-muted-foreground">{def.desc}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>Atualizar</Button>
              <Button size="sm" onClick={() => downloadCSV(`${selected}.csv`, rows)} disabled={!rows.length}>
                <Download className="h-4 w-4 mr-1" /> Exportar CSV
              </Button>
            </div>
          </div>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">A carregar…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Sem dados</div>
          ) : (
            <div className="overflow-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>{cols.map((c) => <th key={c} className="text-left px-3 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {cols.map((c) => (
                        <td key={c} className="px-3 py-1.5 tabular-nums">
                          {typeof r[c] === "number" && (c.includes("total") || c.includes("saldo") || c.includes("aberto") || c === "valor") ? fmtMoney(r[c]) : String(r[c] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}
