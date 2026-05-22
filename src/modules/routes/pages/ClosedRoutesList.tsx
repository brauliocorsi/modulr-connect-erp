import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageBody, PageHeader } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Printer, Eye } from "lucide-react";

// Closed routes list — shows totals received per route and quick access to print.
export default function ClosedRoutesList() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: routes = [] } = useQuery<any[]>({
    queryKey: ["closed-routes", from, to],
    queryFn: async () => {
      let q = supabase
        .from("delivery_routes")
        .select("id, route_date, state, vehicle_id, driver_id, delivery_zones(name), vehicles(name,license_plate)")
        .eq("state", "closed")
        .order("route_date", { ascending: false })
        .limit(500);
      if (from) q = q.gte("route_date", from);
      if (to) q = q.lte("route_date", to);
      return (await q).data ?? [];
    },
  });

  const routeIds = routes.map((r) => r.id);

  const { data: orders = [] } = useQuery<any[]>({
    queryKey: ["closed-routes-orders", routeIds.join(",")],
    enabled: routeIds.length > 0,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select("route_id, delivery_schedules(sale_order_id)")
        .in("route_id", routeIds)).data ?? [],
  });

  const orderToRoute = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders as any[]) {
      const oid = o?.delivery_schedules?.sale_order_id;
      if (oid) m.set(oid, o.route_id);
    }
    return m;
  }, [orders]);

  const orderIds = Array.from(orderToRoute.keys());

  const { data: payments = [] } = useQuery<any[]>({
    queryKey: ["closed-routes-payments", orderIds.join(",")],
    enabled: orderIds.length > 0,
    queryFn: async () =>
      (await supabase
        .from("customer_payments")
        .select("order_id, amount, state")
        .in("order_id", orderIds)
        .eq("state", "posted")).data ?? [],
  });

  const totalsByRoute = useMemo(() => {
    const m = new Map<string, { received: number; count: number }>();
    for (const p of payments as any[]) {
      const rid = orderToRoute.get(p.order_id);
      if (!rid) continue;
      const item = m.get(rid) ?? { received: 0, count: 0 };
      item.received += Number(p.amount ?? 0);
      item.count += 1;
      m.set(rid, item);
    }
    return m;
  }, [payments, orderToRoute]);

  const fmtEur = (n: number) => Number(n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

  return (
    <>
      <PageHeader title="Rotas Fechadas" subtitle="Histórico de rotas concluídas com totais recebidos" />
      <PageBody>
        <Card className="p-3 mb-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
          </div>
          {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Limpar</Button>}
          <div className="ml-auto text-xs text-muted-foreground">{routes.length} rota(s)</div>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-2">Data</th>
                <th className="text-left p-2">ID Rota</th>
                <th className="text-left p-2">Zona</th>
                <th className="text-left p-2">Viatura</th>
                <th className="text-right p-2">Recebimentos</th>
                <th className="text-right p-2">Total recebido</th>
                <th className="text-left p-2">Estado</th>
                <th className="p-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const t = totalsByRoute.get(r.id) ?? { received: 0, count: 0 };
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2">{r.route_date}</td>
                    <td className="p-2 font-mono text-xs">{String(r.id).slice(0, 8)}</td>
                    <td className="p-2">{r.delivery_zones?.name ?? "—"}</td>
                    <td className="p-2">
                      {r.vehicles?.name ?? "—"}
                      {r.vehicles?.license_plate && <span className="text-muted-foreground"> · {r.vehicles.license_plate}</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{t.count}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{fmtEur(t.received)}</td>
                    <td className="p-2"><Badge variant="secondary">Fechada</Badge></td>
                    <td className="p-2">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/routes/${r.id}`}><Eye className="h-3.5 w-3.5" /></Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/routes/${r.id}/payments`}><Printer className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {routes.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhuma rota fechada</td></tr>
              )}
            </tbody>
          </table>
        </Card>

        <div className="mt-3 text-right text-sm">
          <span className="text-muted-foreground">Total geral recebido: </span>
          <strong className="tabular-nums">
            {fmtEur(Array.from(totalsByRoute.values()).reduce((a, t) => a + t.received, 0))}
          </strong>
        </div>
      </PageBody>
    </>
  );
}
