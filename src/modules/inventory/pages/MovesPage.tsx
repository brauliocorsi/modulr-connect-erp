import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { AdvancedFilters, FilterValues } from "@/modules/inventory/components/AdvancedFilters";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import { stateLabel, kindLabel } from "@/lib/picking";
import { readToggle, writeToggle } from "@/modules/inventory/lib/groupChain";

function variantLabel(v: any): string {
  if (!v) return "";
  const names = (v.product_variant_values ?? [])
    .map((x: any) => x.product_attribute_values?.name)
    .filter(Boolean);
  const sku = v.sku ? `[${v.sku}]` : "";
  const attrs = names.length ? names.join(" / ") : "";
  return [sku, attrs].filter(Boolean).join(" ");
}

export default function MovesPage() {
  const [filters, setFilters] = useState<FilterValues>({});
  const [groupMode, setGroupMode] = useState<boolean>(() => readToggle("moves-group-by-origin", true));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { writeToggle("moves-group-by-origin", groupMode); }, [groupMode]);
  const toggleExpand = (k: string) => setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
        .select("id, reference, quantity, quantity_done, state, created_at, products(name), product_variants(sku, product_variant_values(product_attribute_values(name))), stock_pickings!inner(id,name,kind,scheduled_at,done_at,origin,warehouse_id, partners(name))")
        .order("created_at", { ascending: false })
        .limit(1000);
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

  const grouped = useMemo(() => {
    const rows = data ?? [];
    if (!groupMode) return { groups: [] as any[], singles: rows };
    const buckets = new Map<string, any[]>();
    const singles: any[] = [];
    for (const r of rows) {
      const origin = r.stock_pickings?.origin;
      if (!origin) { singles.push(r); continue; }
      const arr = buckets.get(origin) ?? [];
      arr.push(r);
      buckets.set(origin, arr);
    }
    const groups: any[] = [];
    for (const [origin, arr] of buckets.entries()) {
      if (arr.length === 1) { singles.push(arr[0]); continue; }
      const partner = arr.find((r) => r.stock_pickings?.partners?.name)?.stock_pickings?.partners?.name ?? null;
      const lastDate = [...arr].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at;
      groups.push({ origin, items: arr, count: arr.length, partner, lastDate });
    }
    groups.sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
    return { groups, singles };
  }, [data, groupMode]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ["Data", "Documento", "Tipo", "Produto", "Variante", "Qtd", "Feito", "Estado", "Origem doc", "Parceiro"],
      ...data.map((r: any) => [
        new Date(r.created_at).toLocaleString("pt-PT"),
        r.stock_pickings?.name ?? "",
        r.stock_pickings?.kind ?? "",
        r.products?.name ?? "",
        variantLabel(r.product_variants),
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

  const Row = ({ r, indent }: { r: any; indent?: boolean }) => (
    <tr className="border-t">
      <td className="px-3 py-2" style={indent ? { paddingLeft: 36 } : undefined}>
        {indent ? "↳ " : ""}{new Date(r.created_at).toLocaleString("pt-PT")}
      </td>
      <td className="px-3 py-2">
        {r.stock_pickings?.id ? (
          <Link to={`/inventory/transfers/${r.stock_pickings.id}`} className="text-primary hover:underline">
            {r.stock_pickings.name}
          </Link>
        ) : "—"}
      </td>
      <td className="px-3 py-2">{kindLabel(r.stock_pickings?.kind)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span>{r.products?.name ?? "—"}</span>
          {r.product_variants && (
            <span className="text-xs text-muted-foreground">{variantLabel(r.product_variants)}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{r.stock_pickings?.partners?.name ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
      <td className="px-3 py-2 text-right tabular-nums">{r.quantity_done}</td>
      <td className="px-3 py-2"><span className="o-state-badge">{stateLabel(r.state)}</span></td>
      <td className="px-3 py-2 text-xs">{r.stock_pickings?.origin ?? "—"}</td>
    </tr>
  );

  const renderBody = () => {
    if (isLoading) return <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Carregando…</td></tr>;
    if (!data || data.length === 0) return <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Sem movimentos</td></tr>;
    if (!groupMode) return data.map((r: any) => <Row key={r.id} r={r} />);
    const out: JSX.Element[] = [];
    for (const g of grouped.groups) {
      const isOpen = expanded.has(g.origin);
      out.push(
        <tr key={`g-${g.origin}`} className="border-t bg-muted/20 hover:bg-accent/30 cursor-pointer" onClick={() => toggleExpand(g.origin)}>
          <td className="px-3 py-2">
            <button className="text-muted-foreground" onClick={(e) => { e.stopPropagation(); toggleExpand(g.origin); }}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </td>
          <td className="px-3 py-2 font-semibold" colSpan={2}>{g.origin}</td>
          <td className="px-3 py-2 text-xs text-muted-foreground"><Badge variant="outline">{g.count} movimentos</Badge></td>
          <td className="px-3 py-2 text-xs">{g.partner ?? "—"}</td>
          <td className="px-3 py-2" colSpan={3}></td>
          <td className="px-3 py-2 text-xs">{g.lastDate ? new Date(g.lastDate).toLocaleString("pt-PT") : "—"}</td>
        </tr>
      );
      if (isOpen) g.items.forEach((r: any) => out.push(<Row key={r.id} r={r} indent />));
    }
    for (const r of grouped.singles) out.push(<Row key={r.id} r={r} />);
    return out;
  };

  return (
    <>
      <PageHeader
        title="Movimentos de Stock"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Movimentos" }]}
        actions={<Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>}
      />
      <PageBody>
        <Card className="p-3 mb-4 flex flex-wrap items-center gap-3">
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
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Switch id="group-moves" checked={groupMode} onCheckedChange={setGroupMode} />
            <Label htmlFor="group-moves" className="cursor-pointer">Agrupar por origem (SO/PO)</Label>
          </div>
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
                  <th className="text-left px-3 py-2">Parceiro</th>
                  <th className="text-right px-3 py-2">Qtd</th>
                  <th className="text-right px-3 py-2">Feito</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">Origem doc</th>
                </tr>
              </thead>
              <tbody>{renderBody()}</tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
