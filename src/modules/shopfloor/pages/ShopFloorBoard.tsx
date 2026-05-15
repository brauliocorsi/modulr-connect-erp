import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { MOPriorityBadge } from "@/modules/manufacturing/components/MOBadges";
import { fmtDate } from "@/lib/format";

const COLS: { key: string; label: string; states: string[] }[] = [
  { key: "ready", label: "Pronto p/ produzir", states: ["ready"] },
  { key: "in_progress", label: "Em produção", states: ["in_progress"] },
  { key: "paused", label: "Pausado", states: ["paused", "waiting_material"] },
  { key: "qc", label: "Qualidade", states: ["qc"] },
  { key: "done", label: "Concluído", states: ["done"] },
];

export default function ShopFloorBoard() {
  const { data } = useQuery({
    queryKey: ["sf-board"],
    queryFn: async () => (await supabase
      .from("manufacturing_orders")
      .select("id,code,state,priority,qty,due_date,blocked_reason,product:products(name),partner:partners(name)")
      .not("state", "in", "(cancelled)")
      .order("priority", { ascending: false })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500)).data ?? [],
  });

  return (
    <>
      <PageHeader title="Chão de Fábrica" breadcrumb={[{ label: "Chão de Fábrica" }]} />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {COLS.map((c) => {
            const items = (data ?? []).filter((m: any) => c.states.includes(m.state));
            return (
              <Card key={c.key} className="p-3 min-h-[60vh]">
                <div className="font-semibold text-sm mb-3 flex items-center justify-between">
                  <span>{c.label}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((m: any) => (
                    <Link key={m.id} to={`/shop-floor/order/${m.id}`} className="block border rounded-lg p-3 hover:bg-muted/40">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">{m.code}</div>
                        <MOPriorityBadge priority={m.priority} />
                      </div>
                      <div className="text-sm mt-1 truncate">{m.product?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{m.partner?.name ?? "—"}</div>
                      <div className="text-xs mt-1">Qtd: {Number(m.qty)} • Prazo: {fmtDate(m.due_date)}</div>
                      {m.blocked_reason && <div className="text-xs text-destructive mt-1">⚠ {m.blocked_reason}</div>}
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
