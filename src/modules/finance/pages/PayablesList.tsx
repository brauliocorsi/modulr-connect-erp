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
  SummaryCards,
  ConfirmActionDialog,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";

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
  _open: number;
  _overdue: boolean;
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
    const { data } = await supabase
      .from("supplier_bills")
      .select("id,name,bill_date,due_date,amount_total,amount_paid,state,partner_id,purchase_order_id, partners(id,name), purchase_orders(id,name)")
      .order("bill_date", { ascending: false })
      .limit(500);
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
        partner_name: b.partners?.name ?? "—",
        po_id: b.purchase_order_id,
        po_name: b.purchase_orders?.name ?? null,
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

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state",
      label: "Estado",
      type: "select",
      options: [
        { value: "draft", label: "Rascunho" },
        { value: "posted", label: "Lançada" },
        { value: "partial", label: "Parcial" },
        { value: "paid", label: "Paga" },
        { value: "cancelled", label: "Cancelada" },
      ],
    },
    {
      key: "overdue",
      label: "Vencimento",
      type: "select",
      options: [
        { value: "overdue", label: "Vencidas" },
        { value: "open", label: "Em aberto" },
      ],
    },
    { key: "partner", label: "Fornecedor", type: "select", options: partnerOptions, width: "w-56" },
  ], [partnerOptions]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filters.state && filters.state !== r.state) return false;
    if (filters.partner && filters.partner !== r.partner_id) return false;
    if (filters.overdue === "overdue" && !r._overdue) return false;
    if (filters.overdue === "open" && (["paid", "cancelled"].includes(r.state))) return false;
    return true;
  }), [rows, filters]);

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
        actions={<Button size="sm" onClick={() => nav("/finance/payables/new")}><Plus className="h-4 w-4 mr-1" /> Nova fatura</Button>}
      />
      <PageBody>
        <SummaryCards
          className="mb-4"
          items={[
            { key: "count", label: "Faturas", value: String(summary.count) },
            { key: "open", label: "Saldo aberto", value: fmtMoney(summary.open), tone: "primary" },
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
        onConfirm={() => cancelTarget && cancelBill(cancelTarget)}
      />
    </>
  );
}
