import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Package,
  ChevronDown,
  ChevronRight,
  Warehouse as WarehouseIcon,
  AlertCircle,
  ArrowRightLeft,
  LayoutGrid,
  List as ListIcon,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
    if (variantsByProduct[productId] && quantsByProduct[productId] && movesByProduct[productId]) return;
    setLoadingDetails((p) => ({ ...p, [productId]: true }));
    const [{ data: vs }, { data: qs }, { data: mv }] = await Promise.all([
      supabase.from("product_variants").select("id,product_id,sku,image_url,active,product_variant_values(product_attribute_values(name))").eq("product_id", productId),
      supabase.from("stock_quants").select("product_id,variant_id,quantity,reserved_quantity,stock_locations(warehouse_id,name,type)").eq("product_id", productId),
      supabase.from("stock_moves")
        .select("id,created_at,variant_id,quantity,quantity_done,reserved_quantity,state,reference,stock_pickings!inner(id,name,kind,warehouse_id,origin,partners(name))")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    // Enrich moves missing variant_id by looking up the source order line via origin (e.g. SO00001 / PO00001)
    const moves = (mv as Move[]) ?? [];
    const orphanOrigins = Array.from(new Set(
      moves.filter((m) => !m.variant_id && m.stock_pickings?.origin).map((m) => m.stock_pickings!.origin as string)
    ));
    const inferred: Record<string, string> = {}; // origin -> variant_id
    if (orphanOrigins.length > 0) {
      const saleOrigins = orphanOrigins.filter((o) => o.startsWith("SO"));
      const purchaseOrigins = orphanOrigins.filter((o) => o.startsWith("PO"));
      const [soRes, poRes] = await Promise.all([
        saleOrigins.length
          ? supabase.from("sale_order_lines").select("variant_id, sale_orders!inner(name)").eq("product_id", productId).in("sale_orders.name", saleOrigins).not("variant_id", "is", null)
          : Promise.resolve({ data: [] as any[] }),
        purchaseOrigins.length
          ? supabase.from("purchase_order_lines").select("variant_id, purchase_orders!inner(name)").eq("product_id", productId).in("purchase_orders.name", purchaseOrigins).not("variant_id", "is", null)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      ((soRes.data as any[]) || []).forEach((r) => { if (r.sale_orders?.name && r.variant_id) inferred[r.sale_orders.name] = r.variant_id; });
      ((poRes.data as any[]) || []).forEach((r) => { if (r.purchase_orders?.name && r.variant_id) inferred[r.purchase_orders.name] = r.variant_id; });
    }
    const enriched = moves.map((m) => {
      if (m.variant_id) return m;
      const origin = m.stock_pickings?.origin;
      const inf = origin ? inferred[origin] : undefined;
      return inf ? { ...m, variant_id: inf, _inferred: true } as any : m;
    });

    setVariantsByProduct((p) => ({ ...p, [productId]: (vs as Variant[]) ?? [] }));
    setQuantsByProduct((p) => ({ ...p, [productId]: (qs as Quant[]) ?? [] }));
    setMovesByProduct((p) => ({ ...p, [productId]: enriched }));
    setLoadingDetails((p) => ({ ...p, [productId]: false }));
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Stock de Vendas</h1>
          <p className="text-sm text-muted-foreground">Visualize stock por produto, variante e armazém em tempo real.</p>
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

      {/* Products list */}
      {loading ? (
        <Card className="p-8 text-center text-muted-foreground">A carregar…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Nenhum produto encontrado</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const s = productStock[p.id] ?? { on_hand: 0, reserved: 0, available: 0, forecasted: 0, incoming: 0, outgoing: 0, sold_30d: 0 };
            return (
              <ProductCard
                key={p.id}
                p={p}
                s={s}
                isOpen={!!expanded[p.id]}
                onToggle={() => toggleExpand(p.id)}
                warehouses={warehouses}
                filterWh={filterWh}
                variants={variantsByProduct[p.id]}
                quants={quantsByProduct[p.id]}
                moves={movesByProduct[p.id]}
                loadingDetails={!!loadingDetails[p.id]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, s, isOpen, onToggle, warehouses, filterWh, variants, quants, moves, loadingDetails }: {
  p: Product;
  s: { on_hand: number; reserved: number; available: number; forecasted: number; incoming: number; outgoing: number; sold_30d: number };
  isOpen: boolean;
  onToggle: () => void;
  warehouses: Warehouse[];
  filterWh: string;
  variants?: Variant[];
  quants?: Quant[];
  moves?: Move[];
  loadingDetails: boolean;
}) {
  const [variantFilter, setVariantFilter] = useState<string>("all");
  const [variantView, setVariantView] = useState<"grid" | "matrix">("grid");
  const [dirFilter, setDirFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [onlyDone, setOnlyDone] = useState(true);

  const lowStock = s.available <= 0;

  const variantById = useMemo(() => {
    const m: Record<string, Variant> = {};
    (variants ?? []).forEach((v) => { m[v.id] = v; });
    return m;
  }, [variants]);

  const whName = (wid: string | null) => warehouses.find((w) => w.id === wid)?.name ?? "—";

  // Per-variant-warehouse matrix
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, { qty: number; reserved: number }>> = {};
    (quants ?? []).forEach((q) => {
      // Apenas localizações internas contam para "vendável"
      if ((q.stock_locations as any)?.type !== "internal") return;
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
    (quants ?? []).forEach((q) => {
      if ((q.stock_locations as any)?.type !== "internal") return;
      if (q.stock_locations?.warehouse_id) present.add(q.stock_locations.warehouse_id);
    });
    return warehouses.filter((w) => present.has(w.id));
  }, [warehouses, quants, filterWh]);

  const variantTotals = useMemo(() => {
    const m: Record<string, { qty: number; reserved: number; available: number }> = {};
    Object.entries(matrix).forEach(([vid, whMap]) => {
      const t = Object.values(whMap).reduce((a, x) => ({ qty: a.qty + x.qty, reserved: a.reserved + x.reserved }), { qty: 0, reserved: 0 });
      m[vid] = { ...t, available: t.qty - t.reserved };
    });
    return m;
  }, [matrix]);

  const maxAvailable = useMemo(() => {
    return Math.max(1, ...Object.values(variantTotals).map((t) => t.available));
  }, [variantTotals]);

  const movesByDir = useMemo(() => {
    const all = (moves ?? []).filter((m) => filterWh === "all" || m.stock_pickings?.warehouse_id === filterWh);
    return {
      all,
      incoming: all.filter((m) => m.stock_pickings?.kind === "incoming"),
      outgoing: all.filter((m) => m.stock_pickings?.kind === "outgoing"),
    };
  }, [moves, filterWh]);

  const dirScopedMoves = dirFilter === "all" ? movesByDir.all : movesByDir[dirFilter];

  const variantMoveCounts = useMemo(() => {
    const c: Record<string, number> = {};
    dirScopedMoves.forEach((m) => {
      const k = m.variant_id ?? "_no_variant";
      c[k] = (c[k] ?? 0) + 1;
    });
    return c;
  }, [dirScopedMoves]);

  const totalMovesCount = dirScopedMoves.length;

  const filteredMoves = useMemo(() => {
    return dirScopedMoves.filter((m) => {
      if (variantFilter !== "all") {
        if (variantFilter === "_no_variant") { if (m.variant_id) return false; }
        else if (m.variant_id !== variantFilter) return false;
      }
      return true;
    });
  }, [dirScopedMoves, variantFilter]);

  const hasVariants = (variants ?? []).length > 0;

  const renderVariantBadges = (vid: string | null, inferred?: boolean) => {
    if (!vid) {
      if (hasVariants) {
        return (
          <div className="inline-flex items-center gap-1 text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded px-1.5 py-0.5">
            <AlertCircle className="h-3 w-3" />
            <span className="font-medium">Variante não definida</span>
            <span className="text-muted-foreground">— {(variants ?? []).length} disponíveis</span>
          </div>
        );
      }
      return <span className="text-muted-foreground italic text-[11px]">Sem variante</span>;
    }
    const v = variantById[vid];
    if (!v) return <span className="text-muted-foreground">{vid.slice(0, 6)}</span>;
    const attrs = v.product_variant_values.map((pv) => pv.product_attribute_values?.name).filter(Boolean) as string[];
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-6 h-6 border rounded bg-muted/30 overflow-hidden flex-shrink-0">
          {v.image_url ? <img src={v.image_url} alt="" className="w-full h-full object-cover" /> : null}
        </div>
        <div className="flex flex-wrap gap-0.5 items-center">
          {attrs.length > 0 ? attrs.map((a, i) => (
            <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0 h-4">{a}</Badge>
          )) : v.sku ? <span className="font-mono text-[10px]">{v.sku}</span> : <span className="text-muted-foreground">—</span>}
          {inferred && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-500 text-amber-700 dark:text-amber-400" title="Variante inferida a partir da linha do pedido de origem">inferido</Badge>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className={`overflow-hidden transition-shadow ${isOpen ? "shadow-md" : "hover:shadow-sm"}`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className={`w-full text-left p-3 flex items-center gap-3 transition-colors ${lowStock ? "bg-rose-50/40 dark:bg-rose-950/10" : ""} hover:bg-muted/40`}
      >
        <div className="w-7 h-7 flex items-center justify-center text-muted-foreground">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="w-12 h-12 border rounded-md bg-muted/30 overflow-hidden flex-shrink-0">
          {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground/40" /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/products/${p.id}`} className="font-medium hover:underline truncate" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
            {lowStock && <Badge variant="destructive" className="text-[10px]"><AlertCircle className="h-3 w-3 mr-1" />Sem stock</Badge>}
          </div>
          {p.internal_ref && <div className="font-mono text-[11px] text-muted-foreground">{p.internal_ref}</div>}
        </div>
        {/* Inline KPIs */}
        <div className="hidden md:grid grid-cols-5 gap-3 items-center text-right">
          <Stat label="Em mão" value={s.on_hand} />
          <Stat label="Reservado" value={s.reserved} tone={s.reserved > 0 ? "amber" : undefined} />
          <Stat label="Vendável" value={s.available} tone={lowStock ? "destructive" : "emerald"} bold />
          <Stat label="Previsto" value={s.forecasted} tone="primary" />
          <Stat label="Vendido 30d" value={s.sold_30d} muted />
        </div>
        <div className="md:hidden text-right">
          <div className={`text-lg font-bold ${lowStock ? "text-destructive" : "text-emerald-600"}`}>{fmtNumber(s.available)}</div>
          <div className="text-[10px] text-muted-foreground">Vendável</div>
        </div>
      </button>

      {/* Expanded */}
      {isOpen && (
        <div className="border-t bg-muted/10 p-4 space-y-4">
          {/* Mobile inline KPIs */}
          <div className="md:hidden grid grid-cols-3 gap-2">
            <KpiMini label="Em mão" value={s.on_hand} />
            <KpiMini label="Reservado" value={s.reserved} tone={s.reserved > 0 ? "amber" : undefined} />
            <KpiMini label="Vendável" value={s.available} tone={lowStock ? "destructive" : "emerald"} />
            <KpiMini label="A receber" value={s.incoming} tone="emerald" sign="+" />
            <KpiMini label="A entregar" value={s.outgoing} tone="rose" sign="−" />
            <KpiMini label="Previsto" value={s.forecasted} tone="primary" />
          </div>

          {/* Per-warehouse strip */}
          {visibleWarehouses.length > 0 && (
            <div>
              <div className="text-xs font-semibold flex items-center gap-1 text-muted-foreground mb-2">
                <WarehouseIcon className="h-3.5 w-3.5" /> Stock por armazém
              </div>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {visibleWarehouses.map((w) => {
                  const totalsForWh = (quants ?? [])
                    .filter((q) => q.stock_locations?.warehouse_id === w.id)
                    .reduce((a, q) => ({ qty: a.qty + Number(q.quantity || 0), res: a.res + Number(q.reserved_quantity || 0) }), { qty: 0, res: 0 });
                  const avail = totalsForWh.qty - totalsForWh.res;
                  return (
                    <div key={w.id} className="border rounded-md p-2 bg-background">
                      <div className="text-[11px] font-medium text-muted-foreground truncate">{w.name}</div>
                      <div className="flex items-baseline justify-between mt-0.5">
                        <span className={`text-lg font-semibold ${avail <= 0 ? "text-destructive" : "text-emerald-600"}`}>{fmtNumber(avail)}</span>
                        <span className="text-[10px] text-muted-foreground">de {fmtNumber(totalsForWh.qty)}</span>
                      </div>
                      {totalsForWh.res > 0 && <div className="text-[10px] text-amber-600">{fmtNumber(totalsForWh.res)} reservado</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Variants section */}
          {loadingDetails ? (
            <div className="text-xs text-muted-foreground py-3">A carregar variantes…</div>
          ) : !variants || variants.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Este produto não possui variantes.</div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="text-xs font-semibold flex items-center gap-1 text-muted-foreground">
                  <Package className="h-3.5 w-3.5" /> Stock por variante ({variants.length})
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setOnlyWithStock((v) => !v)}
                    className={`text-[11px] px-2 py-1 rounded border transition-colors ${onlyWithStock ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                  >
                    {onlyWithStock ? "Mostrar todas" : "Só com stock"}
                  </button>
                  <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
                    <button
                      onClick={() => setVariantView("grid")}
                      className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${variantView === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    ><LayoutGrid className="h-3 w-3" /> Grade</button>
                    <button
                      onClick={() => setVariantView("matrix")}
                      className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 transition-colors ${variantView === "matrix" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    ><ListIcon className="h-3 w-3" /> Matriz</button>
                  </div>
                </div>
              </div>

              {(() => {
                const displayedVariants = onlyWithStock
                  ? variants.filter((v) => (variantTotals[v.id]?.qty ?? 0) > 0 || (variantTotals[v.id]?.reserved ?? 0) > 0)
                  : variants;
                return variantView === "grid" ? (
                  <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {displayedVariants.length === 0 ? (
                      <div className="col-span-full text-xs text-muted-foreground italic py-4 text-center">Nenhuma variante com stock.</div>
                    ) : displayedVariants.map((v) => {
                    const t = variantTotals[v.id] ?? { qty: 0, reserved: 0, available: 0 };
                    const cells = matrix[v.id] || {};
                    const isActive = variantFilter === v.id;
                    const moveCount = variantMoveCounts[v.id] ?? 0;
                    const attrs = v.product_variant_values.map((pv) => pv.product_attribute_values?.name).filter(Boolean) as string[];
                    const pct = Math.min(100, Math.round((Math.max(0, t.available) / maxAvailable) * 100));
                    const empty = t.qty === 0 && t.reserved === 0;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVariantFilter(isActive ? "all" : v.id)}
                        className={`text-left border rounded-lg p-3 bg-background transition-all ${
                          isActive ? "ring-2 ring-primary border-primary" : "hover:border-primary/40 hover:shadow-sm"
                        } ${!v.active ? "opacity-50" : ""} ${empty ? "border-dashed" : ""}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="w-14 h-14 border rounded-md bg-muted/30 overflow-hidden flex-shrink-0">
                            {v.image_url ? <img src={v.image_url} alt="" className="w-full h-full object-cover" /> :
                              <div className="w-full h-full flex items-center justify-center"><Package className="h-5 w-5 text-muted-foreground/40" /></div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap gap-1 mb-1">
                              {attrs.length > 0 ? attrs.map((a, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{a}</Badge>
                              )) : <span className="text-[11px] text-muted-foreground italic">Sem atributos</span>}
                            </div>
                            {v.sku && <div className="font-mono text-[10px] text-muted-foreground truncate">{v.sku}</div>}
                          </div>
                        </div>

                        <div className="mt-2 flex items-baseline justify-between">
                          <div>
                            <div className={`text-2xl font-bold leading-none ${t.available <= 0 ? "text-destructive" : "text-emerald-600"}`}>
                              {fmtNumber(t.available)}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">vendável</div>
                          </div>
                          <div className="text-right text-[10px] text-muted-foreground">
                            <div>Em mão: <span className="font-medium text-foreground">{fmtNumber(t.qty)}</span></div>
                            {t.reserved > 0 && <div className="text-amber-600">Res.: {fmtNumber(t.reserved)}</div>}
                          </div>
                        </div>

                        {/* Bar */}
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${t.available <= 0 ? "bg-destructive/40" : "bg-emerald-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* Per-warehouse mini chips */}
                        {Object.keys(cells).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {visibleWarehouses.map((w) => {
                              const c = cells[w.id];
                              if (!c) return null;
                              const a = c.qty - c.reserved;
                              return (
                                <span key={w.id} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/60 border" title={`${w.name}: ${a} disponível${c.reserved ? ` (${c.reserved} reserv.)` : ""}`}>
                                  {w.name}: <span className={`font-semibold ${a <= 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtNumber(a)}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{moveCount > 0 ? `${moveCount} movimento(s)` : "Sem movimentos"}</span>
                          {isActive && <Badge variant="default" className="text-[9px] px-1 h-4">Filtrado</Badge>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 w-10"></th>
                        <th className="text-left p-2">Variante</th>
                        <th className="text-left p-2 w-28">SKU</th>
                        {visibleWarehouses.map((w) => <th key={w.id} className="text-right p-2 w-24">{w.name}</th>)}
                        <th className="text-right p-2 w-24 bg-muted/60">Vendável</th>
                        <th className="text-right p-2 w-16">Mov.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedVariants.length === 0 ? (
                        <tr><td colSpan={3 + visibleWarehouses.length + 2} className="p-4 text-center text-muted-foreground italic text-xs">Nenhuma variante com stock.</td></tr>
                      ) : displayedVariants.map((v) => {
                        const cells = matrix[v.id] || {};
                        const t = variantTotals[v.id] ?? { qty: 0, reserved: 0, available: 0 };
                        const isActive = variantFilter === v.id;
                        const moveCount = variantMoveCounts[v.id] ?? 0;
                        return (
                          <tr
                            key={v.id}
                            onClick={() => setVariantFilter(isActive ? "all" : v.id)}
                            className={`border-t cursor-pointer transition-colors ${!v.active ? "opacity-50" : ""} ${isActive ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/40"}`}
                          >
                            <td className="p-1">
                              <div className="w-8 h-8 border rounded bg-muted/30 overflow-hidden">
                                {v.image_url ? <img src={v.image_url} alt="" className="w-full h-full object-cover" /> : null}
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex flex-wrap gap-1 items-center">
                                {v.product_variant_values.map((pvv, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px]">{pvv.product_attribute_values?.name}</Badge>
                                ))}
                                {isActive && <Badge variant="default" className="text-[9px] px-1 h-4">Filtrado</Badge>}
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
                              {fmtNumber(t.available)}
                              {t.reserved > 0 && <div className="text-[9px] text-muted-foreground font-normal">de {fmtNumber(t.qty)}</div>}
                            </td>
                            <td className="p-2 text-right">
                              {moveCount > 0 ? <Badge variant="outline" className="text-[10px]">{moveCount}</Badge> : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
              })()}
            </div>
          )}

          {/* Movements */}
          {!loadingDetails && (
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-semibold flex items-center gap-1 text-muted-foreground">
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Últimas movimentações
                    <span className="font-normal">({filteredMoves.length}{filteredMoves.length !== totalMovesCount && ` de ${totalMovesCount}`})</span>
                  </div>
                  <div className="inline-flex border rounded-md p-0.5 bg-background">
                    {([
                      { k: "all", label: `Todas (${movesByDir.all.length})`, cls: "" },
                      { k: "incoming", label: `Entradas (${movesByDir.incoming.length})`, cls: "text-emerald-600", Icon: TrendingUp },
                      { k: "outgoing", label: `Saídas (${movesByDir.outgoing.length})`, cls: "text-rose-600", Icon: TrendingDown },
                    ] as const).map((opt) => {
                      const Icon = (opt as any).Icon;
                      const active = dirFilter === opt.k;
                      return (
                        <button
                          key={opt.k}
                          onClick={() => setDirFilter(opt.k as any)}
                          className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${active ? "bg-primary text-primary-foreground" : `hover:bg-muted ${opt.cls}`}`}
                        >
                          {Icon && <Icon className="h-3 w-3" />}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <button
                    onClick={() => setVariantFilter("all")}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${variantFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                  >Todas ({totalMovesCount})</button>
                  {(variants ?? []).filter((v) => (variantMoveCounts[v.id] ?? 0) > 0).map((v) => {
                    const active = variantFilter === v.id;
                    const attrs = v.product_variant_values.map((pv) => pv.product_attribute_values?.name).filter(Boolean).join(" / ") || v.sku || v.id.slice(0, 6);
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVariantFilter(active ? "all" : v.id)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                      >{attrs} ({variantMoveCounts[v.id]})</button>
                    );
                  })}
                  {(variantMoveCounts["_no_variant"] ?? 0) > 0 && (
                    <button
                      onClick={() => setVariantFilter(variantFilter === "_no_variant" ? "all" : "_no_variant")}
                      className={`text-[10px] px-2 py-0.5 rounded border italic transition-colors ${variantFilter === "_no_variant" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
                    >Sem variante ({variantMoveCounts["_no_variant"]})</button>
                  )}
                </div>
              </div>
              {filteredMoves.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">Sem movimentações registadas.</div>
              ) : (
                <div className="overflow-x-auto border rounded max-h-80 bg-background">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Data</th>
                        <th className="text-left p-2">Documento</th>
                        <th className="text-left p-2">Tipo</th>
                        <th className="text-left p-2 min-w-[180px]">Variante</th>
                        <th className="text-left p-2">Armazém</th>
                        <th className="text-left p-2">Parceiro</th>
                        <th className="text-right p-2">Qtd</th>
                        <th className="text-right p-2">Feito</th>
                        <th className="text-right p-2">Reservado</th>
                        <th className="text-left p-2">Estado</th>
                        <th className="text-left p-2">Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMoves.map((m) => {
                        const k = m.stock_pickings?.kind;
                        const dirTone = k === "incoming" ? "text-emerald-600" : k === "outgoing" ? "text-rose-600" : "text-muted-foreground";
                        const dirSign = k === "incoming" ? "+" : k === "outgoing" ? "−" : "";
                        const DirIcon = k === "incoming" ? TrendingUp : k === "outgoing" ? TrendingDown : ArrowRightLeft;
                        return (
                          <tr key={m.id} className="border-t hover:bg-muted/30">
                            <td className="p-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString("pt-PT")}</td>
                            <td className="p-2">
                              {m.stock_pickings?.id ? (
                                <Link to={`/inventory/transfers/${m.stock_pickings.id}`} className="text-primary hover:underline font-medium">{m.stock_pickings.name}</Link>
                              ) : "—"}
                            </td>
                            <td className={`p-2 ${dirTone}`}>
                              <span className="inline-flex items-center gap-1"><DirIcon className="h-3 w-3" />{kindLabel(k)}</span>
                            </td>
                            <td className="p-2">{renderVariantBadges(m.variant_id, (m as any)._inferred)}</td>
                            <td className="p-2">{whName(m.stock_pickings?.warehouse_id ?? null)}</td>
                            <td className="p-2 text-muted-foreground">{m.stock_pickings?.partners?.name ?? "—"}</td>
                            <td className={`p-2 text-right tabular-nums font-medium ${dirTone}`}>{dirSign}{fmtNumber(m.quantity)}</td>
                            <td className="p-2 text-right tabular-nums">{fmtNumber(m.quantity_done)}</td>
                            <td className="p-2 text-right tabular-nums text-amber-600">{m.reserved_quantity ? fmtNumber(m.reserved_quantity) : "—"}</td>
                            <td className="p-2"><Badge variant="outline" className="text-[10px]">{stateLabel(m.state)}</Badge></td>
                            <td className="p-2 text-muted-foreground">{m.stock_pickings?.origin ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, tone, bold, muted }: { label: string; value: number; tone?: "amber" | "emerald" | "destructive" | "primary"; bold?: boolean; muted?: boolean }) {
  const toneCls = tone === "amber" ? "text-amber-600"
    : tone === "emerald" ? "text-emerald-600"
    : tone === "destructive" ? "text-destructive"
    : tone === "primary" ? "text-primary"
    : muted ? "text-muted-foreground"
    : "";
  return (
    <div className="min-w-[68px]">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`tabular-nums ${bold ? "text-base font-bold" : "text-sm font-medium"} ${toneCls}`}>{fmtNumber(value)}</div>
    </div>
  );
}

function KpiMini({ label, value, tone, sign }: { label: string; value: number; tone?: "amber" | "emerald" | "destructive" | "primary" | "rose"; sign?: string }) {
  const toneCls = tone === "amber" ? "text-amber-600"
    : tone === "emerald" ? "text-emerald-600"
    : tone === "rose" ? "text-rose-600"
    : tone === "destructive" ? "text-destructive"
    : tone === "primary" ? "text-primary"
    : "";
  return (
    <div className="border rounded-md p-2 bg-background">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneCls}`}>{value > 0 && sign ? sign : ""}{fmtNumber(value)}</div>
    </div>
  );
}
