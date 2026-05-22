import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Receipt, ExternalLink, Ban } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  OperationalFiltersBar,
  SummaryCards as _SummaryCards,
  ConfirmActionDialog,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";
import { FinanceHero } from "@/core/finance/FinanceHero";

type Row = {
  id: string;
  name: string;
  bill_date: string;
  due_date: string | null;
  amount_total: number;
  amount_paid: number;
  state: string;
  partner_id: string | null;
  partner_name: string;
  po_id: string | null;
  po_name: string | null;
  source: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  account_id: string | null;
  account_label: string | null;
  _open: number;
  _overdue: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  purchase_order: "PO",
  recurring_expense: "Despesa fixa",
  service: "Serviço",
  sale: "Venda",
};

export default function PayablesList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [picked, setPicked] = useState<{ id: string; partner_id?: string | null; amount: number } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_bills")
      .select("id,name,bill_date,due_date,amount_total,amount_paid,state,partner_id,purchase_order_id,source,cost_center_id,account_id")
      .order("bill_date", { ascending: false })
      .limit(500);
    if (error) {
      setRows([]);
      setLoading(false);
      toast.error(`Erro ao carregar faturas: ${error.message}`);
      return;
    }

    const partnerIds = Array.from(new Set((data ?? []).map((b: any) => b.partner_id).filter(Boolean)));
    const poIds = Array.from(new Set((data ?? []).map((b: any) => b.purchase_order_id).filter(Boolean)));
    const ccIds = Array.from(new Set((data ?? []).map((b: any) => b.cost_center_id).filter(Boolean)));
    const accIds = Array.from(new Set((data ?? []).map((b: any) => b.account_id).filter(Boolean)));
    const [{ data: partners }, { data: pos }, { data: ccs }, { data: accs }] = await Promise.all([
      partnerIds.length
        ? supabase.from("partners").select("id,name").in("id", partnerIds)
        : Promise.resolve({ data: [] as any[] }),
      poIds.length
        ? supabase.from("purchase_orders").select("id,name").in("id", poIds)
        : Promise.resolve({ data: [] as any[] }),
      ccIds.length
        ? supabase.from("cost_centers").select("id,name,code").in("id", ccIds)
        : Promise.resolve({ data: [] as any[] }),
      accIds.length
        ? supabase.from("chart_of_accounts").select("id,name,code").in("id", accIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const partnerById = new Map((partners ?? []).map((p: any) => [p.id, p.name]));
    const poById = new Map((pos ?? []).map((po: any) => [po.id, po.name]));
    const ccById = new Map((ccs ?? []).map((c: any) => [c.id, c.code ? `${c.code} · ${c.name}` : c.name]));
    const accById = new Map((accs ?? []).map((a: any) => [a.id, a.code ? `${a.code} · ${a.name}` : a.name]));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: Row[] = (data ?? []).map((b: any) => {
      const total = Number(b.amount_total || 0);
      const paid = Number(b.amount_paid || 0);
      return {
        id: b.id,
        name: b.name,
        bill_date: b.bill_date,
        due_date: b.due_date,
        amount_total: total,
        amount_paid: paid,
        state: b.state,
        partner_id: b.partner_id,
        partner_name: partnerById.get(b.partner_id) ?? "—",
        po_id: b.purchase_order_id,
        po_name: poById.get(b.purchase_order_id) ?? null,
        source: b.source ?? "manual",
        cost_center_id: b.cost_center_id,
        cost_center_name: b.cost_center_id ? (ccById.get(b.cost_center_id) ?? null) : null,
        account_id: b.account_id,
        account_label: b.account_id ? (accById.get(b.account_id) ?? null) : null,
        _open: +(total - paid).toFixed(2),
        _overdue: !!b.due_date && new Date(b.due_date) < today && !["paid", "cancelled"].includes(b.state),
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

  const ccOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.cost_center_id && r.cost_center_name) map.set(r.cost_center_id, r.cost_center_name); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const accOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.account_id && r.account_label) map.set(r.account_id, r.account_label); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state", label: "Estado", type: "select",
      options: [
        { value: "draft", label: "Rascunho" },
        { value: "posted", label: "Lançada" },
        { value: "partial", label: "Parcial" },
        { value: "paid", label: "Paga" },
        { value: "cancelled", label: "Cancelada" },
      ],
    },
    {
      key: "overdue", label: "Vencimento", type: "select",
      options: [
        { value: "overdue", label: "Vencidas" },
        { value: "open", label: "Em aberto" },
        { value: "week", label: "Próximos 7 dias" },
      ],
    },
    {
      key: "source", label: "Origem", type: "select",
      options: Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })),
    },
    { key: "partner", label: "Fornecedor", type: "select", options: partnerOptions, width: "w-56" },
    { key: "cost_center", label: "Centro de custo", type: "select", options: ccOptions, width: "w-56" },
    { key: "account", label: "Conta", type: "select", options: accOptions, width: "w-56" },
  ], [partnerOptions, ccOptions, accOptions]);

  const filtered = useMemo(() => {
    const inWeek = (r: Row) => !!r.due_date && new Date(r.due_date) <= new Date(Date.now() + 7 * 86400000);
    return rows.filter((r) => {
      if (filters.state && filters.state !== r.state) return false;
      if (filters.partner && filters.partner !== r.partner_id) return false;
      if (filters.source && filters.source !== r.source) return false;
      if (filters.cost_center && filters.cost_center !== r.cost_center_id) return false;
      if (filters.account && filters.account !== r.account_id) return false;
      if (filters.overdue === "overdue" && !r._overdue) return false;
      if (filters.overdue === "open" && (["paid", "cancelled"].includes(r.state))) return false;
      if (filters.overdue === "week" && (["paid", "cancelled"].includes(r.state) || !inWeek(r))) return false;
      return true;
    });
  }, [rows, filters]);


  const summary = useMemo(() => {
    const open = filtered.filter((r) => !["paid", "cancelled"].includes(r.state));
    const openAmt = open.reduce((s, r) => s + r._open, 0);
    const overdue = open.filter((r) => r._overdue);
    return {
      count: filtered.length,
      open: openAmt,
      overdue: overdue.reduce((s, r) => s + r._open, 0),
      overdueCount: overdue.length,
    };
  }, [filtered]);

  const cancelBill = async (row: Row) => {
    setCancelling(true);
    const { error } = await supabase.rpc("supplier_bill_cancel", {
      _bill_id: row.id,
      _reason: "Cancelada via lista de contas a pagar",
    });
    setCancelling(false);
    if (error) return toast.error(error.message);
    toast.success("Fatura cancelada");
    setCancelTarget(null);
    load();
  };

  return (
    <>
      <PageHeader
        title="Contas a Pagar"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Contas a Pagar" }]}
      />
      <PageBody>
        <FinanceHero
          eyebrow="Tesouraria · A Pagar"
          title="Contas a Pagar"
          subtitle="Gestão de faturas de fornecedores, despesas fixas e ordens de compra com centro de custo e plano de contas."
          actions={
            <Button
              size="sm"
              onClick={() => nav("/finance/payables/new")}
              className="bg-[hsl(var(--finance-accent))] text-[hsl(162_86%_10%)] hover:bg-[hsl(var(--finance-accent))]/90 border-0"
            >
              <Plus className="h-4 w-4 mr-1" /> Nova fatura
            </Button>
          }
          kpis={[
            { key: "count", label: "Faturas", value: String(summary.count) },
            { key: "open", label: "Saldo aberto", value: fmtMoney(summary.open), tone: "gold" },
            { key: "overdue", label: "Vencidas", value: fmtMoney(summary.overdue), hint: `${summary.overdueCount} faturas`, tone: summary.overdueCount ? "danger" : "muted" },
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
          emptyTitle="Sem faturas"
          onRowClick={(r) => nav(`/finance/payables/${r.id}`)}
          columns={[
            { key: "name", header: "Nº", cell: (r) => <span className="font-mono text-xs">{r.name}</span> },
            { key: "partner", header: "Fornecedor", cell: (r) => r.partner_name },
            { key: "po", header: "PO", cell: (r) => r.po_id
              ? <Link to={`/purchase/orders/${r.po_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline font-mono text-xs">{r.po_name}</Link>
              : <span className="text-muted-foreground">—</span> },
            { key: "bill_date", header: "Data", cell: (r) => r.bill_date },
            { key: "due", header: "Vencimento", cell: (r) => (
              <span className={r._overdue ? "text-destructive font-medium" : ""}>{r.due_date ?? "—"}</span>
            ) },
            { key: "total", header: "Total", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.amount_total)}</span> },
            { key: "paid", header: "Pago", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.amount_paid)}</span> },
            { key: "open", header: "Saldo", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r._open)}</span> },
            { key: "source", header: "Origem", cell: (r) => <span className="text-xs">{SOURCE_LABEL[r.source] ?? r.source}</span> },
            { key: "cc", header: "C. custo", cell: (r) => r.cost_center_name
              ? <span className="text-xs">{r.cost_center_name}</span>
              : <span className="text-muted-foreground text-xs">—</span> },
            { key: "acc", header: "Conta", cell: (r) => r.account_label
              ? <span className="text-xs">{r.account_label}</span>
              : <span className="text-muted-foreground text-xs">—</span> },
            { key: "state", header: "Estado", cell: (r) => (
              <OperationalStatusBadge domain="supplier_bill" status={r._overdue ? "overdue" : r.state} />
            ) },
            { key: "actions", header: "", align: "right", cell: (r) => (
              <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                {!["paid", "cancelled"].includes(r.state) && r._open > 0 && (
                  <Button size="sm" variant="ghost" title="Pagar" onClick={() => setPicked({ id: r.id, partner_id: r.partner_id, amount: r._open })}>
                    <Receipt className="h-4 w-4" />
                  </Button>
                )}
                {!["paid", "cancelled"].includes(r.state) && (
                  <Button size="sm" variant="ghost" title="Cancelar fatura" onClick={() => setCancelTarget(r)}>
                    <Ban className="h-4 w-4 text-destructive" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" title="Abrir" onClick={() => nav(`/finance/payables/${r.id}`)}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            ) },
          ]}
        />
      </PageBody>
      {picked && (
        <RegisterSupplierPaymentDialog
          open={!!picked}
          onOpenChange={(v) => { if (!v) setPicked(null); }}
          billId={picked.id}
          partnerId={picked.partner_id}
          defaultAmount={picked.amount}
          onSaved={() => { setPicked(null); load(); }}
        />
      )}
      <ConfirmActionDialog
        open={!!cancelTarget}
        onOpenChange={(v) => { if (!v) setCancelTarget(null); }}
        title="Cancelar fatura"
        description={cancelTarget ? `Cancelar fatura ${cancelTarget.name}? Esta ação reverte movimentos pendentes.` : ""}
        confirmLabel="Cancelar fatura"
        destructive
        loading={cancelling}
        onConfirm={() => { if (cancelTarget) void cancelBill(cancelTarget); }}
      />
    </>
  );
}
