import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";

const fmt = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

export const StockOnHandReport = () => {
  const { data } = useQuery({
    queryKey: ["report_stock_on_hand"],
    queryFn: async () => {
      const { data: quants } = await supabase
        .from("stock_quants")
        .select("product_id, quantity, reserved_quantity, location_id, stock_locations!inner(type)")
        .eq("stock_locations.type", "internal");
      const ids = Array.from(new Set((quants ?? []).map((q: any) => q.product_id)));
      const { data: prods } = ids.length
        ? await supabase.from("products").select("id, name, internal_ref").in("id", ids)
        : { data: [] as any[] };
      const map = new Map<string, { name: string; ref: string | null; qty: number; reserved: number }>();
      (quants ?? []).forEach((q: any) => {
        const p = prods!.find((x: any) => x.id === q.product_id);
        if (!p) return;
        const cur = map.get(q.product_id) ?? { name: p.name, ref: p.internal_ref, qty: 0, reserved: 0 };
        cur.qty += Number(q.quantity ?? 0);
        cur.reserved += Number(q.reserved_quantity ?? 0);
        map.set(q.product_id, cur);
      });
      return Array.from(map.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.qty - a.qty);
    },
  });
  return (
    <>
      <PageHeader title="Stock por Produto" breadcrumb={[{ label: "Relatórios" }, { label: "Stock" }]} />
      <PageBody>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Ref.</th>
                <th className="text-left px-3 py-2">Produto</th>
                <th className="text-right px-3 py-2">Quantidade</th>
                <th className="text-right px-3 py-2">Reservado</th>
                <th className="text-right px-3 py-2">Disponível</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">{r.ref ?? "—"}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.qty)}</td>
                  <td className="px-3 py-2 text-right">{fmt(r.reserved)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(r.qty - r.reserved)}</td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={5} className="text-center text-muted-foreground py-8">Sem dados</td></tr>}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
};

const stateColors: Record<string, string> = {
  draft: "bg-muted text-foreground",
  sent: "bg-blue-500/10 text-blue-700",
  rfq_sent: "bg-blue-500/10 text-blue-700",
  confirmed: "bg-amber-500/10 text-amber-700",
  done: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-destructive/10 text-destructive",
};

const SummaryByState = ({ title, table, breadcrumb }: { title: string; table: "sale_orders" | "purchase_orders"; breadcrumb: { label: string }[] }) => {
  const { data } = useQuery({
    queryKey: ["report_by_state", table],
    queryFn: async () => {
      const { data } = await supabase.from(table).select("state, amount_total");
      const map = new Map<string, { count: number; total: number }>();
      (data ?? []).forEach((r: any) => {
        const cur = map.get(r.state) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(r.amount_total ?? 0);
        map.set(r.state, cur);
      });
      return Array.from(map.entries()).map(([state, v]) => ({ state, ...v }));
    },
  });
  const grand = (data ?? []).reduce((s, r) => s + r.total, 0);
  return (
    <>
      <PageHeader title={title} breadcrumb={breadcrumb} />
      <PageBody>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {(data ?? []).map((r) => (
            <Card key={r.state} className="p-4">
              <div className={`inline-block text-xs px-2 py-1 rounded ${stateColors[r.state] ?? "bg-muted"}`}>{r.state}</div>
              <div className="mt-2 text-2xl font-bold">{r.count}</div>
              <div className="text-sm text-muted-foreground">Total: {fmt(r.total)}</div>
            </Card>
          ))}
        </div>
        <Card className="p-4 flex justify-between"><span className="font-semibold">Total geral</span><span className="font-bold">{fmt(grand)}</span></Card>
      </PageBody>
    </>
  );
};

export const SalesReport = () => (
  <SummaryByState title="Vendas por Estado" table="sale_orders" breadcrumb={[{ label: "Relatórios" }, { label: "Vendas" }]} />
);

export const PurchaseReport = () => (
  <SummaryByState title="Compras por Estado" table="purchase_orders" breadcrumb={[{ label: "Relatórios" }, { label: "Compras" }]} />
);
