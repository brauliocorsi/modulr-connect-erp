import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { Box, Package, Printer } from "lucide-react";
import PutawayDialog from "@/modules/inventory/PutawayDialog";
import { Button } from "@/components/ui/button";
import { printBinLabel, printColisLabels } from "@/modules/barcode/printBarcodes";

type Row = {
  id: string;
  product_id: string;
  variant_id: string | null;
  package_id: string | null;
  location_id: string;
  quantity: number;
  reserved_quantity: number;
  product?: { name: string };
  location?: { name: string; full_path: string | null; barcode: string | null };
  pkg?: { label: string; barcode: string | null } | null;
};

export default function BinsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data: q } = await supabase
      .from("stock_quants")
      .select("id, product_id, variant_id, package_id, location_id, quantity, reserved_quantity")
      .gt("quantity", 0)
      .limit(2000);
    const list = (q as any[]) ?? [];
    const productIds = Array.from(new Set(list.map((r) => r.product_id)));
    const locIds = Array.from(new Set(list.map((r) => r.location_id)));
    const pkgIds = Array.from(new Set(list.map((r) => r.package_id).filter(Boolean)));
    const [{ data: prods }, { data: locs }, { data: pkgs }] = await Promise.all([
      productIds.length ? supabase.from("products").select("id,name").in("id", productIds) : Promise.resolve({ data: [] as any[] }),
      locIds.length ? supabase.from("stock_locations").select("id,name,full_path,barcode,type,is_bin").in("id", locIds) : Promise.resolve({ data: [] as any[] }),
      pkgIds.length ? supabase.from("product_packages").select("id,label,barcode").in("id", pkgIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const pmap = new Map((prods ?? []).map((p: any) => [p.id, p]));
    const lmap = new Map((locs ?? []).map((l: any) => [l.id, l]));
    const kmap = new Map((pkgs ?? []).map((p: any) => [p.id, p]));
    setRows(list
      .map((r) => ({ ...r, product: pmap.get(r.product_id), location: lmap.get(r.location_id), pkg: r.package_id ? kmap.get(r.package_id) : null }))
      .filter((r) => r.location && r.location.type === "internal"));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.product?.name ?? "").toLowerCase().includes(s)
      || (r.location?.name ?? "").toLowerCase().includes(s)
      || (r.location?.full_path ?? "").toLowerCase().includes(s)
      || (r.location?.barcode ?? "").toLowerCase().includes(s)
      || (r.pkg?.label ?? "").toLowerCase().includes(s)
      || (r.pkg?.barcode ?? "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  // group by bin
  const byBin = useMemo(() => {
    const map = new Map<string, { loc: any; items: Row[] }>();
    for (const r of filtered) {
      const k = r.location_id;
      if (!map.has(k)) map.set(k, { loc: r.location, items: [] });
      map.get(k)!.items.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => (a[1].loc?.full_path ?? "").localeCompare(b[1].loc?.full_path ?? ""));
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Stock por Bin"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Bins" }]}
      />
      <PageBody>
        <Card className="p-3 mb-3">
          <Input placeholder="Pesquisar produto, bin, código…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Card>
        {byBin.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">Sem stock em bins.</Card>
        ) : (
          <div className="grid gap-3">
            {byBin.map(([id, { loc, items }]) => (
              <Card key={id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Box className="h-4 w-4 text-amber-600" />
                  <Link to={`/inventory/locations/${id}`} className="font-semibold hover:underline">{loc?.full_path ?? loc?.name}</Link>
                  {loc?.barcode && <span className="font-mono text-xs text-muted-foreground">{loc.barcode}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => printBinLabel(id)} title="Imprimir etiqueta do bin">
                      <Printer className="h-3.5 w-3.5 mr-1" /> Etiqueta
                    </Button>
                    <PutawayDialog locationId={id} locationLabel={loc?.full_path ?? loc?.name} onDone={load} />
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-1">Produto</th>
                      <th className="text-left px-3 py-1">Colis</th>
                      <th className="text-right px-3 py-1 w-24">Qtd</th>
                      <th className="text-right px-3 py-1 w-24">Reservado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-1">
                          <Link to={`/products/${r.product_id}`} className="hover:underline inline-flex items-center gap-1">
                            <Package className="h-3 w-3" /> {r.product?.name ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-1">
                          {r.pkg ? (
                            <span className="inline-flex items-center gap-1">
                              <strong>{r.pkg.label}</strong>
                              {r.pkg.barcode ? <span className="font-mono ml-1 text-xs text-muted-foreground">{r.pkg.barcode}</span> : null}
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Imprimir etiqueta do colis (com local)"
                                onClick={() => printColisLabels([r.package_id!], { bin: { name: r.location?.full_path ?? r.location?.name ?? "", barcode: r.location?.barcode } })}>
                                <Printer className="h-3 w-3" />
                              </Button>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums font-medium">{Number(r.quantity)}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{Number(r.reserved_quantity || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
