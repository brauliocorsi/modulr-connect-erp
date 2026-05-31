/**
 * F29 Bloco 8 — Calendário de Vencimentos
 * Rota: /finance/expenses/calendar
 * Vista mensal de supplier_bills + recurring_expenses por due_date / next_due_date.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, Receipt, Repeat } from "lucide-react";

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

const PT_MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const PT_WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function monthRange(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    first,
    last,
  };
}

type Entry = {
  kind: "bill" | "recurring";
  id: string;
  date: string;
  label: string;
  supplier: string;
  amount: number;
  state: string;
  href: string;
};

export default function ExpensesCalendarPage() {
  const today = new Date();
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: today.getFullYear(), m: today.getMonth() });
  const range = useMemo(() => monthRange(cursor.y, cursor.m), [cursor]);
  const todayIso = today.toISOString().slice(0, 10);

  const { data: bills = [] } = useQuery({
    queryKey: ["calendar-bills", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_bills")
        .select(`id, name, amount_total, amount_paid, due_date, state, partner:partners(name)`)
        .not("due_date", "is", null)
        .gte("due_date", range.from)
        .lte("due_date", range.to)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["calendar-recurring", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(`id, name, amount, next_due_date, frequency, active, supplier:partners(name)`)
        .eq("active", true)
        .gte("next_due_date", range.from)
        .lte("next_due_date", range.to)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const b of bills as any[]) {
      out.push({
        kind: "bill",
        id: b.id,
        date: b.due_date,
        label: b.name,
        supplier: b.partner?.name ?? "—",
        amount: Number(b.amount_total ?? 0) - Number(b.amount_paid ?? 0),
        state: b.state,
        href: `/finance/payables/${b.id}`,
      });
    }
    for (const r of recurring as any[]) {
      out.push({
        kind: "recurring",
        id: r.id,
        date: r.next_due_date,
        label: r.name,
        supplier: r.supplier?.name ?? "—",
        amount: Number(r.amount ?? 0),
        state: r.frequency,
        href: `/finance/recurring`,
      });
    }
    return out;
  }, [bills, recurring]);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return map;
  }, [entries]);

  // Build grid (Mon-first)
  const firstWeekday = (range.first.getDay() + 6) % 7; // 0=Mon
  const daysInMonth = range.last.getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const totalMonth = entries.reduce((s, e) => s + e.amount, 0);
  const dueSoon = entries.filter((e) => {
    if (e.kind === "bill" && e.state === "paid") return false;
    const diff = (new Date(e.date).getTime() - today.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  }).length;
  const overdue = entries.filter(
    (e) => e.kind === "bill" && e.state !== "paid" && e.date < todayIso,
  ).length;

  const prev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));

  return (
    <>
      <PageHeader
        title="Calendário de Vencimentos"
        breadcrumb={[{ label: "Financeiro" }, { label: "Calendário" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="text-sm font-semibold min-w-[140px] text-center capitalize">
              {PT_MONTHS[cursor.m]} {cursor.y}
            </div>
            <Button size="sm" variant="outline" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
              Hoje
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total no mês</div>
              <div className="text-2xl font-bold tabular-nums">{fmtEUR(totalMonth)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{entries.length} vencimentos</div>
            </CardContent>
          </Card>
          <Card className={dueSoon > 0 ? "border-amber-300 bg-amber-50/40" : ""}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">A vencer (7 dias)</div>
              <div className="text-2xl font-bold tabular-nums">{dueSoon}</div>
            </CardContent>
          </Card>
          <Card className={overdue > 0 ? "border-rose-300 bg-rose-50/40" : ""}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Vencidas</div>
              <div className="text-2xl font-bold tabular-nums text-rose-700">{overdue}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-1 text-xs">
              {PT_WEEKDAYS.map((w) => (
                <div key={w} className="text-center font-semibold text-muted-foreground py-1">{w}</div>
              ))}
              {cells.map((d, idx) => {
                if (!d) return <div key={idx} className="min-h-[110px] rounded bg-muted/20" />;
                const iso = d.toISOString().slice(0, 10);
                const items = byDay.get(iso) ?? [];
                const isToday = iso === todayIso;
                const dayTotal = items.reduce((s, e) => s + e.amount, 0);
                return (
                  <div
                    key={idx}
                    className={`min-h-[110px] rounded border p-1.5 flex flex-col gap-1 bg-card ${
                      isToday ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${isToday ? "text-primary" : ""}`}>{d.getDate()}</span>
                      {items.length > 0 && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">{fmtEUR(dayTotal)}</span>
                      )}
                    </div>
                    <div className="space-y-1 overflow-hidden">
                      {items.slice(0, 3).map((e) => {
                        const isOverdue = e.kind === "bill" && e.state !== "paid" && e.date < todayIso;
                        const isPaid = e.kind === "bill" && e.state === "paid";
                        const tone = isPaid
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : isOverdue
                          ? "bg-rose-100 text-rose-800 border-rose-200"
                          : "bg-amber-50 text-amber-800 border-amber-200";
                        return (
                          <Link
                            key={`${e.kind}-${e.id}`}
                            to={e.href}
                            className={`block rounded border px-1.5 py-0.5 text-[10px] truncate hover:opacity-80 ${tone}`}
                            title={`${e.label} · ${e.supplier} · ${fmtEUR(e.amount)}`}
                          >
                            {e.kind === "recurring" ? <Repeat className="h-2.5 w-2.5 inline mr-1" /> : <Receipt className="h-2.5 w-2.5 inline mr-1" />}
                            {e.label}
                          </Link>
                        );
                      })}
                      {items.length > 3 && (
                        <div className="text-[10px] text-muted-foreground">+{items.length - 3} mais</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> Paga</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-50 border border-amber-200" /> A vencer</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-rose-100 border border-rose-200" /> Vencida</span>
              <span className="flex items-center gap-1"><Repeat className="h-3 w-3" /> Recorrente</span>
              <span className="flex items-center gap-1"><Receipt className="h-3 w-3" /> Fatura</span>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
