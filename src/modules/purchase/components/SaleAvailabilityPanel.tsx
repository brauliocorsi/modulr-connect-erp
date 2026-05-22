import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, AlertTriangle, CheckCircle2 } from "lucide-react";

const STATE_LABEL: Record<string, string> = {
  pending: "Pendente", quoting: "Em cotação", approved: "Aprovado",
  po_created: "PO criado", partially_received: "Parc. recebido",
  received: "Recebido", cancelled: "Cancelado",
};

// Sale states that mean the order is already fulfilled — open needs become
// informational ("resolvido pela entrega") instead of blocking.
const FULFILLED_SALE_STATES = ["done", "delivered", "invoiced", "closed"];

export default function SaleAvailabilityPanel({ saleOrderId }: { saleOrderId: string }) {
  const { data: needs = [] } = useQuery({
    queryKey: ["sale-needs", saleOrderId],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_needs")
        .select("id, qty_needed, state, needed_by, products(id,name), purchase_orders(id,name,state)")
        .eq("sale_order_id", saleOrderId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!saleOrderId,
  });

  const { data: sale } = useQuery({
    queryKey: ["sale-state", saleOrderId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sale_orders")
        .select("state")
        .eq("id", saleOrderId)
        .maybeSingle();
      return data;
    },
    enabled: !!saleOrderId,
  });

  if (!needs.length) return null;

  const saleFulfilled = !!sale?.state && FULFILLED_SALE_STATES.includes(sale.state);
  const blocking = saleFulfilled
    ? 0
    : needs.filter((n: any) => !["received", "cancelled"].includes(n.state)).length;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingBag className="h-4 w-4 text-primary" />
        <div className="font-semibold">Necessidades de Compra</div>
        {blocking > 0 ? (
          <Badge variant="destructive" className="ml-auto gap-1">
            <AlertTriangle className="h-3 w-3" />{blocking} a aguardar
          </Badge>
        ) : saleFulfilled ? (
          <Badge variant="outline" className="ml-auto gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />resolvido pela entrega
          </Badge>
        ) : null}
      </div>
      <div className="space-y-2">
        {needs.map((n: any) => {
          const showAsResolved = saleFulfilled && !["received", "cancelled"].includes(n.state);
          return (
            <div key={n.id} className={`flex items-center gap-2 text-sm border rounded p-2 ${showAsResolved ? "opacity-70" : ""}`}>
              <div className="flex-1">
                <Link to={`/products/${n.products?.id}`} className="font-medium hover:underline">{n.products?.name}</Link>
                <div className="text-xs text-muted-foreground">
                  Qtd {Number(n.qty_needed).toLocaleString("pt-PT")}
                  {n.needed_by && <> · prazo {new Date(n.needed_by).toLocaleDateString("pt-PT")}</>}
                </div>
              </div>
              {n.purchase_orders && (
                <Link to={`/purchase/orders/${n.purchase_orders.id}`} className="text-xs text-primary hover:underline">
                  PO {n.purchase_orders.name}
                </Link>
              )}
              {showAsResolved ? (
                <Badge variant="outline" className="text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />entregue
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">{STATE_LABEL[n.state]}</Badge>
              )}
            </div>
          );
        })}
      </div>
      {saleFulfilled && (
        <div className="mt-3 text-xs text-muted-foreground">
          A venda já foi entregue — necessidades em aberto são apenas informativas.
        </div>
      )}
    </Card>
  );
}
