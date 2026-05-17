import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { MOStateBadge, MOPriorityBadge, ComponentStockChip } from "@/modules/manufacturing/components/MOBadges";
import { fmtDate } from "@/lib/format";
import WorkOrdersSection from "@/modules/manufacturing/components/WorkOrdersSection";

export default function ShopFloorOrder() {
  const { id } = useParams();

  const moQ = useQuery({
    queryKey: ["sf-mo", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("manufacturing_orders").select("*, product:products(name), partner:partners(name)").eq("id", id!).maybeSingle()).data,
  });
  const compsQ = useQuery({
    queryKey: ["sf-comps", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_components").select("*, product:products(name)").eq("mo_id", id!).order("sequence")).data ?? [],
  });

  const mo = moQ.data;
  if (!mo) return <PageBody><div className="text-sm text-muted-foreground">Carregando…</div></PageBody>;

  return (
    <>
      <PageHeader
        title={`${mo.code} — ${mo.product?.name}`}
        breadcrumb={[{ label: "Chão de Fábrica", to: "/shop-floor" }, { label: mo.code }]}
        actions={<div className="flex gap-2 items-center"><MOPriorityBadge priority={mo.priority} /><MOStateBadge state={mo.state} /></div>}
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 space-y-2 text-sm lg:col-span-1">
            <div><span className="text-muted-foreground">Cliente:</span> {mo.partner?.name ?? "—"}</div>
            <div><span className="text-muted-foreground">Quantidade:</span> <span className="text-2xl font-bold">{Number(mo.qty)}</span></div>
            <div><span className="text-muted-foreground">Prazo:</span> {fmtDate(mo.due_date)}</div>
            {mo.blocked_reason && <div className="text-destructive">⚠ {mo.blocked_reason}</div>}
            {mo.notes && <div className="whitespace-pre-wrap">{mo.notes}</div>}
            <Link to={`/manufacturing/orders/${mo.id}`} className="text-xs text-muted-foreground underline block pt-2">
              Ver ordem completa
            </Link>

            <div className="font-semibold mt-4 mb-2 text-sm">Componentes</div>
            <table className="w-full text-xs">
              <tbody>
                {compsQ.data?.map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5">{c.product?.name}</td>
                    <td>{Number(c.qty_required)}/{Number(c.qty_available)}</td>
                    <td><ComponentStockChip status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4 lg:col-span-2">
            <div className="font-semibold mb-2">Work Orders</div>
            <WorkOrdersSection moId={id!} compact />
          </Card>
        </div>
      </PageBody>
    </>
  );
}
