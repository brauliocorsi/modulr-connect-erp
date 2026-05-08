import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { AdvancedFilters, FilterValues } from "@/modules/inventory/components/AdvancedFilters";
import { Download } from "lucide-react";

export default function MovesPage() {
  const [filters, setFilters] = useState<FilterValues>({});

  const { data: products } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });
  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["stock-moves", filters],
    queryFn: async () => {
      let q: any = supabase
        .from("stock_moves")
        .select("id, reference, quantity, quantity_done, state, created_at, products(name), stock_pickings!inner(id,name,kind,scheduled_at,done_at,origin,warehouse_id, partners(name))")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filters.product_id) q = q.eq("product_id", filters.product_id);
      if (filters.kind) q = q.eq("stock_pickings.kind", filters.kind);
      if (filters.warehouse_id) q = q.eq("stock_pickings.warehouse_id", filters.warehouse_id);
      if (filters.state) q = q.eq("state", filters.state);
      if (filters.from) q = q.gte("created_at", filters.from);
      if (filters.to) q = q.lte("created_at", filters.to + "T23:59:59");
      if (filters.origin) q = q.ilike("stock_pickings.origin", `%${filters.origin}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ["Data", "Documento", "Tipo", "Produto", "Origem", "Destino", "Qtd", "Feito", "Estado", "Origem doc"],
      ...data.map((r: any) => [
        new Date(r.created_at).toLocaleString("pt-PT"),
        r.stock_pickings?.name ?? "",
        r.stock_pickings?.kind ?? "",
        r.products?.name ?? "",
        r.quantity, r.quantity_done, r.state,
        r.stock_pickings?.origin ?? "",
        r.stock_pickings?.partners?.name ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `movimentos_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  };

  return (
    <>
      <PageHeader
        title="Movimentos de Stock"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Movimentos" }]}
        actions={<Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>}
      />
      <PageBody>
        <Card className="p-3 mb-4">
          <AdvancedFilters
            onChange={setFilters}
            fields={[
              { key: "from", label: "De (data)", type: "date" },
              { key: "to", label: "Até (data)", type: "date" },
              { key: "kind", label: "Tipo", type: "select", options: [
                { value: "incoming", label: "Entrada" }, { value: "outgoing", label: "Saída" }, { value: "internal", label: "Interna" },
              ]},
              { key: "state", label: "Estado", type: "select", options: [
                { value: "draft", label: "Rascunho" }, { value: "waiting", label: "Aguardando" },
                { value: "ready", label: "Pronto" }, { value: "done", label: "Concluído" }, { value: "cancelled", label: "Cancelado" },
              ]},
              { key: "product_id", label: "Produto", type: "select", options: (products ?? []).map((p: any) => ({ value: p.id, label: p.name })) },
              { key: "warehouse_id", label: "Armazém", type: "select", options: (warehouses ?? []).map((w: any) => ({ value: w.id, label: w.name })) },
              { key: "origin", label: "Origem (SO/PO)", type: "text" },
            ]}
          />
        </Card>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Data</th>
                  <th className="text-left px-3 py-2">Documento</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Produto</th>
                  <th className="text-left px-3 py-2">Origem → Destino</th>
                  <th className="text-right px-3 py-2">Qtd</th>
                  <th className="text-right px-3 py-2">Feito</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">Origem doc</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Carregando…</td></tr>
                ) : !data || data.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Sem movimentos</td></tr>
                ) : data.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{new Date(r.created_at).toLocaleString("pt-PT")}</td>
                    <td className="px-3 py-2">
                      {r.stock_pickings?.id ? (
                        <Link to={`/inventory/transfers/${r.stock_pickings.id}`} className="text-primary hover:underline">
                          {r.stock_pickings.name}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">{r.stock_pickings?.kind ?? "—"}</td>
                    <td className="px-3 py-2">{r.products?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.source_location?.name ?? "—"} → {r.destination_location?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity_done}</td>
                    <td className="px-3 py-2"><span className="o-state-badge">{r.state}</span></td>
                    <td className="px-3 py-2 text-xs">{r.stock_pickings?.origin ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
