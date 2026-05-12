import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import PutawayDialog from "@/modules/inventory/PutawayDialog";

type Quant = {
  variant_id: string | null;
  quantity: number;
  reserved_quantity: number;
  stock_locations: { warehouse_id: string; name: string } | null;
};
type Variant = {
  id: string;
  sku: string | null;
  image_url: string | null;
  active: boolean;
  product_variant_values: { value_id: string; product_attribute_values: { name: string } | null }[];
};

export function StockTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [quants, setQuants] = useState<Quant[]>([]);
  const [whId, setWhId] = useState<string>("");
  const [qty, setQty] = useState<string>("0");
  const [reason, setReason] = useState<string>("");

  // filters for variant matrix
  const [search, setSearch] = useState("");
  const [filterWh, setFilterWh] = useState<string>("all");
  const [filterAttrVal, setFilterAttrVal] = useState<string>("all");
  const [hideZero, setHideZero] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("product_stock_forecast")
      .select("*, warehouses(name,code)")
      .eq("product_id", productId);
    setRows(data ?? []);

    const { data: vs } = await supabase
      .from("product_variants")
      .select("id, sku, image_url, active, product_variant_values(value_id, product_attribute_values(name))")
      .eq("product_id", productId);
    setVariants((vs as any) ?? []);

    const { data: qs } = await supabase
      .from("stock_quants")
      .select("variant_id, quantity, reserved_quantity, stock_locations(warehouse_id, name)")
      .eq("product_id", productId);
    setQuants((qs as any) ?? []);
  };

  useEffect(() => {
    load();
    supabase.from("warehouses").select("id,name,code").eq("active", true).order("name").then(({ data }) => {
      setWarehouses(data ?? []);
      if (data?.[0]) setWhId(data[0].id);
    });
  }, [productId]);

  const setStock = async () => {
    if (!whId) return toast.error("Selecione um armazém");
    const { error } = await supabase.rpc("set_product_stock", {
      _product: productId, _warehouse: whId, _qty: Number(qty), _reason: reason || "Ajuste manual",
    });
    if (error) return toast.error(error.message);
    toast.success("Stock atualizado");
    setReason(""); await load();
  };

  const tot = rows.reduce((acc, r) => ({
    on_hand: acc.on_hand + Number(r.on_hand || 0),
    available: acc.available + Number(r.available || 0),
    forecasted: acc.forecasted + Number(r.forecasted || 0),
    sold_30d: acc.sold_30d + Number(r.sold_30d || 0),
  }), { on_hand: 0, available: 0, forecasted: 0, sold_30d: 0 });

  // Build variant × warehouse matrix
  const matrix = useMemo(() => {
    // map[variant_id || "_no_variant"][warehouse_id] = {qty, reserved}
    const m: Record<string, Record<string, { qty: number; reserved: number }>> = {};
    for (const q of quants) {
      const vid = q.variant_id || "_no_variant";
      const wid = q.stock_locations?.warehouse_id || "_unknown";
      m[vid] ??= {};
      m[vid][wid] ??= { qty: 0, reserved: 0 };
      m[vid][wid].qty += Number(q.quantity || 0);
      m[vid][wid].reserved += Number(q.reserved_quantity || 0);
    }
    return m;
  }, [quants]);

  // Distinct attribute values for filter
  const attrValues = useMemo(() => {
    const s = new Map<string, string>();
    variants.forEach((v) =>
      v.product_variant_values.forEach((pvv) => {
        if (pvv.value_id && pvv.product_attribute_values?.name) s.set(pvv.value_id, pvv.product_attribute_values.name);
      }),
    );
    return Array.from(s.entries()).map(([id, name]) => ({ id, name }));
  }, [variants]);

  const variantTotal = (vid: string) => {
    const w = matrix[vid] || {};
    return Object.values(w).reduce((a, x) => ({ qty: a.qty + x.qty, reserved: a.reserved + x.reserved }), { qty: 0, reserved: 0 });
  };

  const filteredVariants = useMemo(() => {
    return variants.filter((v) => {
      if (filterAttrVal !== "all" && !v.product_variant_values.some((p) => p.value_id === filterAttrVal)) return false;
      if (search) {
        const label = ((v.sku || "") + " " + v.product_variant_values.map((p) => p.product_attribute_values?.name).join(" ")).toLowerCase();
        if (!label.includes(search.toLowerCase())) return false;
      }
      if (hideZero) {
        const t = variantTotal(v.id);
        if (t.qty === 0 && t.reserved === 0) return false;
      }
      if (filterWh !== "all") {
        const w = matrix[v.id]?.[filterWh];
        if (!w || (w.qty === 0 && w.reserved === 0 && hideZero)) return false;
      }
      return true;
    }).sort((a, b) => {
      const la = a.product_variant_values.map((x) => x.product_attribute_values?.name || "").join("/");
      const lb = b.product_variant_values.map((x) => x.product_attribute_values?.name || "").join("/");
      return la.localeCompare(lb);
    });
  }, [variants, matrix, search, filterAttrVal, filterWh, hideZero]);

  const visibleWarehouses = useMemo(() => {
    if (filterWh !== "all") return warehouses.filter((w) => w.id === filterWh);
    // only warehouses with any stock for this product
    const present = new Set<string>();
    quants.forEach((q) => q.stock_locations?.warehouse_id && present.add(q.stock_locations.warehouse_id));
    return warehouses.filter((w) => present.has(w.id));
  }, [warehouses, quants, filterWh]);

  const noVariantQty = matrix["_no_variant"];
  const hasVariants = variants.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Em mão</div><div className="text-2xl font-semibold">{fmtNumber(tot.on_hand)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Disponível</div><div className="text-2xl font-semibold">{fmtNumber(tot.available)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Previsto</div><div className="text-2xl font-semibold text-primary">{fmtNumber(tot.forecasted)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Vendido 30d</div><div className="text-2xl font-semibold">{fmtNumber(tot.sold_30d)}</div></Card>
      </div>

      {/* Set stock */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">Definir stock</div>
          <PutawayDialog productId={productId} onDone={load} />
        </div>
        <div className="grid sm:grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Armazém</div>
            <Select value={whId} onValueChange={setWhId}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Quantidade</div>
            <Input className="h-9" type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Motivo (opcional)</div>
            <Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário inicial, recebimento manual…" />
          </div>
          <Button onClick={setStock}>Aplicar</Button>
        </div>
      </Card>

      {/* Per-warehouse summary */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold"><WarehouseIcon className="h-4 w-4" />Por armazém</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2">Armazém</th>
                <th className="text-right p-2">Em mão</th>
                <th className="text-right p-2">Reservado</th>
                <th className="text-right p-2">Disponível</th>
                <th className="text-right p-2">A receber</th>
                <th className="text-right p-2">A entregar</th>
                <th className="text-right p-2">Previsto</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem dados</td></tr>
                : rows.map((r) => (
                  <tr key={r.warehouse_id} className="border-t">
                    <td className="p-2">{r.warehouses?.name || r.warehouse_id?.slice(0, 8)}</td>
                    <td className="p-2 text-right">{fmtNumber(r.on_hand)}</td>
                    <td className="p-2 text-right">{fmtNumber(r.reserved)}</td>
                    <td className="p-2 text-right font-medium">{fmtNumber(r.available)}</td>
                    <td className="p-2 text-right text-emerald-600">+{fmtNumber(r.incoming)}</td>
                    <td className="p-2 text-right text-rose-600">−{fmtNumber(r.outgoing)}</td>
                    <td className="p-2 text-right font-semibold">{fmtNumber(r.forecasted)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Variants × Warehouses matrix */}
      {hasVariants && (
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4" />Por variante</div>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input className="h-9 pl-8 w-48" placeholder="Buscar SKU / atributo…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={filterAttrVal} onValueChange={setFilterAttrVal}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Atributo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos atributos</SelectItem>
                  {attrValues.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterWh} onValueChange={setFilterWh}>
                <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Armazém" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos armazéns</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={hideZero} onCheckedChange={setHideZero} />
                Ocultar zerados
              </label>
            </div>
          </div>

          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left p-2 w-14">Foto</th>
                  <th className="text-left p-2">Variante</th>
                  <th className="text-left p-2 w-32">SKU</th>
                  {visibleWarehouses.map((w) => (
                    <th key={w.id} className="text-right p-2 w-28" title={w.code}>{w.name}</th>
                  ))}
                  <th className="text-right p-2 w-24 bg-muted/60">Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredVariants.length === 0 ? (
                  <tr><td colSpan={3 + visibleWarehouses.length + 1} className="text-center text-muted-foreground py-6">Sem variantes com stock</td></tr>
                ) : filteredVariants.map((v) => {
                  const total = variantTotal(v.id);
                  return (
                    <tr key={v.id} className={`border-t ${!v.active ? "opacity-50" : ""}`}>
                      <td className="p-1">
                        <div className="w-10 h-10 border rounded bg-muted/30 overflow-hidden">
                          {v.image_url ? <img src={v.image_url} alt="" className="w-full h-full object-cover" /> : null}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {v.product_variant_values.map((pvv, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{pvv.product_attribute_values?.name}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{v.sku || "—"}</td>
                      {visibleWarehouses.map((w) => {
                        const cell = matrix[v.id]?.[w.id];
                        const q = cell?.qty || 0;
                        const r = cell?.reserved || 0;
                        const avail = q - r;
                        return (
                          <td key={w.id} className="p-2 text-right">
                            {q === 0 && r === 0 ? <span className="text-muted-foreground/40">—</span> : (
                              <div>
                                <div className={`font-medium ${avail <= 0 ? "text-destructive" : ""}`}>{fmtNumber(avail)}</div>
                                {r > 0 && <div className="text-[10px] text-muted-foreground">{fmtNumber(q)} − {fmtNumber(r)} res.</div>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2 text-right bg-muted/30 font-semibold">
                        {fmtNumber(total.qty - total.reserved)}
                        {total.reserved > 0 && <div className="text-[10px] text-muted-foreground font-normal">de {fmtNumber(total.qty)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {noVariantQty && (
                <tfoot>
                  <tr className="border-t bg-amber-50 dark:bg-amber-950/20">
                    <td colSpan={3} className="p-2 italic text-xs text-muted-foreground">Stock sem variante atribuída</td>
                    {visibleWarehouses.map((w) => {
                      const cell = noVariantQty[w.id];
                      return <td key={w.id} className="p-2 text-right text-xs">{cell ? fmtNumber(cell.qty - cell.reserved) : "—"}</td>;
                    })}
                    <td className="p-2 text-right bg-muted/30 font-semibold text-xs">
                      {fmtNumber(Object.values(noVariantQty).reduce((a, x) => a + x.qty - x.reserved, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
