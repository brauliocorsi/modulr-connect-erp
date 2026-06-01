/**
 * F29 — Fecho do Dia (redesign limpo, branco + azul).
 * Rotas: /finance/daily e /financeiro/fecho-do-dia
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";
import {
  Wallet, AlertTriangle, Truck, CreditCard, RefreshCw, ArrowRight,
} from "lucide-react";

const REFRESH_MS = 60_000;

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-PT") : "—";
const fmtDateLong = (d: Date) =>
  d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
   .replace(/^\w/, (c) => c.toUpperCase());

function hoursAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (diff < 1) return `há ${Math.max(1, Math.floor(diff * 60))}min`;
  if (diff < 24) return `há ${Math.floor(diff)}h`;
  return `há ${Math.floor(diff / 24)}d`;
}

/* ---------- Badge semântica (cores reference visual) ---------- */
type Tone = "green" | "amber" | "red" | "blue" | "gray";
function StateBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const map: Record<Tone, string> = {
    green: "bg-[#DCFCE7] text-[#15803D]",
    amber: "bg-[#FEF3C7] text-[#B45309]",
    red:   "bg-[#FEE2E2] text-[#B91C1C]",
    blue:  "bg-[#DBEAFE] text-[#1D4ED8]",
    gray:  "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

/* ---------- KPI Card ---------- */
function KpiCard({
  label, value, sub, subTone, icon: Icon, loading,
}: {
  label: string; value: string; sub?: string; subTone?: "red" | "muted" | "green";
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  const subColor =
    subTone === "red" ? "text-[#DC2626]" :
    subTone === "green" ? "text-[#16A34A]" :
    "text-muted-foreground";
  return (
    <Card className="p-5 border border-border/60 shadow-none rounded-lg">
      <div className="flex items-start justify-between">
        <div className="space-y-2 min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <div className="text-[36px] leading-none font-semibold tabular-nums">{value}</div>
          )}
          {loading ? (
            <Skeleton className="h-4 w-28" />
          ) : sub ? (
            <div className={`text-sm ${subColor} truncate`}>{sub}</div>
          ) : <div className="h-4" />}
        </div>
        <div className="h-10 w-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

/* ---------- Section Panel ---------- */
function Panel({
  title, icon: Icon, children, action,
}: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <Card className="border border-border/60 shadow-none rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-[#2563EB]" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="text-sm text-muted-foreground text-center py-10">{message}</div>;
}

function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/* ---------- Tipos ---------- */
type CashRegister = { id: string; name: string; store_id: string | null; driver_id: string | null; warehouse_id: string | null };
type OpenSession = {
  id: string; name: string; opened_at: string;
  opening_balance: number; closing_balance_theoretical: number | null;
  route_id?: string | null;
  register: CashRegister | null;
};
type ClosureRow = {
  id: string; route_id: string;
  expected_cash: number; actual_cash: number;
  expected_mbway: number; actual_mbway: number;
  expected_transfer: number; actual_transfer: number;
  expected_other: number; actual_other: number;
  variance: number; reconciled_at: string | null; closed_at: string | null;
  route: { route_date: string; driver_id: string | null; name?: string | null } | null;
};
type SupplierBill = {
  id: string; name: string; amount_total: number; amount_paid: number;
  due_date: string | null; state: string;
  partner: { name: string } | null;
};
type Bnpl = {
  id: string; name: string; cliente: string | null; venda: string | null;
  expected_settlement_date: string; amount_gross: number; amount_net: number;
  fee_amount: number; metodo: string; reconciled_at: string | null;
};

/* ---------- Página ---------- */
export default function DailyClosePage() {
  const [payingBill, setPayingBill] = useState<SupplierBill | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const openSessionsQ = useQuery({
    queryKey: ["fd-open-sessions"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<OpenSession[]> => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id,name,opened_at,opening_balance,closing_balance_theoretical,route_id,register:cash_registers(id,name,store_id,driver_id,warehouse_id)")
        .eq("state", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OpenSession[];
    },
  });

  const closuresQ = useQuery({
    queryKey: ["fd-closures-pending"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<ClosureRow[]> => {
      const { data, error } = await supabase
        .from("delivery_route_cash_closure")
        .select("id,route_id,expected_cash,actual_cash,expected_mbway,actual_mbway,expected_transfer,actual_transfer,expected_other,actual_other,variance,reconciled_at,closed_at,route:delivery_routes(route_date,driver_id,name)")
        .is("reconciled_at", null)
        .order("closed_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClosureRow[];
    },
  });

  const billsQ = useQuery({
    queryKey: ["fd-bills-due"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<SupplierBill[]> => {
      const { data, error } = await supabase
        .from("supplier_bills")
        .select("id,name,amount_total,amount_paid,due_date,state,partner:partners(name)")
        .neq("state", "paid")
        .lte("due_date", today)
        .order("due_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SupplierBill[];
    },
  });

  const bnplQ = useQuery({
    queryKey: ["fd-bnpl-pending"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<Bnpl[]> => {
      const { data, error } = await supabase
        .from("bnpl_pending_settlements" as never)
        .select("id,name,cliente,venda,expected_settlement_date,amount_gross,amount_net,fee_amount,metodo,reconciled_at")
        .is("reconciled_at", null)
        .order("expected_settlement_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Bnpl[];
    },
  });

  const totals = useMemo(() => {
    const sessionsTotal = openSessionsQ.data?.reduce(
      (s, r) => s + Number(r.closing_balance_theoretical ?? r.opening_balance ?? 0), 0) ?? 0;
    const closuresVar = closuresQ.data?.reduce((s, r) => s + Number(r.variance ?? 0), 0) ?? 0;
    const billsDue = billsQ.data?.reduce((s, r) => s + (Number(r.amount_total) - Number(r.amount_paid)), 0) ?? 0;
    const bnplNet = bnplQ.data?.reduce((s, r) => s + Number(r.amount_net ?? 0), 0) ?? 0;
    return { sessionsTotal, closuresVar, billsDue, bnplNet };
  }, [openSessionsQ.data, closuresQ.data, billsQ.data, bnplQ.data]);

  const refreshAll = () => {
    openSessionsQ.refetch();
    closuresQ.refetch();
    billsQ.refetch();
    bnplQ.refetch();
  };

  function registerType(r: CashRegister | null): { label: string; tone: Tone } {
    if (!r) return { label: "—", tone: "gray" };
    if (r.driver_id) return { label: "Entregador", tone: "amber" };
    if (r.store_id) return { label: "Loja", tone: "green" };
    if (r.warehouse_id) return { label: "Armazém", tone: "blue" };
    return { label: "Outro", tone: "gray" };
  }

  return (
    <div className="bg-background min-h-full">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Fecho do Dia</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Painel matinal — caixas, reconciliações, dívidas e liquidações BNPL.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden md:inline">{fmtDateLong(new Date())}</span>
            <Button variant="outline" size="icon" onClick={refreshAll} aria-label="Atualizar">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Caixas Abertas"
            value={String(openSessionsQ.data?.length ?? 0)}
            sub={`saldo teórico ${fmtEUR(totals.sessionsTotal)}`}
            icon={Wallet}
            loading={openSessionsQ.isLoading}
          />
          <KpiCard
            label="Entregas por Reconciliar"
            value={String(closuresQ.data?.length ?? 0)}
            sub={`variância total ${fmtEUR(totals.closuresVar)}`}
            subTone={totals.closuresVar < 0 ? "red" : "muted"}
            icon={Truck}
            loading={closuresQ.isLoading}
          />
          <KpiCard
            label="Contas a Pagar Hoje"
            value={String(billsQ.data?.length ?? 0)}
            sub={fmtEUR(totals.billsDue)}
            subTone={totals.billsDue > 0 ? "red" : "muted"}
            icon={AlertTriangle}
            loading={billsQ.isLoading}
          />
          <KpiCard
            label="BNPL por Liquidar"
            value={String(bnplQ.data?.length ?? 0)}
            sub={`${fmtEUR(totals.bnplNet)} líquido`}
            subTone="green"
            icon={CreditCard}
            loading={bnplQ.isLoading}
          />
        </div>

        {/* Grelha 2 colunas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coluna esquerda — Caixas Abertas */}
          <Panel title="Caixas Abertas" icon={Wallet}>
            {openSessionsQ.isLoading ? (
              <TableSkeleton />
            ) : (openSessionsQ.data?.length ?? 0) === 0 ? (
              <EmptyState message="Nenhuma caixa aberta." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60">
                    <TableHead>Caixa</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Aberta em</TableHead>
                    <TableHead className="text-right">Saldo Teórico</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openSessionsQ.data!.map((s) => {
                    const t = registerType(s.register);
                    return (
                      <TableRow key={s.id} className="border-border/60">
                        <TableCell className="font-medium">{s.register?.name ?? s.name}</TableCell>
                        <TableCell><StateBadge tone={t.tone}>{t.label}</StateBadge></TableCell>
                        <TableCell className="text-sm">
                          {new Date(s.opened_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                          <span className="text-muted-foreground ml-1">({hoursAgo(s.opened_at)})</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEUR(s.closing_balance_theoretical ?? s.opening_balance)}
                        </TableCell>
                        <TableCell>
                          {s.route_id
                            ? <StateBadge tone="amber">Em rota</StateBadge>
                            : <StateBadge tone="green">Aberta</StateBadge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/cashbox/sessions/${s.id}`}>Fechar</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>

          {/* Coluna direita — empilhada */}
          <div className="space-y-6">
            <Panel title="Entregas por Reconciliar" icon={Truck}>
              {closuresQ.isLoading ? (
                <TableSkeleton />
              ) : (closuresQ.data?.length ?? 0) === 0 ? (
                <EmptyState message="Sem reconciliações pendentes." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60">
                      <TableHead className="min-w-[140px]">Rota</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Esperado</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead className="text-right">Variância</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closuresQ.data!.map((c) => {
                      const exp = c.expected_cash + c.expected_mbway + c.expected_transfer + c.expected_other;
                      const real = c.actual_cash + c.actual_mbway + c.actual_transfer + c.actual_other;
                      const neg = Number(c.variance) < 0;
                      return (
                        <TableRow key={c.id} className="border-border/60">
                          <TableCell className="font-medium whitespace-nowrap">
                            {c.route?.name ?? c.route_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>{fmtDate(c.route?.route_date)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtEUR(exp)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtEUR(real)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${neg ? "text-[#DC2626] font-semibold" : ""}`}>
                            {fmtEUR(c.variance)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/delivery/routes/${c.route_id}/cash-close`}>
                                Reconciliar <ArrowRight className="h-3 w-3" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Panel>

            <Panel title="Contas a Pagar" icon={AlertTriangle}>
              {billsQ.isLoading ? (
                <TableSkeleton />
              ) : (billsQ.data?.length ?? 0) === 0 ? (
                <EmptyState message="Sem contas a pagar pendentes." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60">
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billsQ.data!.map((b) => {
                      const overdue = b.due_date && b.due_date < today;
                      const dueToday = b.due_date === today;
                      const tone: Tone = overdue ? "red" : dueToday ? "amber" : "amber";
                      const label = overdue ? "Vencida" : "Pendente";
                      const remaining = Number(b.amount_total) - Number(b.amount_paid);
                      return (
                        <TableRow key={b.id} className="border-border/60">
                          <TableCell className="font-medium">
                            <Link className="hover:underline" to={`/finance/payables/${b.id}`}>
                              {b.partner?.name ?? "—"}
                            </Link>
                            <div className="text-xs text-muted-foreground font-mono">{b.name}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtEUR(remaining)}</TableCell>
                          <TableCell className={overdue ? "text-[#DC2626] font-medium" : ""}>{fmtDate(b.due_date)}</TableCell>
                          <TableCell><StateBadge tone={tone}>{label}</StateBadge></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => setPayingBill(b)} className="bg-[#2563EB] hover:bg-[#1D4ED8]">
                              Pagar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Panel>
          </div>
        </div>

        {/* BNPL (largura total) */}
        <div className="mt-6">
          <Panel title="BNPL Pendente (Scalapay / Sequra)" icon={CreditCard}>
            {bnplQ.isLoading ? (
              <TableSkeleton />
            ) : (bnplQ.data?.length ?? 0) === 0 ? (
              <EmptyState message="Nenhum pagamento BNPL pendente." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60">
                    <TableHead>Venda</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor Bruto</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead>Data Prevista</TableHead>
                    <TableHead>Método</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bnplQ.data!.map((r) => (
                    <TableRow key={r.id} className="border-border/60">
                      <TableCell className="font-mono text-xs">{r.venda ?? r.name}</TableCell>
                      <TableCell>{r.cliente ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEUR(r.amount_gross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">−{fmtEUR(r.fee_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-[#15803D]">
                        {fmtEUR(r.amount_net)}
                      </TableCell>
                      <TableCell>{fmtDate(r.expected_settlement_date)}</TableCell>
                      <TableCell><StateBadge tone="blue">{r.metodo}</StateBadge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      </div>

      {payingBill && (
        <RegisterSupplierPaymentDialog
          open={!!payingBill}
          onOpenChange={(v) => !v && setPayingBill(null)}
          billId={payingBill.id}
          defaultAmount={Number(payingBill.amount_total) - Number(payingBill.amount_paid)}
          onSaved={() => {
            setPayingBill(null);
            billsQ.refetch();
          }}
        />
      )}
    </div>
  );
}
