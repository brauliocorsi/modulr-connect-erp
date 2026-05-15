import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";

const cards: { key: string; label: string; filter: (q: any) => any; tone?: string }[] = [
  { key: "open", label: "Abertas", filter: (q) => q.not("state", "in", "(done,cancelled)") },
  { key: "ready", label: "Prontas para produzir", filter: (q) => q.eq("state", "ready") },
  { key: "in_progress", label: "Em produção", filter: (q) => q.eq("state", "in_progress") },
  { key: "waiting", label: "Aguardando material", filter: (q) => q.eq("state", "waiting_material"), tone: "text-destructive" },
  { key: "paused", label: "Pausadas", filter: (q) => q.eq("state", "paused"), tone: "text-amber-600" },
  { key: "qc", label: "Em qualidade", filter: (q) => q.eq("state", "qc") },
  { key: "done_week", label: "Concluídas (7 dias)", filter: (q) => q.eq("state", "done").gte("actual_end", new Date(Date.now() - 7*864e5).toISOString()) },
  { key: "overdue", label: "Atrasadas", filter: (q) => q.lt("due_date", new Date().toISOString().slice(0,10)).not("state","in","(done,cancelled)"), tone: "text-destructive" },
];

export default function ManufacturingDashboard() {
  const { data } = useQuery({
    queryKey: ["mfg-dashboard"],
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const c of cards) {
        const q = c.filter(supabase.from("manufacturing_orders").select("id", { count: "exact", head: true }));
        const { count } = await q;
        out[c.key] = count ?? 0;
      }
      return out;
    },
  });

  const eff = useQuery({
    queryKey: ["mfg-eff"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const [ops, qcs, issues] = await Promise.all([
        supabase.from("mo_workorder_logs").select("qty_done,qty_scrap,started_at,finished_at").gte("created_at", since),
        supabase.from("mo_quality_checks").select("result").gte("checked_at", since),
        supabase.from("mo_issues").select("id,resolved_at").gte("reported_at", since),
      ]);
      const logs = ops.data ?? [];
      const totalDone = logs.reduce((s: number, l: any) => s + Number(l.qty_done ?? 0), 0);
      const totalScrap = logs.reduce((s: number, l: any) => s + Number(l.qty_scrap ?? 0), 0);
      const totalMin = logs.reduce((s: number, l: any) => {
        if (!l.started_at || !l.finished_at) return s;
        return s + (new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 60000;
      }, 0);
      const qcList = qcs.data ?? [];
      const qcPass = qcList.filter((q: any) => q.result === "pass").length;
      const qcRate = qcList.length ? Math.round((qcPass / qcList.length) * 100) : null;
      const scrapRate = totalDone + totalScrap ? Math.round((totalScrap / (totalDone + totalScrap)) * 100) : 0;
      const issuesList = issues.data ?? [];
      const openIssues = issuesList.filter((i: any) => !i.resolved_at).length;
      return { totalDone, totalScrap, totalMin: Math.round(totalMin), qcRate, scrapRate, openIssues };
    },
  });

  return (
    <>
      <PageHeader title="Manufatura" breadcrumb={[{ label: "Manufatura" }]} />
      <PageBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <Link key={c.key} to="/manufacturing/orders" className="block">
              <Card className="p-4 hover:bg-muted/40 transition">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className={`text-3xl font-semibold mt-1 ${c.tone ?? ""}`}>{data?.[c.key] ?? "—"}</div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-6">
          <div className="text-sm font-semibold mb-2">Eficiência (últimos 30 dias)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="p-4"><div className="text-xs text-muted-foreground">Peças produzidas</div><div className="text-2xl font-semibold mt-1">{eff.data?.totalDone ?? "—"}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Defeitos</div><div className="text-2xl font-semibold mt-1 text-destructive">{eff.data?.totalScrap ?? "—"}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Taxa de defeito</div><div className="text-2xl font-semibold mt-1">{eff.data?.scrapRate ?? "—"}%</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Aprovação QC</div><div className="text-2xl font-semibold mt-1 text-emerald-600">{eff.data?.qcRate ?? "—"}{eff.data?.qcRate != null && "%"}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">Problemas abertos</div><div className="text-2xl font-semibold mt-1 text-amber-600">{eff.data?.openIssues ?? "—"}</div></Card>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Tempo total apontado: {eff.data?.totalMin ?? 0} min</div>
        </div>
      </PageBody>
    </>
  );
}
