import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Save, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { VariantRulesSection } from "./bom/VariantRulesSection";
import { OutputsSection } from "./bom/OutputsSection";
import { BomResolvedPreview } from "./bom/BomResolvedPreview";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

type BomRow = {
  id?: string;
  product_id: string | null;
  variant_id: string | null;
  code: string;
  type: "normal" | "phantom" | "subcontract";
  quantity: number;
  uom_id: string | null;
  active: boolean;
  parent_bom_id: string | null;
  inheritance_mode: "inherit" | "override" | "extend";
  is_master: boolean;
  applies_to_product_id: string | null;
  applies_to_variant_id: string | null;
  variant_rule: any;
};

type LineRow = {
  id: string;
  bom_id?: string;
  component_product_id: string | null;
  component_variant_id: string | null;
  quantity: number;
  uom_id: string | null;
  sequence: number;
  parent_bom_line_id: string | null;
  inheritance_action: "own" | "add" | "override" | "remove";
  is_inherited: boolean;
  is_optional: boolean;
  is_critical: boolean | null;
  formula: string | null;
  qty_formula: string | null;
  formula_variables: any;
  consumption_uom_id: string | null;
  conversion_factor: number | null;
  rounding_method: "exact" | "round_up" | "round_down" | "package_multiple";
  operation_id: string | null;
  work_center_id: string | null;
  applies_to_variant_rule: any;
  component_selector: any;
  _dirty?: boolean;
  _new?: boolean;
};

const emptyBom = (productId: string | null): BomRow => ({
  product_id: productId,
  variant_id: null,
  code: "",
  type: "normal",
  quantity: 1,
  uom_id: null,
  active: true,
  parent_bom_id: null,
  inheritance_mode: "inherit",
  is_master: false,
  applies_to_product_id: null,
  applies_to_variant_id: null,
  variant_rule: null,
});

const emptyLine = (seq: number): LineRow => ({
  id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  component_product_id: null,
  component_variant_id: null,
  quantity: 1,
  uom_id: null,
  sequence: seq,
  parent_bom_line_id: null,
  inheritance_action: "own",
  is_inherited: false,
  is_optional: false,
  is_critical: true,
  formula: null,
  qty_formula: null,
  formula_variables: null,
  consumption_uom_id: null,
  conversion_factor: null,
  rounding_method: "exact",
  operation_id: null,
  work_center_id: null,
  applies_to_variant_rule: null,
  component_selector: null,
  _new: true,
});

export default function BomForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const productFromQuery = sp.get("product");

  const [bom, setBom] = useState<BomRow>(emptyBom(productFromQuery));
  const [lines, setLines] = useState<LineRow[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });
  const { data: allVariants } = useQuery({
    queryKey: ["product-variants-all"],
    queryFn: async () =>
      (await supabase.from("product_variants").select("id,product_id,sku").eq("active", true)).data ?? [],
  });
  const variantsByProduct = (allVariants ?? []).reduce<Record<string, any[]>>((acc, v: any) => {
    (acc[v.product_id] ||= []).push(v);
    return acc;
  }, {});
  const { data: parentBoms } = useQuery({
    queryKey: ["boms-masters"],
    queryFn: async () => (await supabase.from("boms").select("id,code,product_id").order("code")).data ?? [],
  });
  const { data: bomOps } = useQuery({
    queryKey: ["bom-operations", id],
    enabled: !isNew && !!id,
    queryFn: async () => (await supabase.from("bom_operations").select("id,name").eq("bom_id", id!).order("sequence")).data ?? [],
  });
  const { data: workCenters } = useQuery({
    queryKey: ["work-centers"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name").eq("active", true).order("name")).data ?? [],
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: b } = await supabase.from("boms").select("*").eq("id", id!).maybeSingle();
      if (b) setBom(b as any);
      const { data: ls } = await supabase.from("bom_lines").select("*").eq("bom_id", id!).order("sequence");
      setLines((ls ?? []) as any);
    })();
  }, [id, isNew]);

  const save = async () => {
    if (!bom.product_id) return toast.error("Selecione o produto");
    setSaving(true);
    try {
      const { data: bid, error: e1 } = await supabase.rpc("bom_upsert_master", {
        p_id: isNew ? null : (id as string),
        p_product_id: bom.product_id,
        p_variant_id: bom.variant_id,
        p_code: bom.code || null,
        p_type: bom.type,
        p_quantity: Number(bom.quantity || 1),
        p_uom_id: bom.uom_id,
        p_active: bom.active,
        p_parent_bom_id: bom.parent_bom_id,
        p_inheritance_mode: bom.inheritance_mode,
        p_is_master: bom.is_master,
        p_applies_to_product_id: bom.applies_to_product_id,
        p_applies_to_variant_id: bom.applies_to_variant_id,
        p_variant_rule: bom.variant_rule,
      } as any);
      if (e1) throw e1;
      const newBid = bid as unknown as string;

      for (const rid of removedIds) {
        const { error } = await supabase.rpc("bom_delete_line", { p_id: rid } as any);
        if (error) throw error;
      }

      for (const l of lines) {
        if (l.is_inherited) continue; // inherited never written from UI in BC.1
        if (l.inheritance_action !== "remove" && !l.component_product_id) continue;
        if (!l._new && !l._dirty) continue;
        const { error } = await supabase.rpc("bom_upsert_line", {
          p_id: l._new ? null : l.id,
          p_bom_id: newBid,
          p_component_product_id: l.component_product_id,
          p_component_variant_id: l.component_variant_id,
          p_quantity: Number(l.quantity || 0),
          p_uom_id: l.uom_id,
          p_sequence: l.sequence ?? 10,
          p_parent_bom_line_id: l.parent_bom_line_id,
          p_inheritance_action: l.inheritance_action,
          p_is_optional: l.is_optional,
          p_is_critical: l.is_critical,
          p_formula: l.formula,
          p_qty_formula: l.qty_formula,
          p_formula_variables: l.formula_variables,
          p_consumption_uom_id: l.consumption_uom_id,
          p_conversion_factor: l.conversion_factor,
          p_rounding_method: l.rounding_method,
          p_operation_id: l.operation_id,
          p_work_center_id: l.work_center_id,
          p_applies_to_variant_rule: l.applies_to_variant_rule,
          p_component_selector: l.component_selector,
        } as any);
        if (error) throw error;
      }
      toast.success("BOM salva");
      setRemovedIds([]);
      if (isNew) nav(`/products/bom/${newBid}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const addLine = () => setLines((p) => [...p, emptyLine((p.length + 1) * 10)]);
  const removeLine = (idx: number) => {
    const l = lines[idx];
    if (l.is_inherited) return toast.error("Linha herdada (read-only em BC.1)");
    if (!l._new) setRemovedIds((p) => [...p, l.id]);
    setLines((p) => p.filter((_, i) => i !== idx));
  };
  const setLine = (idx: number, patch: Partial<LineRow>) =>
    setLines((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], ...patch, _dirty: true };
      return n;
    });

  const inheritedLines = lines.filter((l) => l.is_inherited);
  const ownLines = lines.filter((l) => !l.is_inherited);

  return (
    <>
      <FormHeader
        title={isNew ? "Nova BOM" : bom.code || "BOM"}
        breadcrumb={[
          { label: "Produtos", to: "/products" },
          { label: "BOM", to: "/products/bom" },
          { label: bom.code || "Nova" },
        ]}
        backTo="/products/bom"
        actions={
          <div className="flex gap-2">
            {!isNew && id && bom.product_id && (
              <BomResolvedPreview
                bomId={id}
                productId={bom.product_id}
                defaultVariantId={bom.variant_id}
                defaultQty={Number(bom.quantity || 1)}
                onChanged={async () => {
                  const { data: ls } = await supabase.from("bom_lines").select("*").eq("bom_id", id).order("sequence");
                  setLines((ls ?? []) as any);
                }}
              />
            )}
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="space-y-4 max-w-5xl">
          <Card className="p-6 grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Código</Label>
              <Input value={bom.code ?? ""} onChange={(e) => setBom({ ...bom, code: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Produto *</Label>
              <Select value={bom.product_id ?? ""} onValueChange={(v) => setBom({ ...bom, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {products?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={bom.type} onValueChange={(v: any) => setBom({ ...bom, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="phantom">Fantasma</SelectItem>
                  <SelectItem value="subcontract">Subcontratação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantidade produzida</Label>
              <Input
                type="number" step="0.01" value={bom.quantity}
                onChange={(e) => setBom({ ...bom, quantity: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                Modo de herança
                <FieldInfoTooltip
                  title="Modo de herança"
                  description="Define como esta BOM se relaciona com a BOM pai.\n• Herda: usa as linhas da BOM pai e permite override/remove.\n• Sobrescreve: ignora as linhas do pai e usa apenas as próprias.\n• Estende: junta as próprias linhas às do pai."
                />
              </Label>
              <Select value={bom.inheritance_mode} onValueChange={(v: any) => setBom({ ...bom, inheritance_mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Herda do pai</SelectItem>
                  <SelectItem value="override">Sobrescreve</SelectItem>
                  <SelectItem value="extend">Estende</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                BOM pai
                <FieldInfoTooltip
                  title="BOM pai"
                  description="Permite herdar componentes de outra BOM, evitando duplicar listas de materiais."
                  example="Sofá 3 lugares herda da BOM Master de Sofá."
                />
              </Label>
              <Select
                value={bom.parent_bom_id ?? "__none__"}
                onValueChange={(v) => setBom({ ...bom, parent_bom_id: v === "__none__" ? null : v })}
              >
                <SelectTrigger><SelectValue placeholder="(nenhuma)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(nenhuma)</SelectItem>
                  {parentBoms?.filter((b: any) => b.id !== id).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.code || b.id.slice(0, 8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 mt-6">
              <Checkbox
                id="is_master"
                checked={bom.is_master}
                onCheckedChange={(v) => setBom({ ...bom, is_master: !!v })}
              />
              <Label htmlFor="is_master" className="cursor-pointer">BOM Master</Label>
              <FieldInfoTooltip
                title="BOM Master"
                description="BOM principal usada como base para outras BOMs filhas. Útil para variantes que compartilham a maioria dos componentes."
              />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <Checkbox
                id="active"
                checked={bom.active}
                onCheckedChange={(v) => setBom({ ...bom, active: !!v })}
              />
              <Label htmlFor="active" className="cursor-pointer">Ativa</Label>
            </div>
          </Card>

          {bom.parent_bom_id && bom.inheritance_mode === "inherit" && (
            <Card>
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="font-semibold flex items-center gap-2">
                  Linhas herdadas (preview) <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-xs text-muted-foreground">
                  Resolvidas em runtime. Override/Remove inline disponíveis em BC.3.
                </span>
              </div>
              <div className="p-4 text-sm text-muted-foreground">
                {inheritedLines.length === 0
                  ? "Nenhuma linha herdada materializada (resolução faz-se via resolve_bom_for_variant)."
                  : `${inheritedLines.length} linhas herdadas — read-only.`}
              </div>
            </Card>
          )}

          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">Componentes</div>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-2 py-2">Componente</th>
                    <th className="text-left px-2 py-2 w-28">Qtd</th>
                    <th className="text-left px-2 py-2 w-32">
                      <span className="inline-flex items-center gap-1">
                        Operação
                        <FieldInfoTooltip title="Operação" description="Operação onde este componente será consumido." example="Corte, Estofamento ou Montagem." />
                      </span>
                    </th>
                    <th className="text-left px-2 py-2 w-32">
                      <span className="inline-flex items-center gap-1">
                        Centro
                        <FieldInfoTooltip title="Centro de trabalho" description="Centro responsável por esta etapa." example="Corte, Costura ou Embalagem." />
                      </span>
                    </th>
                    <th className="text-left px-2 py-2 w-32">
                      <span className="inline-flex items-center gap-1">
                        Fórmula qty
                        <FieldInfoTooltip
                          title="Fórmula de quantidade"
                          description="Fórmula para calcular a quantidade necessária automaticamente. Variáveis disponíveis: base, largura, comprimento, medida_colchao, qty_encomendada."
                          example="largura * comprimento * 1.05"
                        />
                      </span>
                    </th>
                    <th className="text-left px-2 py-2 w-24">
                      <span className="inline-flex items-center gap-1">
                        Ação
                        <FieldInfoTooltip
                          title="Ação de herança"
                          description={"own: linha própria desta BOM.\nadd: adiciona componente extra em relação ao pai.\noverride: substitui linha herdada do pai.\nremove: remove linha herdada do pai."}
                        />
                      </span>
                    </th>
                    <th className="text-center px-2 py-2 w-16">
                      <span className="inline-flex items-center gap-1">
                        Opt
                        <FieldInfoTooltip title="Opcional" description="Componente opcional. Só entra se uma regra ou condição mandar." />
                      </span>
                    </th>
                    <th className="text-center px-2 py-2 w-16">
                      <span className="inline-flex items-center gap-1">
                        Crítico
                        <FieldInfoTooltip
                          title="Componente crítico"
                          description="Se faltar, a produção deve ficar bloqueada ou em waiting_components."
                        />
                      </span>
                    </th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {ownLines.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Sem componentes</td></tr>
                  ) : ownLines.map((l) => {
                    const i = lines.indexOf(l);
                    return (
                      <tr key={l.id} className="border-t align-top">
                        <td className="px-2 py-1">
                          <Select
                            value={l.component_product_id ?? ""}
                            onValueChange={(v) => setLine(i, { component_product_id: v })}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Produto…" /></SelectTrigger>
                            <SelectContent>
                              {products?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className="h-8" type="number" step="0.01" value={l.quantity}
                            onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={l.operation_id ?? "__none__"}
                            onValueChange={(v) => setLine(i, { operation_id: v === "__none__" ? null : v })}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {bomOps?.map((o: any) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={l.work_center_id ?? "__none__"}
                            onValueChange={(v) => setLine(i, { work_center_id: v === "__none__" ? null : v })}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {workCenters?.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Textarea
                            className="h-8 min-h-8 text-xs"
                            value={l.qty_formula ?? ""}
                            onChange={(e) => setLine(i, { qty_formula: e.target.value || null })}
                            placeholder="ex.: base * 1.05"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={l.inheritance_action}
                            onValueChange={(v: any) => setLine(i, { inheritance_action: v })}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="own">own</SelectItem>
                              <SelectItem value="add">add</SelectItem>
                              <SelectItem value="override">override</SelectItem>
                              <SelectItem value="remove">remove</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <Checkbox
                            checked={l.is_optional}
                            onCheckedChange={(v) => setLine(i, { is_optional: !!v })}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <Checkbox
                            checked={!!l.is_critical}
                            onCheckedChange={(v) => setLine(i, { is_critical: !!v })}
                          />
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" onClick={() => removeLine(i)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 text-xs text-muted-foreground border-t flex gap-3">
              <Badge variant="outline">own</Badge> novo / próprio ·
              <Badge variant="outline">add</Badge> adicionado em relação ao pai ·
              <Badge variant="outline">override</Badge> sobrepõe linha herdada ·
              <Badge variant="outline">remove</Badge> exclui linha herdada
            </div>
          </Card>

          {!isNew && id && (
            <>
              <VariantRulesSection bomId={id} />
              <OutputsSection bomId={id} />
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}
