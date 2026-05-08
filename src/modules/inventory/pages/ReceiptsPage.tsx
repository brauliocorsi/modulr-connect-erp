import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart, ShoppingBag, PackageCheck } from "lucide-react";

type Row = {
  id: string;
  name: string;
  state: string;
  scheduled_at: string | null;
  origin: string | null;
  partners: { name: string } | null;
  po?: { id: string; name: string; origin: string | null } | null;
  so?: { id: string; name: string; partner: string | null } | null;
};

const STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-destructive/10 text-destructive",
};

function useReceipts() {
  return useQuery({
    queryKey: ["receipts-all"],
    queryFn: async () => {
      const { data: pickings } = await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,origin, partners(name)")
        .eq("kind", "incoming")
        .order("scheduled_at", { ascending: false })
        .limit(500);
      const list = (pickings ?? []) as any[];
      const poNames = Array.from(new Set(list.map((p) => p.origin).filter(Boolean))) as string[];
      let posMap: Record<string, any> = {};
      let soMap: Record<string, any> = {};
      if (poNames.length) {
        const { data: pos } = await supabase
          .from("purchase_orders")
          .select("id,name,origin")
          .in("name", poNames);
        (pos ?? []).forEach((p: any) => (posMap[p.name] = p));
        const soNames = Array.from(new Set((pos ?? []).map((p: any) => p.origin).filter(Boolean))) as string[];
        if (soNames.length) {
          const { data: sos } = await supabase
            .from("sale_orders")
            .select("id,name, partners(name)")
            .in("name", soNames);
          (sos ?? []).forEach((s: any) => (soMap[s.name] = { id: s.id, name: s.name, partner: s.partners?.name ?? null }));
        }
      }
      const rows: Row[] = list.map((p) => {
        const po = p.origin ? posMap[p.origin] ?? null : null;
        const so = po?.origin ? soMap[po.origin] ?? null : null;
        return { ...p, po, so };
      });
      return rows;
    },
  });
}

function ReceiptRow({ r, showSO }: { r: Row; showSO: boolean }) {
  return (
    <tr className="border-t hover:bg-accent/40">
      <td className="px-3 py-2">
        <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
          <PackageCheck className="h-3.5 w-3.5" />{r.name}
        </Link>
      </td>
      <td className="px-3 py-2">
        {r.po ? (
          <Link to={`/purchase/orders/${r.po.id}`} className="hover:underline">{r.po.name}</Link>
        ) : <span className="text-muted-foreground">{r.origin ?? "—"}</span>}
      </td>
      {showSO && (
        <td className="px-3 py-2">
          {r.so ? (
            <Link to={`/sales/orders/${r.so.id}`} className="hover:underline">{r.so.name}</Link>
          ) : "—"}
        </td>
      )}
      {showSO && <td className="px-3 py-2 text-xs text-muted-foreground">{r.so?.partner ?? "—"}</td>}
      <td className="px-3 py-2 text-xs">{r.partners?.name ?? "—"}</td>
      <td className="px-3 py-2 text-xs">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
      <td className="px-3 py-2">
        <span className={`text-xs px-2 py-0.5 rounded ${STATE_TONE[r.state] ?? ""}`}>{r.state}</span>
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-end gap-1">
          {r.so && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2" title={`Abrir venda ${r.so.name}`}>
              <Link to={`/sales/orders/${r.so.id}`}>
                <ShoppingCart className="h-3.5 w-3.5 mr-1" />Venda
              </Link>
            </Button>
          )}
          {r.po && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2" title={`Abrir compra ${r.po.name}`}>
              <Link to={`/purchase/orders/${r.po.id}`}>
                <ShoppingBag className="h-3.5 w-3.5 mr-1" />Compra
              </Link>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function Table({ rows, showSO }: { rows: Row[]; showSO: boolean }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Recebimento</th>
              <th className="text-left px-3 py-2">Compra</th>
              {showSO && <th className="text-left px-3 py-2">Venda de origem</th>}
              {showSO && <th className="text-left px-3 py-2">Cliente final</th>}
              <th className="text-left px-3 py-2">Fornecedor</th>
              <th className="text-left px-3 py-2">Programado</th>
              <th className="text-left px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={showSO ? 7 : 5} className="text-center py-6 text-muted-foreground">Sem recebimentos</td></tr>
            ) : rows.map((r) => <ReceiptRow key={r.id} r={r} showSO={showSO} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function ReceiptsPage() {
  const { data, isLoading } = useReceipts();
  const all = data ?? [];
  const fromSales = all.filter((r) => !!r.so);
  const manual = all.filter((r) => !r.so);

  return (
    <>
      <PageHeader
        title="Recebimentos"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Recebimentos" }]}
      />
      <PageBody>
        <Tabs defaultValue="sales">
          <TabsList>
            <TabsTrigger value="sales">
              De Vendas <Badge variant="secondary" className="ml-2">{fromSales.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="manual">
              Manuais <Badge variant="secondary" className="ml-2">{manual.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sales" className="mt-4">
            {isLoading ? <div className="text-muted-foreground p-4">Carregando…</div> : <Table rows={fromSales} showSO />}
          </TabsContent>
          <TabsContent value="manual" className="mt-4">
            {isLoading ? <div className="text-muted-foreground p-4">Carregando…</div> : <Table rows={manual} showSO={false} />}
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
