import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtNumber } from "@/lib/format";
import {
  Search, ChevronDown, ChevronRight, Package, Warehouse as WarehouseIcon,
  AlertTriangle, Boxes,
} from "lucide-react";

type QuantRow = {
  product_id: string;
  variant_id: string | null;
  location_id: string;
  quantity: number;
  reserved_quantity: number;
  stock_locations: { warehouse_id: string | null; name: string } | null;
  products: { id: string; name: string; internal_ref: string | null; image_url: string | null } | null;
  product_variants: { id: string; sku: string | null; barcode: string | null; image_url: string | null } | null;
};

type Warehouse = { id: string; name: string; code: string };

type VariantAgg = {
  variant_id: string | null;
  sku: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  per_warehouse: Map<string, { on_hand: number; reserved: number }>;
};

type ProductAgg = {
  product_id: string;
  name: string;
  internal_ref: string | null;
  image_url: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  variants: Map<string, VariantAgg>;
  per_warehouse: Map<string, { on_hand: number; reserved: number }>;
};

export default function InventoryStockPage() {
  const [search, setSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("all");
  const [stockMode, setStockMode] = useState<"all" | "in_stock" | "zero" | "negative">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: warehouses = [] } = useQuery({
    queryKey: ["stock-warehouses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("warehouses")
        .select("id, name, code")
        .eq("active", true)
        .order("name");
      return (data ?? []) as Warehouse[];
    },
  });

  const { data: quants = [], isLoading } = useQuery({
    queryKey: ["inventory-stock-quants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_quants")
        .select(
          "product_id, variant_id, location_id, quantity, reserved_quantity," +
            " stock_locations:location_id(warehouse_id, name)," +
            " products:product_id(id, name, internal_ref, image_url)," +
            " product_variants:variant_id(id, sku, barcode, image_url)"
        )
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as QuantRow[];
    },
  });

  const products = useMemo<ProductAgg[]>(() => {
    const map = new Map<string, ProductAgg>();
    for (const q of quants) {
      const p = q.products;
      if (!p) continue;
      const wid = q.stock_locations?.warehouse_id ?? "no-wh";
      if (warehouseFilter !== "all" && wid !== warehouseFilter) continue;

      let prod = map.get(p.id);
      if (!prod) {
        prod = {
          product_id: p.id,
          name: p.name,
          internal_ref: p.internal_ref,
          image_url: p.image_url,
          on_hand: 0,
          reserved: 0,
          available: 0,
          variants: new Map(),
          per_warehouse: new Map(),
        };
        map.set(p.id, prod);
      }
      const qty = Number(q.quantity) || 0;
      const res = Number(q.reserved_quantity) || 0;
      prod.on_hand += qty;
      prod.reserved += res;

      const w = prod.per_warehouse.get(wid) ?? { on_hand: 0, reserved: 0 };
      w.on_hand += qty;
      w.reserved += res;
      prod.per_warehouse.set(wid, w);

      const vKey = q.variant_id ?? "__base__";
      let v = prod.variants.get(vKey);
      if (!v) {
        v = {
          variant_id: q.variant_id,
          sku: q.product_variants?.sku ?? null,
          on_hand: 0,
          reserved: 0,
          available: 0,
          per_warehouse: new Map(),
        };
        prod.variants.set(vKey, v);
      }
      v.on_hand += qty;
      v.reserved += res;
      const vw = v.per_warehouse.get(wid) ?? { on_hand: 0, reserved: 0 };
      vw.on_hand += qty;
      vw.reserved += res;
      v.per_warehouse.set(wid, vw);
    }
    // compute available
    for (const p of map.values()) {
      p.available = p.on_hand - p.reserved;
      for (const v of p.variants.values()) v.available = v.on_hand - v.reserved;
    }
    let list = Array.from(map.values());
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.internal_ref?.toLowerCase().includes(q)) return true;
        for (const v of p.variants.values()) {
          if (v.sku?.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    if (stockMode === "in_stock") list = list.filter((p) => p.on_hand > 0);
    if (stockMode === "zero") list = list.filter((p) => p.on_hand === 0);
    if (stockMode === "negative") list = list.filter((p) => p.on_hand < 0);
    list.sort((a, b) => a.name.localeCompare(b.name, "pt"));
    return list;
  }, [quants, search, warehouseFilter, stockMode]);

  const totals = useMemo(() => {
    let on = 0, res = 0, prods = products.length, vars = 0;
    for (const p of products) {
      on += p.on_hand;
      res += p.reserved;
      vars += p.variants.size;
    }
    return { on, res, avail: on - res, prods, vars };
  }, [products]);

  const whName = (id: string) =>
    id === "no-wh" ? "Sem armazém" : warehouses.find((w) => w.id === id)?.name ?? id;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Stock"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Stock" }]}
      />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <SummaryCard icon={Package} label="Produtos" value={fmtNumber(totals.prods)} />
          <SummaryCard icon={Boxes} label="Variantes" value={fmtNumber(totals.vars)} />
          <SummaryCard icon={WarehouseIcon} label="Em mão" value={fmtNumber(totals.on)} />
          <SummaryCard
            icon={AlertTriangle}
            label="Disponível"
            value={fmtNumber(totals.avail)}
            tone={totals.avail < 0 ? "danger" : "default"}
          />
        </div>

        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, referência ou SKU…"
              className="pl-7 h-9"
            />
          </div>
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="h-9 w-48"><SelectValue placeholder="Armazém" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os armazéns</SelectItem>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stockMode} onValueChange={(v) => setStockMode(v as any)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="in_stock">Com stock</SelectItem>
              <SelectItem value="zero">Sem stock</SelectItem>
              <SelectItem value="negative">Negativo</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">A carregar stock…</div>
        ) : products.length === 0 ? (
          <EmptyState title="Sem stock para mostrar" description="Ajuste os filtros ou registe receções para ver dados aqui." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-left w-32">Referência</th>
                  <th className="px-3 py-2 text-right w-24">Em mão</th>
                  <th className="px-3 py-2 text-right w-24">Reservado</th>
                  <th className="px-3 py-2 text-right w-24">Disponível</th>
                  <th className="px-3 py-2 text-left w-40">Armazéns</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const isOpen = expanded.has(p.product_id);
                  const variantList = Array.from(p.variants.values());
                  const hasRealVariants = variantList.some((v) => v.variant_id);
                  return (
                    <>
                      <tr
                        key={p.product_id}
                        className="border-t hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggle(p.product_id)}
                      >
                        <td className="px-3 py-2 align-middle">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex items-center gap-2">
                            {p.image_url ? (
                              <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover border" />
                            ) : (
                              <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <Link
                                to={`/products/${p.product_id}`}
                                className="font-medium hover:underline truncate block"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {p.name}
                              </Link>
                              {hasRealVariants && (
                                <div className="text-xs text-muted-foreground">
                                  {variantList.length} variante{variantList.length > 1 ? "s" : ""}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
                          {p.internal_ref ?? "—"}
                        </td>
                        <td className="px-3 py-2 align-middle text-right tabular-nums">{fmtNumber(p.on_hand)}</td>
                        <td className="px-3 py-2 align-middle text-right tabular-nums text-muted-foreground">
                          {fmtNumber(p.reserved)}
                        </td>
                        <td className={"px-3 py-2 align-middle text-right tabular-nums font-medium " + (p.available < 0 ? "text-destructive" : "")}>
                          {fmtNumber(p.available)}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex flex-wrap gap-1">
                            {Array.from(p.per_warehouse.entries()).slice(0, 3).map(([wid, w]) => (
                              <Badge key={wid} variant="outline" className="text-[10px] font-normal">
                                {whName(wid)}: {fmtNumber(w.on_hand)}
                              </Badge>
                            ))}
                            {p.per_warehouse.size > 3 && (
                              <Badge variant="outline" className="text-[10px]">+{p.per_warehouse.size - 3}</Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={p.product_id + "-detail"} className="bg-muted/20">
                          <td></td>
                          <td colSpan={6} className="px-3 py-3">
                            <div className="space-y-3">
                              {hasRealVariants && (
                                <div>
                                  <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Variantes</div>
                                  <div className="border rounded bg-card">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-xs text-muted-foreground">
                                          <th className="px-3 py-1.5 text-left">Variante (SKU)</th>
                                          <th className="px-3 py-1.5 text-right w-24">Em mão</th>
                                          <th className="px-3 py-1.5 text-right w-24">Reservado</th>
                                          <th className="px-3 py-1.5 text-right w-24">Disponível</th>
                                          <th className="px-3 py-1.5 text-left w-56">Por armazém</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {variantList.map((v) => (
                                          <tr key={v.variant_id ?? "base"} className="border-t">
                                            <td className="px-3 py-1.5">
                                              {v.variant_id ? (
                                                <Link
                                                  to={`/products/${p.product_id}?variant=${v.variant_id}`}
                                                  className="hover:underline"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {v.sku ?? v.variant_id.slice(0, 8)}
                                                </Link>
                                              ) : (
                                                <span className="text-muted-foreground">Sem variante</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(v.on_hand)}</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                              {fmtNumber(v.reserved)}
                                            </td>
                                            <td className={"px-3 py-1.5 text-right tabular-nums font-medium " + (v.available < 0 ? "text-destructive" : "")}>
                                              {fmtNumber(v.available)}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              <div className="flex flex-wrap gap-1">
                                                {Array.from(v.per_warehouse.entries()).map(([wid, w]) => (
                                                  <Badge key={wid} variant="secondary" className="text-[10px] font-normal">
                                                    {whName(wid)}: {fmtNumber(w.on_hand)}
                                                  </Badge>
                                                ))}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                              <div>
                                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Distribuição por armazém</div>
                                <div className="flex flex-wrap gap-2">
                                  {Array.from(p.per_warehouse.entries()).map(([wid, w]) => (
                                    <div key={wid} className="border rounded px-3 py-1.5 text-xs bg-card">
                                      <div className="font-medium">{whName(wid)}</div>
                                      <div className="text-muted-foreground">
                                        Em mão {fmtNumber(w.on_hand)} · Reservado {fmtNumber(w.reserved)} · Disp. {fmtNumber(w.on_hand - w.reserved)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone = "default",
}: { icon: any; label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={"text-xl font-semibold tabular-nums " + (tone === "danger" ? "text-destructive" : "")}>{value}</div>
    </Card>
  );
}
