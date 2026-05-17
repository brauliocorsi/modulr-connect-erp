import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, X, Save } from "lucide-react";
import { toast } from "sonner";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

type Rule = {
  id: string;
  bom_id: string;
  product_id: string | null;
  variant_id: string | null;
  attribute_name: string | null;
  attribute_value: string | null;
  rule_type: string;
  source_component_id: string | null;
  target_component_id: string | null;
  qty: number | null;
  uom_id: string | null;
  formula: string | null;
  priority: number;
  active: boolean;
};

const ruleTypes = [
  "add_component",
  "replace_component",
  "remove_component",
  "change_qty",
  "change_formula",
  "change_operation",
];

export function VariantRulesSection({ bomId }: { bomId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);

  const { data: rules = [], refetch } = useQuery({
    queryKey: ["bom-variant-rules", bomId],
    queryFn: async () =>
      ((await supabase.from("bom_variant_rules").select("*").eq("bom_id", bomId).order("priority")).data ??
        []) as Rule[],
    enabled: !!bomId,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });

  const startNew = () =>
    setEditing({
      bom_id: bomId,
      rule_type: "replace_component",
      priority: (rules.length + 1) * 10,
      active: true,
    });
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    const e = editing;
    const hasCriterion =
      !!e.variant_id ||
      (!!e.attribute_name && !!e.attribute_value) ||
      !!e.source_component_id ||
      !!e.target_component_id;
    if (!hasCriterion) return toast.error("Defina ao menos um critério");
    if (e.priority == null) return toast.error("Prioridade obrigatória");

    const { error } = await supabase.rpc("bom_upsert_variant_rule", {
      p_id: e.id ?? null,
      p_bom_id: bomId,
      p_product_id: e.product_id ?? null,
      p_variant_id: e.variant_id ?? null,
      p_attribute_name: e.attribute_name ?? null,
      p_attribute_value: e.attribute_value ?? null,
      p_rule_type: e.rule_type ?? "replace_component",
      p_source_component_id: e.source_component_id ?? null,
      p_target_component_id: e.target_component_id ?? null,
      p_qty: e.qty ?? null,
      p_uom_id: e.uom_id ?? null,
      p_formula: e.formula ?? null,
      p_priority: e.priority,
      p_active: e.active ?? true,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Regra salva");
    setEditing(null);
    refetch();
    qc.invalidateQueries({ queryKey: ["bom-variant-rules", bomId] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.rpc("bom_delete_variant_rule", { p_id: id } as any);
    if (error) return toast.error(error.message);
    toast.success("Regra removida");
    refetch();
  };

  const toggleActive = async (r: Rule) => {
    const { error } = await supabase.rpc("bom_upsert_variant_rule", {
      p_id: r.id,
      p_bom_id: r.bom_id,
      p_product_id: r.product_id,
      p_variant_id: r.variant_id,
      p_attribute_name: r.attribute_name,
      p_attribute_value: r.attribute_value,
      p_rule_type: r.rule_type,
      p_source_component_id: r.source_component_id,
      p_target_component_id: r.target_component_id,
      p_qty: r.qty,
      p_uom_id: r.uom_id,
      p_formula: r.formula,
      p_priority: r.priority,
      p_active: !r.active,
    } as any);
    if (error) return toast.error(error.message);
    refetch();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          Regras por Variante
          <FieldInfoTooltip
            title="Regras por Variante"
            description="Permite alterar a BOM consoante atributos da variante (tecido, base, cor, etc.) sem duplicar listas de materiais."
            example="Se base = Elevatória, adicionar mecanismo elevatório."
          />
        </div>
        <Button size="sm" variant="outline" onClick={startNew}>
          <Plus className="h-4 w-4 mr-1" /> Nova regra
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-2 py-2 w-16">Pri</th>
              <th className="text-left px-2 py-2">Tipo</th>
              <th className="text-left px-2 py-2">Critério</th>
              <th className="text-left px-2 py-2">Origem → Alvo</th>
              <th className="text-left px-2 py-2 w-24">Qtd / Fórmula</th>
              <th className="text-center px-2 py-2 w-20">Estado</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-6">
                  Sem regras de variante
                </td>
              </tr>
            ) : (
              rules.map((r) => {
                const crit = [
                  r.variant_id && "variant",
                  r.attribute_name && r.attribute_value && `${r.attribute_name}=${r.attribute_value}`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const srcName = products.find((p: any) => p.id === r.source_component_id)?.name;
                const tgtName = products.find((p: any) => p.id === r.target_component_id)?.name;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1">{r.priority}</td>
                    <td className="px-2 py-1">
                      <Badge variant="outline">{r.rule_type}</Badge>
                    </td>
                    <td className="px-2 py-1 text-xs">{crit || "—"}</td>
                    <td className="px-2 py-1 text-xs">
                      {srcName ?? "—"} → {tgtName ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-xs">{r.qty ?? r.formula ?? "—"}</td>
                    <td className="px-2 py-1 text-center">
                      <Badge variant={r.active ? "default" : "secondary"} className="cursor-pointer" onClick={() => toggleActive(r)}>
                        {r.active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="text-right pr-2">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="border-t bg-muted/20 p-4 grid sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Prioridade *
              <FieldInfoTooltip
                title="Prioridade"
                description="Ordem de aplicação das regras. Números menores aplicam primeiro."
                example="10 aplica antes de 20."
              />
            </Label>
            <Input
              type="number"
              value={editing.priority ?? ""}
              onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Tipo *
              <FieldInfoTooltip
                title="Tipo de regra"
                description="Tipo de alteração que a regra faz na BOM (adicionar, substituir, remover, mudar quantidade, fórmula ou operação)."
              />
            </Label>
            <Select value={editing.rule_type} onValueChange={(v) => setEditing({ ...editing, rule_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ruleTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Checkbox
              id="r-active"
              checked={editing.active ?? true}
              onCheckedChange={(v) => setEditing({ ...editing, active: !!v })}
            />
            <Label htmlFor="r-active">Ativa</Label>
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Atributo (nome)
              <FieldInfoTooltip
                title="Nome do atributo"
                description="Define quando esta regra será aplicada, em conjunto com o valor."
                example="tecido, base, cor"
              />
            </Label>
            <Input
              value={editing.attribute_name ?? ""}
              onChange={(e) => setEditing({ ...editing, attribute_name: e.target.value })}
              placeholder="ex.: tecido"
            />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Atributo (valor)
              <FieldInfoTooltip
                title="Valor do atributo"
                description="Valor exato do atributo que dispara a regra."
                example="Veludo, Elevatória, Azul"
              />
            </Label>
            <Input
              value={editing.attribute_value ?? ""}
              onChange={(e) => setEditing({ ...editing, attribute_value: e.target.value })}
              placeholder="ex.: Veludo"
            />
          </div>
          <div className="space-y-1">
            <Label>Variant ID (opcional)</Label>
            <Input
              value={editing.variant_id ?? ""}
              onChange={(e) => setEditing({ ...editing, variant_id: e.target.value || null })}
            />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Componente origem
              <FieldInfoTooltip
                title="Componente origem"
                description="Componente original que será substituído ou removido pela regra."
              />
            </Label>
            <Select
              value={editing.source_component_id ?? "__none__"}
              onValueChange={(v) => setEditing({ ...editing, source_component_id: v === "__none__" ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              Componente alvo
              <FieldInfoTooltip
                title="Componente alvo"
                description="Novo componente que será usado quando a regra disparar."
              />
            <Select
              value={editing.target_component_id ?? "__none__"}
              onValueChange={(v) => setEditing({ ...editing, target_component_id: v === "__none__" ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input
              type="number"
              step="0.001"
              value={editing.qty ?? ""}
              onChange={(e) => setEditing({ ...editing, qty: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label>Fórmula</Label>
            <Textarea
              value={editing.formula ?? ""}
              onChange={(e) => setEditing({ ...editing, formula: e.target.value || null })}
              placeholder="ex.: base * 1.10"
            />
          </div>
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <Button variant="ghost" onClick={cancel}><X className="h-4 w-4 mr-1" />Cancelar</Button>
            <Button onClick={save}><Save className="h-4 w-4 mr-1" />Salvar regra</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
