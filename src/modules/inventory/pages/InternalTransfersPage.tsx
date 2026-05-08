import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

const STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function InternalTransfersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["internal-transfers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,done_at,origin, source:source_location_id(name,full_path,warehouse_id), dest:destination_location_id(name,full_path,warehouse_id)")
        .eq("kind", "internal")
        .order("scheduled_at", { ascending: false })
        .limit(500);
      return (data ?? []) as any[];
    },
  });
  const all = data ?? [];
  // Same warehouse on both sides = move within warehouse; different warehouse = cross-warehouse
  const within = all.filter((r) => r.source?.warehouse_id && r.dest?.warehouse_id && r.source.warehouse_id === r.dest.warehouse_id);
  const cross = all.filter((r) => r.source?.warehouse_id && r.dest?.warehouse_id && r.source.warehouse_id !== r.dest.warehouse_id);

  const Table = ({ rows }: { rows: any[] }) => (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Referência</th>
              <th className="text-left px-3 py-2">Origem</th>
              <th className="text-left px-3 py-2">Destino</th>
              <th className="text-left px-3 py-2">Programado</th>
              <th className="text-left px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Sem transferências</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />{r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs">{r.source?.full_path ?? r.source?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.dest?.full_path ?? r.dest?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${STATE_TONE[r.state] ?? ""}`}>{r.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader title="Transferências internas" breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências internas" }]} />
      <PageBody>
        <Tabs defaultValue="within">
          <TabsList>
            <TabsTrigger value="within">Dentro do armazém <Badge variant="secondary" className="ml-2">{within.length}</Badge></TabsTrigger>
            <TabsTrigger value="cross">Entre armazéns <Badge variant="secondary" className="ml-2">{cross.length}</Badge></TabsTrigger>
            <TabsTrigger value="all">Todas <Badge variant="secondary" className="ml-2">{all.length}</Badge></TabsTrigger>
          </TabsList>
          <TabsContent value="within" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={within} />}</TabsContent>
          <TabsContent value="cross" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={cross} />}</TabsContent>
          <TabsContent value="all" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={all} />}</TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
