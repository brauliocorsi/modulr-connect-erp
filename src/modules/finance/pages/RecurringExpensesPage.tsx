import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Ban, Zap, ExternalLink } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  OperationalDataTable,
  OperationalFiltersBar,
  SummaryCards,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { RecurringExpenseDialog, type RecurringExpense } from "@/modules/finance/components/RecurringExpenseDialog";

type Row = RecurringExpense & {
  active: boolean;
  cancelled_at: string | null;
  last_generated_bill_id: string | null;
  partners?: { name: string } | null;
  payment_methods?: { name: string } | null;
  _status: "active" | "inactive" | "cancelled" | "due" | "upcoming";
};

const FREQ_LABEL: Record<string, string> = {
  weekly: "Semanal", monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual", custom: "Personalizada",
};

function statusBadge(s: Row["_status"]) {
  const map: Record<Row["_status"], { label: string; cls: string }> = {
    active: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    inactive: { label: "Inativa", cls: "bg-muted text-muted-foreground" },
    cancelled: { label: "Cancelada", cls: "bg-destructive/15 text-destructive" },
    due: { label: "Vencida", cls: "bg-destructive/15 text-destructive" },
    upcoming: { label: "Próxima", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  };
  const m = map[s];
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}

export default function RecurringExpensesPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "active" });
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("recurring_expenses")
      .select("id,name,supplier_id,category,amount,frequency,next_due_date,payment_method_id,active,notes,cancelled_at,last_generated_bill_id, partners(name), payment_methods(name)")
      .order("next_due_date", { ascending: true })
      .limit(500);
    if (error) toast.error(error.message);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out: Row[] = (data ?? []).map((r: any) => {
      const due = new Date(r.next_due_date);
      const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
      let _status: Row["_status"];
      if (r.cancelled_at) _status = "cancelled";
      else if (!r.active) _status = "inactive";
      else if (diffDays < 0) _status = "due";
      else if (diffDays <= 7) _status = "upcoming";
      else _status = "active";
      return { ...r, _status };
    });
    setRows(out);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const supplierOpts = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => { if (r.supplier_id && r.partners?.name) map.set(r.supplier_id, r.partners.name); });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const categoryOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.category))).map((c) => ({ value: c, label: c })), [rows]);

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "active", label: "Ativas" },
      { value: "inactive", label: "Inativas" },
      { value: "cancelled", label: "Canceladas" },
      { value: "all", label: "Todas" },
    ] },
    { key: "due", label: "Vencimento", type: "select", options: [
      { value: "due", label: "Vencidas" },
      { value: "upcoming", label: "Próximas 7 dias" },
    ] },
    { key: "frequency", label: "Frequência", type: "select", options: Object.entries(FREQ_LABEL).map(([v, l]) => ({ value: v, label: l })) },
    { key: "category", label: "Categoria", type: "select", options: categoryOpts },
    { key: "supplier", label: "Fornecedor", type: "select", options: supplierOpts, width: "w-56" },
  ], [supplierOpts, categoryOpts]);

  const filtered = useMemo(() => rows.filter((r) => {
    const a = filters.active ?? "active";
    if (a === "active" && (!r.active || r.cancelled_at)) return false;
    if (a === "inactive" && (r.active || r.cancelled_at)) return false;
    if (a === "cancelled" && !r.cancelled_at) return false;
    if (filters.due === "due" && r._status !== "due") return false;
    if (filters.due === "upcoming" && r._status !== "upcoming") return false;
    if (filters.frequency && r.frequency !== filters.frequency) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.supplier && r.supplier_id !== filters.supplier) return false;
    return true;
  }), [rows, filters]);

  const summary = useMemo(() => {
    const activeRows = rows.filter((r) => r.active && !r.cancelled_at);
    return {
      total: activeRows.length,
      monthlyEq: activeRows.reduce((s, r) => {
        const mult = r.frequency === "weekly" ? 4 : r.frequency === "monthly" ? 1
          : r.frequency === "quarterly" ? 1/3 : r.frequency === "yearly" ? 1/12 : 1;
        return s + Number(r.amount) * mult;
      }, 0),
      due: activeRows.filter((r) => r._status === "due").length,
      upcoming: activeRows.filter((r) => r._status === "upcoming").length,
    };
  }, [rows]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (r: Row) => { setEditing(r); setDialogOpen(true); };

  const generateBill = async (r: Row) => {
    if (!r.supplier_id) return toast.error("Defina um fornecedor antes de gerar a conta");
    setBusy(true);
    const { data, error } = await supabase.rpc("recurring_expense_generate_bill", { _expense_id: r.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    const res: any = data;
    if (res?.error) return toast.error(res.error);
    toast.success(res?.idempotent ? "Conta já existia" : "Conta gerada", {
      action: res?.bill_id ? { label: "Abrir", onClick: () => nav(`/finance/payables/${res.bill_id}`) } : undefined,
    });
    load();
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) return toast.error("Motivo obrigatório");
    setBusy(true);
    const { data, error } = await supabase.rpc("recurring_expense_cancel", {
      _expense_id: cancelTarget.id, _reason: cancelReason.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const res: any = data;
    if (res?.error) return toast.error(res.error);
    toast.success("Despesa cancelada");
    setCancelTarget(null); setCancelReason("");
    load();
  };

  return (
    <>
      <PageHeader
        title="Despesas Fixas"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Despesas Fixas" }]}
        actions={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nova despesa</Button>}
      />
      <PageBody>
        <SummaryCards
          className="mb-4"
          items={[
            { key: "total", label: "Ativas", value: String(summary.total) },
            { key: "monthly", label: "Equivalente mensal", value: fmtMoney(summary.monthlyEq), tone: "primary" },
            { key: "due", label: "Vencidas", value: String(summary.due), tone: summary.due ? "danger" : "muted" },
            { key: "upcoming", label: "Próximas 7 dias", value: String(summary.upcoming), tone: summary.upcoming ? "warning" : "muted" },
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
          emptyTitle="Sem despesas fixas"
          columns={[
            { key: "name", header: "Nome", cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: "supplier", header: "Fornecedor", cell: (r) => r.partners?.name ?? <span className="text-muted-foreground">—</span> },
            { key: "category", header: "Categoria", cell: (r) => r.category },
            { key: "amount", header: "Valor", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(Number(r.amount))}</span> },
            { key: "freq", header: "Frequência", cell: (r) => FREQ_LABEL[r.frequency] ?? r.frequency },
            { key: "due", header: "Próxima data", cell: (r) => (
              <span className={r._status === "due" ? "text-destructive font-medium" : ""}>{r.next_due_date}</span>
            ) },
            { key: "method", header: "Método", cell: (r) => r.payment_methods?.name ?? <span className="text-muted-foreground">—</span> },
            { key: "status", header: "Estado", cell: (r) => statusBadge(r._status) },
            { key: "lastBill", header: "Última conta", cell: (r) => r.last_generated_bill_id
              ? <Link to={`/finance/payables/${r.last_generated_bill_id}`} className="text-primary hover:underline text-xs font-mono">Ver</Link>
              : <span className="text-muted-foreground">—</span> },
            { key: "actions", header: "", align: "right", cell: (r) => (
              <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                {r.active && !r.cancelled_at && (
                  <Button size="sm" variant="ghost" title="Gerar conta agora" disabled={busy} onClick={() => generateBill(r)}>
                    <Zap className="h-4 w-4" />
                  </Button>
                )}
                {!r.cancelled_at && (
                  <Button size="sm" variant="ghost" title="Editar" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {!r.cancelled_at && (
                  <Button size="sm" variant="ghost" title="Cancelar despesa" onClick={() => { setCancelTarget(r); setCancelReason(""); }}>
                    <Ban className="h-4 w-4 text-destructive" />
                  </Button>
                )}
                {r.last_generated_bill_id && (
                  <Button size="sm" variant="ghost" title="Abrir última conta" onClick={() => nav(`/finance/payables/${r.last_generated_bill_id}`)}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) },
          ]}
        />
      </PageBody>

      <RecurringExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
        onSaved={load}
      />

      <Dialog open={!!cancelTarget} onOpenChange={(v) => { if (!v) { setCancelTarget(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar despesa fixa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Cancelar {cancelTarget?.name}? A despesa deixa de gerar contas e fica marcada como inativa.
            </p>
            <div>
              <Label>Motivo</Label>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Indique o motivo do cancelamento" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={busy}>Voltar</Button>
            <Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={doCancel}>
              {busy ? "A processar…" : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
