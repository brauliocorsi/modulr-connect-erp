import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { Receipt, ExternalLink } from "lucide-react";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  OperationalFiltersBar,
  SummaryCards,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";

type Row = {
  id: string;
  order_id: string;
  label: string;
  due_kind: string;
  due_date: string | null;
  due_days: number | null;
  amount: number;
  paid_amount: number;
  state: string;
  order_name: string;
  partner_id: string | null;
  partner_name: string;
  _open: number;
  _overdue: boolean;
  _due_label: string;
};

const dueLabel = (s: any) => {
  if (s.due_kind === "fixed_date") return s.due_date ?? "—";
  if (s.due_kind === "on_confirm") return "Na confirmação";
  if (s.due_kind === "on_delivery") return "Na entrega";
  if (s.due_kind === "days_after_confirm") return `${s.due_days ?? 0}d após`;
  return "—";
};

const isOverdue = (s: any) => s.due_kind === "fixed_date" && s.due_date && new Date(s.due_date) < new Date();

export default function ReceivablesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [picked, setPicked] = useState<{ id: string; partner_id?: string | null; amount: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sale_payment_schedules")
      .select("id,label,due_kind,due_date,due_days,amount,paid_amount,state,order_id, sale_orders(id,name,partner_id, partners(id,name))")
      .neq("state", "paid")
      .order("created_at");
    const out: Row[] = (data ?? []).map((r: any) => {
      const amount = Number(r.amount || 0);
      const paid = Number(r.paid_amount || 0);
      const open = +(amount - paid).toFixed(2);
      const overdue = isOverdue(r);
      return {
        id: r.id,
        order_id: r.order_id,
        label: r.label,
        due_kind: r.due_kind,
        due_date: r.due_date,
        due_days: r.due_days,
        amount,
        paid_amount: paid,
        state: r.state ?? "unpaid",
        order_name: r.sale_orders?.name ?? "—",
        partner_id: r.sale_orders?.partner_id ?? null,
        partner_name: r.sale_orders?.partners?.name ?? "—",
        _open: open,
        _overdue: overdue,
        _due_label: dueLabel(r),
      };
    });
    setRows(out);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const partnerOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.partner_id) map.set(r.partner_id, r.partner_name); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state",
      label: "Estado",
      type: "select",
      options: [
        { value: "unpaid", label: "Por pagar" },
        { value: "partial", label: "Parcial" },
        { value: "paid", label: "Pago" },
      ],
    },
    {
      key: "overdue",
      label: "Vencimento",
      type: "select",
      options: [
        { value: "overdue", label: "Vencidos" },
        { value: "week", label: "Próximos 7 dias" },
        { value: "future", label: "Futuros" },
      ],
    },
    { key: "partner", label: "Cliente", type: "select", options: partnerOptions, width: "w-56" },
  ], [partnerOptions]);

  const filtered = useMemo(() => {
    const inWeek = (r: Row) => r.due_kind === "fixed_date" && r.due_date && new Date(r.due_date) <= new Date(Date.now() + 7 * 86400000);
    return rows.filter((r) => {
      if (filters.state && filters.state !== r.state) return false;
      if (filters.partner && filters.partner !== r.partner_id) return false;
      if (filters.overdue === "overdue" && !r._overdue) return false;
      if (filters.overdue === "week" && (r._overdue || !inWeek(r))) return false;
      if (filters.overdue === "future" && (r._overdue || inWeek(r))) return false;
      return true;
    });
  }, [rows, filters]);

  const summary = useMemo(() => {
    const open = filtered.reduce((s, r) => s + r._open, 0);
    const overdueRows = filtered.filter((r) => r._overdue);
    const overdueAmt = overdueRows.reduce((s, r) => s + r._open, 0);
    const partial = filtered.filter((r) => r.state === "partial");
    return { open, overdueAmt, overdueCount: overdueRows.length, partialCount: partial.length, total: filtered.length };
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Contas a Receber"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "A Receber" }]}
      />
      <PageBody>
        <SummaryCards
          className="mb-4"
          items={[
            { key: "total", label: "Parcelas em aberto", value: String(summary.total) },
            { key: "open", label: "Saldo aberto", value: fmtMoney(summary.open), tone: "primary" },
            { key: "overdue", label: "Vencidos", value: fmtMoney(summary.overdueAmt), hint: `${summary.overdueCount} parcelas`, tone: summary.overdueCount ? "danger" : "muted" },
            { key: "partial", label: "Parciais", value: String(summary.partialCount), tone: "warning" },
          ]}
        />
        <div className="mb-3">
          <OperationalFiltersBar
            filters={filterDefs}
            values={filters}
            onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
            onClear={() => setFilters({})}
          />
        </div>
        <OperationalDataTable
          isLoading={loading}
          rows={filtered}
          getRowId={(r) => r.id}
          emptyTitle="Sem parcelas em aberto"
          columns={[
            { key: "order", header: "Venda", cell: (r) => (
              <Link to={`/sales/orders/${r.order_id}`} className="font-mono text-xs text-primary hover:underline">{r.order_name}</Link>
            ) },
            { key: "partner", header: "Cliente", cell: (r) => r.partner_name },
            { key: "label", header: "Parcela", cell: (r) => r.label },
            { key: "due", header: "Vencimento", cell: (r) => (
              <span className={r._overdue ? "text-destructive font-medium" : ""}>{r._due_label}</span>
            ) },
            { key: "amount", header: "Valor", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.amount)}</span> },
            { key: "paid", header: "Recebido", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.paid_amount)}</span> },
            { key: "open", header: "Saldo", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r._open)}</span> },
            { key: "state", header: "Estado", cell: (r) => (
              <OperationalStatusBadge domain="finance" status={r._overdue && r.state !== "paid" ? "overdue" : r.state} />
            ) },
            { key: "actions", header: "", align: "right", cell: (r) => (
              <div className="flex gap-1 justify-end">
                <Button size="sm" variant="ghost" title="Registar recebimento" onClick={() => setPicked({ id: r.order_id, partner_id: r.partner_id, amount: r._open })}>
                  <Receipt className="h-4 w-4" />
                </Button>
                <Link to={`/sales/orders/${r.order_id}`}>
                  <Button size="sm" variant="ghost" title="Abrir venda"><ExternalLink className="h-4 w-4" /></Button>
                </Link>
              </div>
            ) },
          ]}
        />
      </PageBody>
      {picked && (
        <RegisterPaymentDialog
          open={!!picked}
          onOpenChange={(v) => { if (!v) setPicked(null); }}
          orderId={picked.id}
          partnerId={picked.partner_id}
          defaultAmount={picked.amount}
          onSaved={() => { setPicked(null); load(); }}
        />
      )}
    </>
  );
}
