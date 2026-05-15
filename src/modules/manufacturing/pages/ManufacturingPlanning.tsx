import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { MOStateBadge, MOPriorityBadge } from "../components/MOBadges";
import { fmtDate } from "@/lib/format";

export default function ManufacturingPlanning() {
  const { data } = useQuery({
    queryKey: ["mfg-planning"],
    queryFn: async () => (await supabase
      .from("manufacturing_orders")
      .select("id,code,state,priority,qty,due_date,product:products(name),partner:partners(name)")
      .not("state", "in", "(done,cancelled)")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(500)).data ?? [],
  });

  const groups = ["urgent", "high", "normal", "low"];
  const byPrio = (p: string) => (data ?? []).filter((m: any) => m.priority === p);

  return (
    <>
      <PageHeader title="Planeamento de Produção" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Planeamento" }]} />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {groups.map((p) => (
            <Card key={p} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{p}</div>
                <MOPriorityBadge priority={p} />
              </div>
              <div className="space-y-2">
                {byPrio(p).map((m: any) => (
                  <Link key={m.id} to={`/manufacturing/orders/${m.id}`} className="block border rounded p-2 hover:bg-muted/40">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{m.code}</div>
                      <MOStateBadge state={m.state} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{m.product?.name} • {m.partner?.name ?? "—"}</div>
                    <div className="text-xs mt-1">Prazo: {fmtDate(m.due_date)} • Qtd: {Number(m.qty)}</div>
                  </Link>
                ))}
                {byPrio(p).length === 0 && <div className="text-xs text-muted-foreground">—</div>}
              </div>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
