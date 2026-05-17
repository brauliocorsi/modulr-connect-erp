import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Eye, Play, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

type Props = {
  bomId: string;
  productId: string;
  defaultVariantId?: string | null;
  defaultQty?: number;
  onChanged?: () => void;
};

const CONTEXT_FIELDS: { key: string; label: string }[] = [
  { key: "width_cm", label: "width_cm" },
  { key: "length_cm", label: "length_cm" },
  { key: "height_cm", label: "height_cm" },
  { key: "mattress_width", label: "mattress_width" },
  { key: "mattress_length", label: "mattress_length" },
  { key: "fabric_width", label: "fabric_width" },
  { key: "qty_ordered", label: "qty_ordered" },
];

export function BomResolvedPreview({ bomId, productId, defaultVariantId, defaultQty = 1, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(defaultVariantId ?? null);
  const [qty, setQty] = useState<number>(defaultQty);
  const [ctx, setCtx] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const { data: variants = [] } = useQuery({
    queryKey: ["product-variants", productId],
    enabled: !!productId && open,
    queryFn: async () =>
      (await supabase.from("product_variants").select("id,sku").eq("product_id", productId).order("sku")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    enabled: open,
    queryFn: async () => (await supabase.from("products").select("id,name")).data ?? [],
  });
  const { data: allVariants = [] } = useQuery({
    queryKey: ["product-variants-min"],
    enabled: open,
    queryFn: async () => (await supabase.from("product_variants").select("id,sku")).data ?? [],
  });
  const variantSku = (id: string | null) =>
    id ? ((allVariants as any[]).find((v) => v.id === id)?.sku ?? id.slice(0, 8)) : null;

  const run = async () => {
    setLoading(true);
    try {
      const numericCtx: Record<string, number> = {};
      for (const [k, v] of Object.entries(ctx)) {
        if (v !== "" && v != null && !Number.isNaN(Number(v))) numericCtx[k] = Number(v);
      }
      const { data, error } = await supabase.rpc("bom_preview_resolved", {
        _bom_id: bomId,
        _product_id: productId,
        _variant_id: variantId,
        _qty: qty,
        _context: numericCtx,
      } as any);
      if (error) throw error;
      setResult(data);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro no preview");
    } finally {
      setLoading(false);
    }
  };

  const productName = (id?: string | null) =>
    id ? products.find((p: any) => p.id === id)?.name ?? id.slice(0, 8) : "—";

  const override = async (line: any) => {
    setActing(true);
    try {
      const { error } = await supabase.rpc("bom_upsert_line", {
        p_id: null,
        p_bom_id: bomId,
        p_component_product_id: line.component_product_id,
        p_component_variant_id: line.component_variant_id ?? null,
        p_quantity: Number(line.qty_required ?? 0),
        p_uom_id: line.uom_id ?? null,
        p_sequence: 100,
        p_parent_bom_line_id: line.source_line_id,
        p_inheritance_action: "override",
        p_is_optional: !!line.is_optional,
        p_is_critical: true,
        p_formula: null,
        p_qty_formula: line.formula_used ?? null,
        p_formula_variables: null,
        p_consumption_uom_id: null,
        p_conversion_factor: null,
        p_rounding_method: line.rounding_method ?? "exact",
        p_operation_id: null,
        p_work_center_id: null,
        p_applies_to_variant_rule: null,
        p_component_selector: null,
      } as any);
      if (error) throw error;
      toast.success("Override criado");
      onChanged?.();
      await run();
    } catch (err: any) {
      toast.error(err?.message ?? "Erro no override");
    } finally {
      setActing(false);
    }
  };

  const remove = async (line: any) => {
    setActing(true);
    try {
      const { error } = await supabase.rpc("bom_upsert_line", {
        p_id: null,
        p_bom_id: bomId,
        p_component_product_id: null, // RPC copies from parent
        p_component_variant_id: null,
        p_quantity: 0,
        p_uom_id: null,
        p_sequence: 100,
        p_parent_bom_line_id: line.source_line_id,
        p_inheritance_action: "remove",
        p_is_optional: false,
        p_is_critical: false,
        p_formula: null,
        p_qty_formula: null,
        p_formula_variables: null,
        p_consumption_uom_id: null,
        p_conversion_factor: null,
        p_rounding_method: "exact",
        p_operation_id: null,
        p_work_center_id: null,
        p_applies_to_variant_rule: null,
        p_component_selector: null,
      } as any);
      if (error) throw error;
      toast.success("Remove aplicado");
      onChanged?.();
      await run();
    } catch (err: any) {
      toast.error(err?.message ?? "Erro no remove");
    } finally {
      setActing(false);
    }
  };

  const lines: any[] = result?.lines ?? [];
  const outputs: any[] = result?.outputs ?? [];
  const blockers: any[] = result?.blockers ?? [];
  const warnings: any[] = result?.warnings ?? [];
  const totalAlloc = outputs.reduce(
    (s, o) => s + Number(o.cost_allocation_percent ?? 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Eye className="h-4 w-4 mr-1" /> Preview BOM Resolvida
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Preview da BOM Resolvida
            <FieldInfoTooltip
              title="Preview da BOM"
              description="Resolve a BOM em runtime via resolve_bom_for_variant. Read-only: não cria MO, purchase_need, stock nem reservas."
            />
          </DialogTitle>
        </DialogHeader>

        <div className="grid sm:grid-cols-4 gap-3 mb-4">
          <div className="space-y-1">
            <Label>Variante</Label>
            <Select
              value={variantId ?? "__none__"}
              onValueChange={(v) => setVariantId(v === "__none__" ? null : v)}
            >
              <SelectTrigger><SelectValue placeholder="(nenhuma)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(nenhuma)</SelectItem>
                {variants.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.sku || v.id.slice(0, 8)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input type="number" step="0.01" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          {CONTEXT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">{f.label}</Label>
              <Input
                type="number"
                step="0.01"
                value={ctx[f.key] ?? ""}
                onChange={(e) => setCtx({ ...ctx, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-4">
          <Button onClick={run} disabled={loading}>
            <Play className="h-4 w-4 mr-1" /> {loading ? "Calculando…" : "Calcular Preview"}
          </Button>
        </div>

        {result && (
          <div className="space-y-4">
            {blockers.length > 0 && (
              <div className="rounded border border-destructive/50 bg-destructive/5 p-3">
                <div className="font-semibold text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> Blockers
                </div>
                <ul className="text-sm mt-2 space-y-1">
                  {blockers.map((b, i) => (
                    <li key={i} className="font-mono text-xs">
                      <Badge variant="destructive" className="mr-2">{b.code}</Badge>
                      {JSON.stringify(b)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded border border-amber-500/50 bg-amber-500/5 p-3">
                <div className="font-semibold text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> Warnings
                </div>
                <ul className="text-sm mt-2 space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i} className="font-mono text-xs">
                      <Badge variant="outline" className="mr-2">{w.code}</Badge>
                      {JSON.stringify(w)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border rounded">
              <div className="px-3 py-2 border-b bg-muted/40 font-semibold">
                Componentes Resolvidos ({lines.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs">
                    <tr>
                      <th className="text-left px-2 py-1">Componente</th>
                      <th className="text-left px-2 py-1">Qty</th>
                      <th className="text-left px-2 py-1">Fórmula</th>
                      <th className="text-left px-2 py-1">Source</th>
                      <th className="text-center px-2 py-1">Opt</th>
                      <th className="w-44" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-4">Sem componentes</td></tr>
                    ) : lines.map((l, i) => {
                      const isInherited =
                        l.inheritance_action === "own" /* if no override in child */ ? false : false;
                      const action = l.inheritance_action ?? "own";
                      const sourceBadge =
                        action === "remove" ? "remove"
                        : action === "override" ? "override"
                        : action === "add" ? "add"
                        : action === "own" ? "own"
                        : "inherited";
                      return (
                        <tr key={i} className="border-t align-top">
                          <td className="px-2 py-1">{productName(l.component_product_id)}</td>
                          <td className="px-2 py-1 font-mono">{l.qty_required}</td>
                          <td className="px-2 py-1 font-mono text-xs">{l.formula_used ?? "—"}</td>
                          <td className="px-2 py-1">
                            <Badge variant={action === "remove" ? "destructive" : "outline"}>{sourceBadge}</Badge>
                          </td>
                          <td className="px-2 py-1 text-center">{l.is_optional ? "✓" : "—"}</td>
                          <td className="px-2 py-1 text-right">
                            {l.source_line_id && action !== "own" && (
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="ghost" disabled={acting} onClick={() => override(l)}>
                                  <Pencil className="h-3 w-3 mr-1" />Override
                                </Button>
                                <Button size="sm" variant="ghost" disabled={acting} onClick={() => remove(l)}>
                                  <X className="h-3 w-3 mr-1" />Remove
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border rounded">
              <div className="px-3 py-2 border-b bg-muted/40 font-semibold flex items-center gap-2">
                Outputs Resolvidos ({outputs.length})
                <Badge variant={totalAlloc > 100.001 ? "destructive" : "outline"}>
                  cost alloc: {totalAlloc.toFixed(2)}%
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs">
                    <tr>
                      <th className="text-left px-2 py-1">Tipo</th>
                      <th className="text-left px-2 py-1">Produto</th>
                      <th className="text-left px-2 py-1">Qty</th>
                      <th className="text-left px-2 py-1">Cost %</th>
                      <th className="text-center px-2 py-1">Stockable</th>
                      <th className="text-left px-2 py-1">Condition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputs.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-4">Sem outputs</td></tr>
                    ) : outputs.map((o, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1"><Badge variant="outline">{o.output_type}</Badge></td>
                        <td className="px-2 py-1">{productName(o.product_id)}</td>
                        <td className="px-2 py-1 font-mono">{o.qty_expected}</td>
                        <td className="px-2 py-1 font-mono">{o.cost_allocation_percent ?? "—"}</td>
                        <td className="px-2 py-1 text-center">{o.stockable ? "✓" : "—"}</td>
                        <td className="px-2 py-1 font-mono text-xs">{o.condition ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              bom_id: <code>{result.bom_id ?? "—"}</code> · parent_chain:{" "}
              <code>{JSON.stringify(result.parent_chain ?? [])}</code>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
