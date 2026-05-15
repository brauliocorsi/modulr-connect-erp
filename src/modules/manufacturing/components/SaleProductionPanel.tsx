import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Factory, ArrowRight } from "lucide-react";
import { MOStateBadge, MOPriorityBadge } from "@/modules/manufacturing/components/MOBadges";
import { fmtDate } from "@/lib/format";

export function SaleProductionPanel({ saleOrderId }: { saleOrderId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["sale-mos", saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => (await supabase
      .from("manufacturing_orders")
      .select("id,code,qty,state,priority,due_date,product:products(name)")
      .eq("sale_order_id", saleOrderId)
      .order("created_at", { ascending: true })).data ?? [],
  });

  if (isLoading) return null;
  if (!data?.length) return null;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Factory className="h-4 w-4" /> Produção
        <span className="text-xs text-muted-foreground font-normal">({data.length} ordem{data.length > 1 ? "s" : ""})</span>
      </div>
      <div className="divide-y">
        {data.map((m: any) => (
          <Link
            key={m.id} to={`/manufacturing/orders/${m.id}`}
            className="flex items-center justify-between gap-3 py-2 hover:bg-muted/40 -mx-2 px-2 rounded text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{m.code} • {m.product?.name}</div>
              <div className="text-xs text-muted-foreground">Qtd: {Number(m.qty)} • Prazo: {fmtDate(m.due_date)}</div>
            </div>
            <MOPriorityBadge priority={m.priority} />
            <MOStateBadge state={m.state} />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
