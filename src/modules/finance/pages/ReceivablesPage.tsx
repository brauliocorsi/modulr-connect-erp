import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtMoney } from "@/lib/format";
import { Receipt, ExternalLink, Banknote, Upload } from "lucide-react";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  OperationalFiltersBar,
  SummaryCards as _SummaryCards,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";
import { FinanceHero } from "@/core/finance/FinanceHero";

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
  store_id: string | null;
  store_name: string;
  salesperson_id: string | null;
  salesperson_name: string;
  method: string;
  origin: "balcao" | "delivery" | "banco" | "credito";
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

const ORIGIN_LABEL: Record<string, string> = {
  balcao: "Venda balcão",
  delivery: "Entrega/Rota",
  banco: "Banco/Conciliação",
  credito: "Crédito",
};

type TabKey = "all" | "balcao" | "delivery" | "banco" | "overdue" | "paid";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "balcao", label: "Vendas balcão" },
  { key: "delivery", label: "Entregas" },
  { key: "banco", label: "Banco/Conciliação" },
  { key: "overdue", label: "Vencidos" },
  { key: "paid", label: "Pagos/Confirmados" },
];

export default function ReceivablesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("all");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [picked, setPicked] = useState<{ id: string; partner_id?: string | null; amount: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sale_payment_schedules")
      .select("id,label,due_kind,due_date,due_days,amount,paid_amount,state,order_id, sale_orders(id,name,partner_id,store_id,salesperson_id, partners(id,name), stores(id,name))")
      .order("created_at");

    // pull recent customer_payments to infer method/origin per order
    const orderIds = Array.from(new Set((data ?? []).map((r: any) => r.order_id).filter(Boolean)));
    const [{ data: payments }, { data: salespeople }] = await Promise.all([
      orderIds.length
        ? supabase.from("customer_payments").select("order_id, payment_method_id, journal_id, source, state, payment_methods(name), account_journals(type)").in("order_id", orderIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("profiles").select("id,display_name,email"),
    ]);
    const payByOrder = new Map<string, any>();
    (payments ?? []).forEach((p: any) => { if (!payByOrder.has(p.order_id)) payByOrder.set(p.order_id, p); });
    const spById = new Map((salespeople ?? []).map((p: any) => [p.id, p.display_name ?? p.email ?? "—"]));

    const out: Row[] = (data ?? []).map((r: any) => {
      const amount = Number(r.amount || 0);
      const paid = Number(r.paid_amount || 0);
      const open = +(amount - paid).toFixed(2);
      const overdue = r.due_kind === "fixed_date" && r.due_date && new Date(r.due_date) < new Date() && r.state !== "paid";
      const pay = payByOrder.get(r.order_id);
      const journalType = pay?.account_journals?.type;
      let origin: Row["origin"] = "balcao";
      if (journalType === "bank") origin = "banco";
      else if (r.due_kind === "on_delivery") origin = "delivery";
      else if (r.due_kind?.startsWith("days_after")) origin = "credito";
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
        store_id: r.sale_orders?.store_id ?? null,
        store_name: r.sale_orders?.stores?.name ?? "—",
        salesperson_id: r.sale_orders?.salesperson_id ?? null,
        salesperson_name: r.sale_orders?.salesperson_id ? (spById.get(r.sale_orders.salesperson_id) ?? "—") : "—",
        method: pay?.payment_methods?.name ?? "—",
        origin,
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
  const storeOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.store_id) map.set(r.store_id, r.store_name); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const salespersonOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.salesperson_id) map.set(r.salesperson_id, r.salesperson_name); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const methodOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.method && r.method !== "—") set.add(r.method); });
    return Array.from(set).map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state", label: "Estado", type: "select",
      options: [
        { value: "unpaid", label: "Por pagar" },
        { value: "partial", label: "Parcial" },
        { value: "paid", label: "Pago" },
      ],
    },
    {
      key: "origin", label: "Origem", type: "select",
      options: Object.entries(ORIGIN_LABEL).map(([value, label]) => ({ value, label })),
    },
    { key: "partner", label: "Cliente", type: "select", options: partnerOptions, width: "w-56" },
    { key: "store", label: "Loja", type: "select", options: storeOptions, width: "w-44" },
    { key: "salesperson", label: "Vendedor", type: "select", options: salespersonOptions, width: "w-44" },
    { key: "method", label: "Método", type: "select", options: methodOptions, width: "w-44" },
  ], [partnerOptions, storeOptions, salespersonOptions, methodOptions]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // tab
      if (tab === "balcao" && r.origin !== "balcao") return false;
      if (tab === "delivery" && r.origin !== "delivery") return false;
      if (tab === "banco" && r.origin !== "banco") return false;
      if (tab === "overdue" && !r._overdue) return false;
      if (tab === "paid" && r.state !== "paid") return false;
      if (tab !== "paid" && tab !== "all" && r.state === "paid") return false;
      // filters
      if (filters.state && filters.state !== r.state) return false;
      if (filters.partner && filters.partner !== r.partner_id) return false;
      if (filters.origin && filters.origin !== r.origin) return false;
      if (filters.store && filters.store !== r.store_id) return false;
      if (filters.salesperson && filters.salesperson !== r.salesperson_id) return false;
      if (filters.method && filters.method !== r.method) return false;
      return true;
    });
  }, [rows, filters, tab]);

  const summary = useMemo(() => {
    const open = filtered.reduce((s, r) => s + r._open, 0);
    const overdueRows = filtered.filter((r) => r._overdue);
    const overdueAmt = overdueRows.reduce((s, r) => s + r._open, 0);
    return { open, overdueAmt, overdueCount: overdueRows.length, total: filtered.length };
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Contas a Receber"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "A Receber" }]}
      />
      <PageBody>
        <FinanceHero
          eyebrow="Tesouraria · A Receber"
          title="Contas a Receber"
          subtitle="Parcelas de vendas, entregas, crédito e conciliação bancária — selecione por método para reconciliar com o extrato."
          actions={
            <Link to="/finance/bank-import">
              <Button
                variant="outline"
                size="sm"
              >
                <Upload className="h-4 w-4 mr-1" /> Importar extrato bancário
              </Button>
            </Link>
          }
          kpis={[
            { key: "total", label: "Parcelas", value: String(summary.total) },
            { key: "open", label: "Saldo aberto", value: fmtMoney(summary.open), tone: "gold" },
            { key: "overdue", label: "Vencidos", value: fmtMoney(summary.overdueAmt), hint: `${summary.overdueCount} parcelas`, tone: summary.overdueCount ? "danger" : "muted" },
          ]}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mb-3">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
          emptyTitle="Sem parcelas"
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
            { key: "method", header: "Método", cell: (r) => <span className="text-xs">{r.method}</span> },
            { key: "origin", header: "Origem", cell: (r) => <span className="text-xs">{ORIGIN_LABEL[r.origin]}</span> },
            { key: "store", header: "Loja", cell: (r) => <span className="text-xs">{r.store_name}</span> },
            { key: "salesperson", header: "Vendedor", cell: (r) => <span className="text-xs">{r.salesperson_name}</span> },
            { key: "state", header: "Estado", cell: (r) => (
              <OperationalStatusBadge domain="finance" status={r._overdue && r.state !== "paid" ? "overdue" : r.state} />
            ) },
            { key: "actions", header: "", align: "right", cell: (r) => (
              <div className="flex gap-1 justify-end">
                {r.state !== "paid" && (
                  <Button size="sm" variant="ghost" title="Registar recebimento" onClick={() => setPicked({ id: r.order_id, partner_id: r.partner_id, amount: r._open })}>
                    <Receipt className="h-4 w-4" />
                  </Button>
                )}
                {r.origin === "banco" && (
                  <Link to="/finance/reconciliation"><Button size="sm" variant="ghost" title="Conciliação"><Banknote className="h-4 w-4" /></Button></Link>
                )}
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
