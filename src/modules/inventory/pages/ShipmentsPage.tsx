import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Truck } from "lucide-react";

const STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-destructive/10 text-destructive",
};

function useShipments() {
  return useQuery({
    queryKey: ["shipments-all"],
    queryFn: async () => {
      const { data: pickings } = await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,done_at,origin, partners(name)")
        .eq("kind", "outgoing")
        .order("scheduled_at", { ascending: false })
        .limit(500);
      const list = (pickings ?? []) as any[];
      const soNames = Array.from(new Set(list.map((p) => p.origin).filter(Boolean))) as string[];
      const soMap: Record<string, any> = {};
      if (soNames.length) {
        const { data: sos } = await supabase
          .from("sale_orders")
          .select("id,name, partners(name)")
          .in("name", soNames);
        (sos ?? []).forEach((s: any) => (soMap[s.name] = { id: s.id, name: s.name, partner: s.partners?.name ?? null }));
      }
      return list.map((p) => ({ ...p, so: p.origin ? soMap[p.origin] ?? null : null }));
    },
  });
}

function Table({ rows }: { rows: any[] }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Expedição</th>
              <th className="text-left px-3 py-2">Venda</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Programado</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Sem expedições</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5" />{r.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {r.so ? <Link to={`/sales/orders/${r.so.id}`} className="hover:underline">{r.so.name}</Link> : <span className="text-muted-foreground">{r.origin ?? "—"}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{r.so?.partner ?? r.partners?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${STATE_TONE[r.state] ?? ""}`}>{r.state}</span></td>
                <td className="px-2 py-1 text-right">
                  {r.so && (
                    <Button asChild size="sm" variant="outline" className="h-7 px-2">
                      <Link to={`/sales/orders/${r.so.id}`}><ShoppingCart className="h-3.5 w-3.5 mr-1" />Venda</Link>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function ShipmentsPage() {
  const { data, isLoading } = useShipments();
  const all = data ?? [];
  const pending = all.filter((r) => !["done", "cancelled"].includes(r.state));
  const done = all.filter((r) => r.state === "done");
  return (
    <>
      <PageHeader
        title="Expedições"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Expedições" }]}
      />
      <PageBody>
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pendentes <Badge variant="secondary" className="ml-2">{pending.length}</Badge></TabsTrigger>
            <TabsTrigger value="done">Entregues <Badge variant="secondary" className="ml-2">{done.length}</Badge></TabsTrigger>
            <TabsTrigger value="all">Todas <Badge variant="secondary" className="ml-2">{all.length}</Badge></TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={pending} />}</TabsContent>
          <TabsContent value="done" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={done} />}</TabsContent>
          <TabsContent value="all" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={all} />}</TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
