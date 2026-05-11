import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, ChevronDown, ChevronRight, Warehouse as WarehouseIcon, AlertCircle, ArrowRightLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { stateLabel, kindLabel } from "@/lib/picking";

type ForecastRow = {
  product_id: string;
  warehouse_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  outgoing: number;
  forecasted: number;
  sold_30d: number;
};

type Product = {
  id: string;
  name: string;
  internal_ref: string | null;
  image_url: string | null;
  can_be_sold: boolean;
  active: boolean;
  list_price: number;
};

type Warehouse = { id: string; name: string; code: string };

type Quant = {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  reserved_quantity: number;
  stock_locations: { warehouse_id: string; name: string } | null;
};

type Variant = {
  id: string;
  product_id: string;
  sku: string | null;
  image_url: string | null;
  active: boolean;
  product_variant_values: { product_attribute_values: { name: string } | null }[];
};

type Move = {
  id: string;
  created_at: string;
  variant_id: string | null;
  quantity: number;
  quantity_done: number;
  reserved_quantity: number;
  state: string;
  reference: string | null;
  stock_pickings: { id: string; name: string; kind: string; warehouse_id: string | null; origin: string | null; partners: { name: string } | null } | null;
};

export default function SalesStockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [search, setSearch] = useState("");
  const [filterWh, setFilterWh] = useState<string>("all");
  const [hideZero, setHideZero] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, Variant[]>>({});
  const [quantsByProduct, setQuantsByProduct] = useState<Record<string, Quant[]>>({});
  const [movesByProduct, setMovesByProduct] = useState<Record<string, Move[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: prods }, { data: fc }, { data: whs }] = await Promise.all([
        supabase.from("products").select("id,name,internal_ref,image_url,can_be_sold,active,list_price").eq("active", true).eq("can_be_sold", true).order("name"),
        supabase.from("product_stock_forecast").select("*"),
        supabase.from("warehouses").select("id,name,code").eq("active", true).order("name"),
      ]);
      setProducts((prods as Product[]) ?? []);
      setForecast((fc as ForecastRow[]) ?? []);
      setWarehouses((whs as Warehouse[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Aggregate forecast by product (filtered by warehouse if applicable)
  const productStock = useMemo(() => {
    const m: Record<string, { on_hand: number; reserved: number; available: number; forecasted: number; incoming: number; outgoing: number; sold_30d: number }> = {};
    for (const r of forecast) {
      if (filterWh !== "all" && r.warehouse_id !== filterWh) continue;
      m[r.product_id] ??= { on_hand: 0, reserved: 0, available: 0, forecasted: 0, incoming: 0, outgoing: 0, sold_30d: 0 };
      m[r.product_id].on_hand += Number(r.on_hand || 0);
      m[r.product_id].reserved += Number(r.reserved || 0);
      m[r.product_id].available += Number(r.available || 0);
      m[r.product_id].forecasted += Number(r.forecasted || 0);
      m[r.product_id].incoming += Number(r.incoming || 0);
      m[r.product_id].outgoing += Number(r.outgoing || 0);
      m[r.product_id].sold_30d += Number(r.sold_30d || 0);
    }
    return m;
  }, [forecast, filterWh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.internal_ref ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const s = productStock[p.id];
      if (hideZero && (!s || (s.on_hand === 0 && s.forecasted === 0 && s.incoming === 0))) return false;
      if (onlyLow && s && s.available > 0) return false;
      return true;
    });
  }, [products, search, productStock, hideZero, onlyLow]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (a, p) => {
        const s = productStock[p.id];
        if (!s) return a;
        return {
          on_hand: a.on_hand + s.on_hand,
          available: a.available + s.available,
          forecasted: a.forecasted + s.forecasted,
          reserved: a.reserved + s.reserved,
        };
      },
      { on_hand: 0, available: 0, forecasted: 0, reserved: 0 },
    );
  }, [filtered, productStock]);

  const toggleExpand = async (productId: string) => {
    const isOpen = !!expanded[productId];
    setExpanded((p) => ({ ...p, [productId]: !isOpen }));
    if (isOpen) return;
    if (variantsByProduct[productId] && quantsByProduct[productId]) return;
    setLoadingDetails((p) => ({ ...p, [productId]: true }));
    const [{ data: vs }, { data: qs }] = await Promise.all([
      supabase.from("product_variants").select("id,product_id,sku,image_url,active,product_variant_values(product_attribute_values(name))").eq("product_id", productId),
      supabase.from("stock_quants").select("product_id,variant_id,quantity,reserved_quantity,stock_locations(warehouse_id,name)").eq("product_id", productId),
    ]);
    setVariantsByProduct((p) => ({ ...p, [productId]: (vs as Variant[]) ?? [] }));
    setQuantsByProduct((p) => ({ ...p, [productId]: (qs as Quant[]) ?? [] }));
    setLoadingDetails((p) => ({ ...p, [productId]: false }));
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Stock de Vendas</h1>
          <p className="text-sm text-muted-foreground">Consulta rápida de stock interno, previsto e vendável por produto e variante.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Em mão</div><div className="text-2xl font-semibold">{fmtNumber(totals.on_hand)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Reservado</div><div className="text-2xl font-semibold text-amber-600">{fmtNumber(totals.reserved)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Vendável (Disponível)</div><div className="text-2xl font-semibold text-emerald-600">{fmtNumber(totals.available)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Previsto</div><div className="text-2xl font-semibold text-primary">{fmtNumber(totals.forecasted)}</div></Card>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Buscar por nome ou referência…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Armazém</div>
            <Select value={filterWh} onValueChange={setFilterWh}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos armazéns</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground h-9">
            <Switch checked={hideZero} onCheckedChange={setHideZero} />
            Ocultar sem stock
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground h-9">
            <Switch checked={onlyLow} onCheckedChange={setOnlyLow} />
            Apenas sem disponível
          </label>
        </div>
      </Card>

      {/* Products table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0">
              <tr>
                <th className="w-8 p-2"></th>
                <th className="text-left p-2 w-12">Foto</th>
                <th className="text-left p-2">Produto</th>
                <th className="text-left p-2 w-32">Referência</th>
                <th className="text-right p-2 w-24">Em mão</th>
                <th className="text-right p-2 w-24">Reservado</th>
                <th className="text-right p-2 w-28">Vendável</th>
                <th className="text-right p-2 w-24">A receber</th>
                <th className="text-right p-2 w-24">A entregar</th>
                <th className="text-right p-2 w-24">Previsto</th>
                <th className="text-right p-2 w-24">Vendido 30d</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="text-center text-muted-foreground py-8">A carregar…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="text-center text-muted-foreground py-8">Nenhum produto encontrado</td></tr>
              ) : filtered.map((p) => {
                const s = productStock[p.id] ?? { on_hand: 0, reserved: 0, available: 0, forecasted: 0, incoming: 0, outgoing: 0, sold_30d: 0 };
                const isOpen = !!expanded[p.id];
                const lowStock = s.available <= 0;
                return (
                  <ProductRow
                    key={p.id}
                    p={p}
                    s={s}
                    isOpen={isOpen}
                    lowStock={lowStock}
                    onToggle={() => toggleExpand(p.id)}
                    warehouses={warehouses}
                    filterWh={filterWh}
                    variants={variantsByProduct[p.id]}
                    quants={quantsByProduct[p.id]}
                    loadingDetails={!!loadingDetails[p.id]}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ProductRow({ p, s, isOpen, lowStock, onToggle, warehouses, filterWh, variants, quants, loadingDetails }: {
  p: Product;
  s: { on_hand: number; reserved: number; available: number; forecasted: number; incoming: number; outgoing: number; sold_30d: number };
  isOpen: boolean;
  lowStock: boolean;
  onToggle: () => void;
  warehouses: Warehouse[];
  filterWh: string;
  variants?: Variant[];
  quants?: Quant[];
  loadingDetails: boolean;
}) {
  // Per-variant-warehouse matrix
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, { qty: number; reserved: number }>> = {};
    (quants ?? []).forEach((q) => {
      const vid = q.variant_id || "_no_variant";
      const wid = q.stock_locations?.warehouse_id || "_unknown";
      if (filterWh !== "all" && wid !== filterWh) return;
      m[vid] ??= {};
      m[vid][wid] ??= { qty: 0, reserved: 0 };
      m[vid][wid].qty += Number(q.quantity || 0);
      m[vid][wid].reserved += Number(q.reserved_quantity || 0);
    });
    return m;
  }, [quants, filterWh]);

  const visibleWarehouses = useMemo(() => {
    if (filterWh !== "all") return warehouses.filter((w) => w.id === filterWh);
    const present = new Set<string>();
    (quants ?? []).forEach((q) => q.stock_locations?.warehouse_id && present.add(q.stock_locations.warehouse_id));
    return warehouses.filter((w) => present.has(w.id));
  }, [warehouses, quants, filterWh]);

  return (
    <>
      <tr className={`border-t hover:bg-muted/30 ${lowStock ? "bg-rose-50/40 dark:bg-rose-950/10" : ""}`}>
        <td className="p-2">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggle}>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </td>
        <td className="p-1">
          <div className="w-9 h-9 border rounded bg-muted/30 overflow-hidden">
            {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : null}
          </div>
        </td>
        <td className="p-2">
          <Link to={`/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
          {lowStock && <Badge variant="destructive" className="ml-2 text-[10px]"><AlertCircle className="h-3 w-3 mr-1" />Sem stock</Badge>}
        </td>
        <td className="p-2 font-mono text-xs text-muted-foreground">{p.internal_ref || "—"}</td>
        <td className="p-2 text-right">{fmtNumber(s.on_hand)}</td>
        <td className="p-2 text-right text-amber-600">{s.reserved > 0 ? fmtNumber(s.reserved) : "—"}</td>
        <td className={`p-2 text-right font-semibold ${lowStock ? "text-destructive" : "text-emerald-600"}`}>{fmtNumber(s.available)}</td>
        <td className="p-2 text-right text-emerald-600">{s.incoming > 0 ? `+${fmtNumber(s.incoming)}` : "—"}</td>
        <td className="p-2 text-right text-rose-600">{s.outgoing > 0 ? `−${fmtNumber(s.outgoing)}` : "—"}</td>
        <td className="p-2 text-right font-semibold text-primary">{fmtNumber(s.forecasted)}</td>
        <td className="p-2 text-right text-muted-foreground">{fmtNumber(s.sold_30d)}</td>
      </tr>
      {isOpen && (
        <tr className="bg-muted/10">
          <td></td>
          <td colSpan={10} className="p-3">
            {loadingDetails ? (
              <div className="text-xs text-muted-foreground py-3">A carregar variantes…</div>
            ) : !variants || variants.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                <WarehouseIcon className="h-3.5 w-3.5" />
                Sem variantes. Stock interno por armazém:
                <div className="flex gap-2 ml-2 flex-wrap">
                  {visibleWarehouses.length === 0 ? <span>Sem stock registado</span> : visibleWarehouses.map((w) => {
                    const cell = matrix["_no_variant"]?.[w.id];
                    if (!cell) return null;
                    return <Badge key={w.id} variant="outline">{w.name}: {fmtNumber(cell.qty - cell.reserved)} {cell.reserved > 0 && `/ ${fmtNumber(cell.qty)}`}</Badge>;
                  })}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 w-10">Foto</th>
                      <th className="text-left p-2">Variante</th>
                      <th className="text-left p-2 w-28">SKU</th>
                      {visibleWarehouses.map((w) => <th key={w.id} className="text-right p-2 w-24">{w.name}</th>)}
                      <th className="text-right p-2 w-24 bg-muted/60">Total vendável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWarehouses.length === 0 ? (
                      <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">Sem stock para os filtros aplicados</td></tr>
                    ) : variants.map((v) => {
                      const cells = matrix[v.id] || {};
                      const total = Object.values(cells).reduce((a, x) => ({ qty: a.qty + x.qty, reserved: a.reserved + x.reserved }), { qty: 0, reserved: 0 });
                      return (
                        <tr key={v.id} className={`border-t ${!v.active ? "opacity-50" : ""}`}>
                          <td className="p-1">
                            <div className="w-8 h-8 border rounded bg-muted/30 overflow-hidden">
                              {v.image_url ? <img src={v.image_url} alt="" className="w-full h-full object-cover" /> : null}
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {v.product_variant_values.map((pvv, i) => (
                                <Badge key={i} variant="outline" className="text-[10px]">{pvv.product_attribute_values?.name}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-2 font-mono text-muted-foreground">{v.sku || "—"}</td>
                          {visibleWarehouses.map((w) => {
                            const cell = cells[w.id];
                            const q = cell?.qty || 0;
                            const r = cell?.reserved || 0;
                            const avail = q - r;
                            return (
                              <td key={w.id} className="p-2 text-right">
                                {q === 0 && r === 0 ? <span className="text-muted-foreground/40">—</span> : (
                                  <div>
                                    <div className={`font-medium ${avail <= 0 ? "text-destructive" : ""}`}>{fmtNumber(avail)}</div>
                                    {r > 0 && <div className="text-[9px] text-muted-foreground">{fmtNumber(q)} − {fmtNumber(r)} res.</div>}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2 text-right bg-muted/30 font-semibold">
                            {fmtNumber(total.qty - total.reserved)}
                            {total.reserved > 0 && <div className="text-[9px] text-muted-foreground font-normal">de {fmtNumber(total.qty)}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
