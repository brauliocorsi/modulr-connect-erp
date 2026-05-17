import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, X, Save, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

type Output = {
  id: string;
  bom_id: string;
  bom_line_id: string | null;
  product_id: string;
  output_type: "main_product" | "co_product" | "byproduct" | "reusable_scrap" | "waste";
  qty: number;
  uom_id: string | null;
  formula: string | null;
  cost_allocation_percent: number | null;
  stockable: boolean;
  condition: string;
  operation_id: string | null;
  work_center_id: string | null;
  active: boolean;
};

const outputTypes: Output["output_type"][] = [
  "main_product",
  "co_product",
  "byproduct",
  "reusable_scrap",
  "waste",
];

const typeVariant = (t: Output["output_type"]) =>
  t === "main_product" ? "default"
  : t === "co_product" ? "secondary"
  : t === "byproduct" ? "outline"
  : t === "reusable_scrap" ? "outline"
  : "destructive";

export function OutputsSection({ bomId }: { bomId: string }) {
  const [editing, setEditing] = useState<Partial<Output> | null>(null);

  const { data: outputs = [], refetch } = useQuery({
    queryKey: ["bom-outputs", bomId],
    queryFn: async () =>
      ((await supabase.from("manufacturing_bom_outputs").select("*").eq("bom_id", bomId).order("output_type"))
        .data ?? []) as Output[],
    enabled: !!bomId,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });

  const totalAlloc = useMemo(
    () =>
      outputs
        .filter((o) => o.active && o.cost_allocation_percent != null)
        .reduce((s, o) => s + Number(o.cost_allocation_percent || 0), 0),
    [outputs],
  );

  const startNew = () =>
    setEditing({
      bom_id: bomId,
      output_type: "co_product",
      qty: 1,
      stockable: true,
      condition: "always",
      active: true,
    });
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    const e = editing;
    if (!e.product_id) return toast.error("Produto obrigatório");
    if (e.output_type === "waste" && e.stockable) return toast.error("waste não pode ser stockable");
    if ((e.cost_allocation_percent ?? 0) < 0) return toast.error("Cost allocation não pode ser negativo");

    const projected =
      totalAlloc -
      (outputs.find((o) => o.id === e.id)?.cost_allocation_percent ?? 0) +
      (e.cost_allocation_percent ?? 0);
    if (projected > 100.0001) return toast.error(`Soma de cost allocation excederia 100% (${projected.toFixed(2)})`);

    const { error } = await supabase.rpc("bom_upsert_output", {
      p_id: e.id ?? null,
      p_bom_id: bomId,
      p_bom_line_id: e.bom_line_id ?? null,
      p_product_id: e.product_id,
      p_output_type: e.output_type ?? "co_product",
      p_qty: e.qty ?? 0,
      p_uom_id: e.uom_id ?? null,
      p_formula: e.formula ?? null,
      p_cost_allocation_percent: e.cost_allocation_percent ?? null,
      p_stockable: e.stockable ?? false,
      p_condition: e.condition ?? "always",
      p_operation_id: e.operation_id ?? null,
      p_work_center_id: e.work_center_id ?? null,
      p_active: e.active ?? true,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Output salvo");
    setEditing(null);
    refetch();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.rpc("bom_delete_output", { p_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success("Output removido");
    refetch();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          Outputs da BOM
          <Badge variant={totalAlloc > 100.001 ? "destructive" : "outline"}>
            cost alloc: {totalAlloc.toFixed(2)}%
          </Badge>
          {totalAlloc > 100.001 && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Excede 100%
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={startNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo output
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-2 py-2">Tipo</th>
              <th className="text-left px-2 py-2">Produto</th>
              <th className="text-left px-2 py-2 w-20">Qtd</th>
              <th className="text-left px-2 py-2 w-24">Cost %</th>
              <th className="text-center px-2 py-2 w-20">Stockable</th>
              <th className="text-center px-2 py-2 w-20">Estado</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {outputs.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem outputs</td></tr>
            ) : (
              outputs.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-2 py-1">
                    <Badge variant={typeVariant(o.output_type)}>{o.output_type}</Badge>
                  </td>
                  <td className="px-2 py-1">{products.find((p: any) => p.id === o.product_id)?.name ?? o.product_id.slice(0, 8)}</td>
                  <td className="px-2 py-1">{o.qty}</td>
                  <td className="px-2 py-1">{o.cost_allocation_percent ?? "—"}</td>
                  <td className="px-2 py-1 text-center">{o.stockable ? "✓" : "—"}</td>
                  <td className="px-2 py-1 text-center">
                    <Badge variant={o.active ? "default" : "secondary"}>{o.active ? "active" : "inactive"}</Badge>
                  </td>
                  <td className="text-right pr-2">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(o)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(o.id)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="border-t bg-muted/20 p-4 grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Tipo *</Label>
            <Select
              value={editing.output_type}
              onValueChange={(v: any) =>
                setEditing({ ...editing, output_type: v, stockable: v === "waste" ? false : editing.stockable })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {outputTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Produto *</Label>
            <Select
              value={editing.product_id ?? ""}
              onValueChange={(v) => setEditing({ ...editing, product_id: v })}
            >
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantidade *</Label>
            <Input
              type="number"
              step="0.001"
              value={editing.qty ?? 0}
              onChange={(e) => setEditing({ ...editing, qty: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label>Cost allocation %</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={editing.cost_allocation_percent ?? ""}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  cost_allocation_percent: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Condição</Label>
            <Input
              value={editing.condition ?? "always"}
              onChange={(e) => setEditing({ ...editing, condition: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-4 mt-5">
            <div className="flex items-center gap-2">
              <Checkbox
                id="o-stockable"
                checked={editing.stockable ?? false}
                onCheckedChange={(v) => setEditing({ ...editing, stockable: !!v })}
                disabled={editing.output_type === "waste"}
              />
              <Label htmlFor="o-stockable">Stockable</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="o-active"
                checked={editing.active ?? true}
                onCheckedChange={(v) => setEditing({ ...editing, active: !!v })}
              />
              <Label htmlFor="o-active">Ativa</Label>
            </div>
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label>Fórmula (opcional)</Label>
            <Textarea
              value={editing.formula ?? ""}
              onChange={(e) => setEditing({ ...editing, formula: e.target.value || null })}
              placeholder="ex.: base * 0.05"
            />
          </div>
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <Button variant="ghost" onClick={cancel}><X className="h-4 w-4 mr-1" />Cancelar</Button>
            <Button onClick={save}><Save className="h-4 w-4 mr-1" />Salvar output</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
