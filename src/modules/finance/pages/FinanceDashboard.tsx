/**
 * F28-FIN Entrega C — Dashboard Financeiro v2
 * Paleta Emerald Prestige · KPI executivos · gráficos recharts · drilldown
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import {
  Receipt, Wallet, AlertTriangle, ArrowDownToLine, Scale, TrendingUp,
  TrendingDown, Building2, Users, FileWarning, ArrowUpRight, Activity,
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";

type Stats = {
  receivable: number;
  payable: number;
  overdue_recv: number;
  overdue_pay: number;
  openSessions: number;
  pending: number;
  cashToday: number;
  loading: boolean;
};

type FlowPoint = { date: string; in: number; out: number; net: number };
type TopRow = { name: string; amount: number };
type DonutSlice = { name: string; value: number };

const EMERALD = "hsl(var(--finance-primary))";
const GOLD = "hsl(var(--finance-accent))";
const SOFT = "hsl(var(--finance-primary-glow))";

export default function FinanceDashboard() {
  const [stats, setStats] = useState<Stats>({
    receivable: 0, payable: 0, overdue_recv: 0, overdue_pay: 0,
    openSessions: 0, pending: 0, cashToday: 0, loading: true,
  });
  const [flow, setFlow] = useState<FlowPoint[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<TopRow[]>([]);
  const [topDebtors, setTopDebtors] = useState<TopRow[]>([]);
  const [byCC, setByCC] = useState<DonutSlice[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; label: string; amount: number; due: string; kind: "ap" | "ar" }[]>([]);
  const [range, setRange] = useState<7 | 30 | 90>(30);

  useEffect(() => {
    (async () => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const since = new Date(today); since.setDate(since.getDate() - range);

      const [
        { data: rcv }, { data: pay }, { data: open }, { data: pend },
        { data: payIn }, { data: payOut }, { data: cashMov },
        { data: bills }, { data: ccData },
      ] = await Promise.all([
        supabase.from("sale_payment_schedules").select("amount,paid_amount,due_kind,due_date,state"),
        supabase.from("supplier_bills").select("id,amount_total,amount_paid,due_date,state,partners(name)"),
        supabase.from("cash_sessions").select("id,opening_balance").eq("state", "open"),
        supabase.from("customer_payments").select("id").in("state", ["pending", "pending_delivery"]),
        supabase.from("customer_payments").select("amount,payment_date").eq("state", "confirmed").gte("payment_date", since.toISOString().slice(0, 10)),
        supabase.from("supplier_payments").select("amount,payment_date").eq("state", "confirmed").gte("payment_date", since.toISOString().slice(0, 10)),
        supabase.from("cash_movements").select("amount,direction,created_at").gte("created_at", today.toISOString()),
        supabase.from("supplier_bills").select("amount_total,amount_paid,due_date,state,partners(name),cost_center_id,cost_centers(name)").not("state", "in", "(paid,cancelled)").not("due_date", "is", null),
        supabase.from("customer_payments").select("amount,customer_id,partners:customer_id(name),state").eq("state", "pending"),
      ]);

      // ---- KPIs ----
      const recvAll = (rcv ?? []).filter((s: any) => s.state !== "paid");
      const recvOpen = recvAll.reduce((s, x: any) => s + (Number(x.amount) - Number(x.paid_amount)), 0);
      const recvOverdue = recvAll.filter((s: any) => s.due_kind === "fixed_date" && s.due_date && new Date(s.due_date) < today)
        .reduce((s, x: any) => s + (Number(x.amount) - Number(x.paid_amount)), 0);
      const paysAll = (pay ?? []).filter((b: any) => !["paid", "cancelled"].includes(b.state));
      const payOpen = paysAll.reduce((s, b: any) => s + (Number(b.amount_total) - Number(b.amount_paid)), 0);
      const payOverdue = paysAll.filter((b: any) => b.due_date && new Date(b.due_date) < today)
        .reduce((s, b: any) => s + (Number(b.amount_total) - Number(b.amount_paid)), 0);
      const cashToday = (cashMov ?? []).reduce((s: number, m: any) => s + (m.direction === "in" ? Number(m.amount) : -Number(m.amount)), 0);

      setStats({
        receivable: recvOpen, payable: payOpen,
        overdue_recv: recvOverdue, overdue_pay: payOverdue,
        openSessions: (open ?? []).length, pending: (pend ?? []).length,
        cashToday, loading: false,
      });

      // ---- Fluxo de caixa ----
      const buckets = new Map<string, FlowPoint>();
      for (let i = 0; i <= range; i++) {
        const d = new Date(since); d.setDate(d.getDate() + i);
        const k = d.toISOString().slice(0, 10);
        buckets.set(k, { date: k.slice(5), in: 0, out: 0, net: 0 });
      }
      (payIn ?? []).forEach((p: any) => {
        const k = String(p.payment_date).slice(0, 10);
        const b = buckets.get(k); if (b) b.in += Number(p.amount);
      });
      (payOut ?? []).forEach((p: any) => {
        const k = String(p.payment_date).slice(0, 10);
        const b = buckets.get(k); if (b) b.out += Number(p.amount);
      });
      const flowArr = Array.from(buckets.values()).map((b) => ({ ...b, net: b.in - b.out }));
      setFlow(flowArr);

      // ---- Top fornecedores (em aberto) ----
      const supMap = new Map<string, number>();
      (bills ?? []).forEach((b: any) => {
        const name = b.partners?.name ?? "—";
        const open = Number(b.amount_total) - Number(b.amount_paid);
        supMap.set(name, (supMap.get(name) ?? 0) + open);
      });
      setTopSuppliers(Array.from(supMap.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5));

      // ---- Top devedores (a receber em aberto) ----
      const debtorMap = new Map<string, number>();
      (ccData ?? []).forEach((p: any) => {
        const name = p.partners?.name ?? "Diversos";
        debtorMap.set(name, (debtorMap.get(name) ?? 0) + Number(p.amount));
      });
      setTopDebtors(Array.from(debtorMap.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5));

      // ---- Despesas por CC ----
      const ccMap = new Map<string, number>();
      (bills ?? []).forEach((b: any) => {
        const name = b.cost_centers?.name ?? "Sem CC";
        const open = Number(b.amount_total) - Number(b.amount_paid);
        ccMap.set(name, (ccMap.get(name) ?? 0) + open);
      });
      setByCC(Array.from(ccMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6));

      // ---- Próximos vencimentos (AP + AR) ----
      const upc: typeof upcoming = [];
      const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7);
      (bills ?? []).forEach((b: any) => {
        if (!b.due_date) return;
        const d = new Date(b.due_date);
        if (d >= today && d <= horizon) {
          upc.push({ id: b.id ?? Math.random().toString(), label: b.partners?.name ?? "Fornecedor", amount: Number(b.amount_total) - Number(b.amount_paid), due: b.due_date, kind: "ap" });
        }
      });
      upc.sort((a, b) => a.due.localeCompare(b.due));
      setUpcoming(upc.slice(0, 8));
    })();
  }, [range]);

  return (
    <div className="min-h-full fin-surface">
      <FinanceHero stats={stats} />
      <PageBody>
        <div className="grid gap-4">
          {/* KPIs */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard to="/finance/receivables" icon={ArrowDownToLine} label="A Receber" value={fmtMoney(stats.receivable)} delta={stats.overdue_recv} deltaLabel="vencido" tone="emerald" />
            <KpiCard to="/finance/payables" icon={Receipt} label="A Pagar" value={fmtMoney(stats.payable)} delta={stats.overdue_pay} deltaLabel="vencido" tone="gold" />
            <KpiCard to="/finance/pending" icon={AlertTriangle} label="Confirmações" value={String(stats.pending)} hint="pendentes" tone="amber" />
            <KpiCard to="/cashbox" icon={Wallet} label="Caixa hoje" value={fmtMoney(stats.cashToday)} hint={`${stats.openSessions} sessão(ões) aberta(s)`} tone="emerald" />
          </div>

          {/* Fluxo + Alertas */}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Fluxo de Caixa</div>
                  <div className="text-base font-semibold fin-primary-text">Entradas vs saídas</div>
                </div>
                <div className="flex gap-1">
                  {([7, 30, 90] as const).map((r) => (
                    <Button key={r} size="sm" variant={range === r ? "default" : "ghost"} onClick={() => setRange(r)} className="h-7 px-2 text-xs">{r}d</Button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={flow}>
                    <defs>
                      <linearGradient id="finIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={EMERALD} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="finOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                    <Tooltip formatter={(v: any) => fmtMoney(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="in" name="Entradas" stroke={EMERALD} strokeWidth={2} fill="url(#finIn)" />
                    <Area type="monotone" dataKey="out" name="Saídas" stroke={GOLD} strokeWidth={2} fill="url(#finOut)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Próximos 7 dias</div>
                  <div className="text-base font-semibold fin-primary-text">Alertas de vencimento</div>
                </div>
                <FileWarning className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-2 max-h-64 overflow-auto">
                {upcoming.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-8 text-center">Sem vencimentos próximos</div>
                ) : upcoming.map((u) => {
                  const days = Math.ceil((new Date(u.due).getTime() - Date.now()) / 86400000);
                  return (
                    <Link key={u.id} to="/finance/payables" className="flex items-center justify-between gap-2 p-2 rounded hover:bg-muted/60 transition">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{u.label}</div>
                        <div className="text-[11px] text-muted-foreground">{u.due} · {days === 0 ? "hoje" : `${days}d`}</div>
                      </div>
                      <div className="text-sm tabular-nums font-semibold">{fmtMoney(u.amount)}</div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Top devedores / fornecedores / CC */}
          <div className="grid lg:grid-cols-3 gap-4">
            <TopList title="Top devedores" subtitle="Clientes a receber" icon={Users} rows={topDebtors} to="/finance/receivables" />
            <TopList title="Top fornecedores" subtitle="Faturas em aberto" icon={Building2} rows={topSuppliers} to="/finance/payables" tone="gold" />
            <Card className="p-4">
              <div className="mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Despesas por CC</div>
                <div className="text-base font-semibold fin-primary-text">Distribuição</div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCC} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                      {byCC.map((_, i) => (
                        <Cell key={i} fill={[EMERALD, GOLD, SOFT, "hsl(162 50% 50%)", "hsl(44 70% 70%)", "hsl(162 30% 40%)"][i % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtMoney(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Atalhos */}
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Acesso rápido</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              <QuickLink to="/finance/bank-import" icon={ArrowDownToLine} label="Importar extrato" />
              <QuickLink to="/finance/reconciliation" icon={Scale} label="Conciliação" />
              <QuickLink to="/finance/recurring" icon={Activity} label="Despesas fixas" />
              <QuickLink to="/finance/cost-centers" icon={Building2} label="Centros de custo" />
              <QuickLink to="/finance/chart-of-accounts" icon={Receipt} label="Plano de contas" />
              <QuickLink to="/finance/reports" icon={TrendingUp} label="Relatórios" />
            </div>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}

function FinanceHero({ stats }: { stats: Stats }) {
  const net = stats.receivable - stats.payable;
  return (
    <div className="fin-hero">
      <div className="px-6 py-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] opacity-80">Financeiro · Visão Executiva</div>
          <h1 className="text-3xl font-semibold mt-1 flex items-center gap-2">
            <span style={{ color: "hsl(var(--finance-accent))" }}>●</span> Dashboard
          </h1>
          <div className="text-sm opacity-90 mt-1">Posição líquida: <span className="font-semibold">{fmtMoney(net)}</span></div>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="secondary" className="bg-white/15 text-white hover:bg-white/25 border-white/20">
            <Link to="/finance/reports"><TrendingUp className="h-4 w-4 mr-1" /> Relatórios</Link>
          </Button>
          <Button asChild size="sm" className="bg-[hsl(var(--finance-accent))] text-[hsl(var(--finance-ink))] hover:bg-[hsl(var(--finance-accent))]/90">
            <Link to="/finance/bank-import"><ArrowDownToLine className="h-4 w-4 mr-1" /> Importar extrato</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ to, icon: Icon, label, value, delta, deltaLabel, hint, tone }: {
  to: string; icon: any; label: string; value: string;
  delta?: number; deltaLabel?: string; hint?: string;
  tone?: "emerald" | "gold" | "amber";
}) {
  const accentBg = tone === "gold" ? "bg-[hsl(var(--finance-accent))]/10" : tone === "amber" ? "bg-amber-500/10" : "bg-[hsl(var(--finance-primary))]/10";
  const accentText = tone === "gold" ? "text-[hsl(var(--finance-accent))]" : tone === "amber" ? "text-amber-600" : "fin-primary-text";
  return (
    <Link to={to} className="fin-kpi block group">
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${accentBg}`}>
          <Icon className={`h-4 w-4 ${accentText}`} />
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
      </div>
      <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accentText}`}>{value}</div>
      {delta !== undefined && delta > 0 && (
        <Badge variant="outline" className="mt-2 text-[10px] border-destructive/40 text-destructive">
          <TrendingDown className="h-3 w-3 mr-1" /> {fmtMoney(delta)} {deltaLabel}
        </Badge>
      )}
      {hint && <div className="text-[11px] text-muted-foreground mt-2">{hint}</div>}
    </Link>
  );
}

function TopList({ title, subtitle, icon: Icon, rows, to, tone }: {
  title: string; subtitle: string; icon: any; rows: TopRow[]; to: string; tone?: "gold";
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const barColor = tone === "gold" ? "hsl(var(--finance-accent))" : "hsl(var(--finance-primary))";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{subtitle}</div>
          <div className="text-base font-semibold fin-primary-text flex items-center gap-1">
            <Icon className="h-4 w-4" /> {title}
          </div>
        </div>
        <Link to={to} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center">ver <ArrowUpRight className="h-3 w-3 ml-0.5" /></Link>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Sem dados</div>
        ) : rows.map((r, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate min-w-0">{r.name}</span>
              <span className="tabular-nums font-medium ml-2">{fmtMoney(r.amount)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%`, background: barColor }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to} className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border bg-card hover:fin-surface hover:border-[hsl(var(--finance-primary))]/30 transition text-center">
      <Icon className="h-4 w-4 fin-primary-text" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
