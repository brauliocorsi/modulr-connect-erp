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
      </PageBody>
    </>
  );
}
