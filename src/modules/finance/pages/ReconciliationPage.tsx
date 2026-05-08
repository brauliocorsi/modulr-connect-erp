import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtMoney } from "@/lib/format";
import { AlertTriangle, CheckCircle2, ArrowUpRight, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  name: string;
  partner: string;
  total: number;
  paid: number;
  diff: number;       // paid - total
  state: string;
  payments: any[];
  schedules: any[];
};

const TOL = 0.01;

const classify = (r: Row) => {
  if (Math.abs(r.diff) < TOL && r.paid >= r.total - TOL) return "ok";
  if (r.diff > TOL) return "extra";
  if (r.paid > 0) return "partial";
  return "unpaid";
};

const META: Record<string, { label: string; tone: string }> = {
  ok:      { label: "Conciliado",          tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  extra:   { label: "Recebido a mais",     tone: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
  partial: { label: "Parcial",             tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  unpaid:  { label: "Sem recebimentos",    tone: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
};

export default function ReconciliationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("divergent");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    const [{ data: orders }, { data: pays }, { data: scheds }] = await Promise.all([
      supabase.from("sale_orders").select("id, name, amount_total, state, payment_state, partners(name)").neq("state", "cancelled").order("name", { ascending: false }).limit(500),
      supabase.from("customer_payments").select("id, name, order_id, amount, state, payment_date, schedule_id, payment_methods(name)").eq("state", "posted"),
      supabase.from("sale_payment_schedules").select("id, order_id, label, amount, paid_amount, state, sequence").order("sequence"),
    ]);
    const payByOrder = new Map<string, any[]>();
    (pays ?? []).forEach((p) => {
      if (!p.order_id) return;
      const arr = payByOrder.get(p.order_id) ?? [];
      arr.push(p);
      payByOrder.set(p.order_id, arr);
    });
    const schedByOrder = new Map<string, any[]>();
    (scheds ?? []).forEach((s) => {
      const arr = schedByOrder.get(s.order_id) ?? [];
      arr.push(s);
      schedByOrder.set(s.order_id, arr);
    });

    const out: Row[] = (orders ?? []).map((o: any) => {
      const ps = payByOrder.get(o.id) ?? [];
      const paid = ps.reduce((s, p) => s + Number(p.amount || 0), 0);
      const total = Number(o.amount_total || 0);
      return {
        id: o.id,
        name: o.name,
        partner: o.partners?.name ?? "—",
        total,
        paid,
        diff: Number((paid - total).toFixed(2)),
        state: o.payment_state ?? "unpaid",
        payments: ps,
        schedules: schedByOrder.get(o.id) ?? [],
      };
    });
    setRows(out);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (term && !(r.name.toLowerCase().includes(term) || r.partner.toLowerCase().includes(term))) return false;
      const k = classify(r);
      if (filter === "all") return true;
      if (filter === "divergent") return k !== "ok";
      return k === filter;
    });
  }, [rows, q, filter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, divergent: 0, ok: 0, extra: 0, partial: 0, unpaid: 0 };
    rows.forEach((r) => {
      const k = classify(r);
      (c as any)[k]++;
      if (k !== "ok") c.divergent++;
    });
    return c;
  }, [rows]);

  const totals = useMemo(() => filtered.reduce(
    (s, r) => ({ total: s.total + r.total, paid: s.paid + r.paid, diff: s.diff + r.diff }),
    { total: 0, paid: 0, diff: 0 },
  ), [filtered]);

  const cancelPayment = async (id: string) => {
    if (!confirm("Cancelar este recebimento?")) return;
    const { error } = await supabase.from("customer_payments").update({ state: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Recebimento cancelado");
    load();
  };

  return (
    <>
      <PageHeader title="Reconciliação de Vendas" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Reconciliação" }]} />
      <PageBody>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Total faturado" value={fmtMoney(totals.total)} />
          <SummaryCard label="Total recebido" value={fmtMoney(totals.paid)} tone="emerald" />
          <SummaryCard label="Divergência" value={fmtMoney(totals.diff)} tone={Math.abs(totals.diff) < TOL ? "muted" : (totals.diff > 0 ? "blue" : "rose")} />
          <SummaryCard label="Vendas com divergência" value={`${counts.divergent} / ${counts.all}`} tone={counts.divergent ? "amber" : "emerald"} />
        </div>

        <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Procurar por venda ou cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="divergent">Apenas divergentes ({counts.divergent})</SelectItem>
              <SelectItem value="extra">Recebido a mais ({counts.extra})</SelectItem>
              <SelectItem value="partial">Parcial ({counts.partial})</SelectItem>
              <SelectItem value="unpaid">Sem recebimentos ({counts.unpaid})</SelectItem>
              <SelectItem value="ok">Conciliados ({counts.ok})</SelectItem>
              <SelectItem value="all">Todas ({counts.all})</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Venda</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-right px-3 py-2">Total venda</th>
                <th className="text-right px-3 py-2">Recebido</th>
                <th className="text-right px-3 py-2">Diferença</th>
                <th className="text-left px-3 py-2 w-44">Estado</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  <CheckCircle2 className="inline h-5 w-5 mr-2 text-emerald-600" />
                  Tudo conciliado nesta vista
                </td></tr>
              ) : filtered.map((r) => {
                const kind = classify(r);
                const meta = META[kind];
                const isOpen = expanded[r.id];
                return (
                  <>
                    <tr key={r.id} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}>
                      <td className="px-3 py-2 font-mono">{r.name}</td>
                      <td className="px-3 py-2">{r.partner}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.paid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.diff > TOL ? "text-blue-600" : r.diff < -TOL ? "text-rose-600" : "text-muted-foreground"}`}>
                        {r.diff > 0 ? "+" : ""}{fmtMoney(r.diff)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.tone}`}>
                          {kind !== "ok" && <AlertTriangle className="h-3 w-3" />}
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link to={`/sales/orders/${r.id}`}>
                          <Button size="sm" variant="ghost"><ArrowUpRight className="h-4 w-4" /></Button>
                        </Link>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/10">
                        <td colSpan={7} className="px-6 py-3">
                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground mb-1">Parcelas</div>
                              {r.schedules.length === 0 ? (
                                <div className="text-xs text-muted-foreground italic">Sem plano</div>
                              ) : r.schedules.map((s) => (
                                <div key={s.id} className="flex justify-between text-sm py-0.5">
                                  <span>{s.label} <span className="text-xs text-muted-foreground">({s.state})</span></span>
                                  <span className="tabular-nums">{fmtMoney(s.paid_amount)} / {fmtMoney(s.amount)}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-muted-foreground mb-1">Recebimentos</div>
                              {r.payments.length === 0 ? (
                                <div className="text-xs text-muted-foreground italic">Nenhum</div>
                              ) : r.payments.map((p) => (
                                <div key={p.id} className="flex justify-between items-center text-sm py-0.5">
                                  <span>
                                    <span className="font-mono text-xs">{p.name}</span> · {p.payment_date}
                                    {p.payment_methods?.name ? ` · ${p.payment_methods.name}` : ""}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className="tabular-nums">{fmtMoney(p.amount)}</span>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelPayment(p.id)} title="Cancelar recebimento">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" | "amber" | "blue" | "muted" }) {
  const cls =
    tone === "emerald" ? "text-emerald-600"
    : tone === "rose" ? "text-rose-600"
    : tone === "amber" ? "text-amber-600"
    : tone === "blue" ? "text-blue-600"
    : tone === "muted" ? "text-muted-foreground"
    : "";
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </Card>
  );
}
