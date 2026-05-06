import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function VariantsTab({ productId }: { productId: string }) {
  const [attrs, setAttrs] = useState<any[]>([]); // template attributes with values
  const [allAttrs, setAllAttrs] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);

  const load = async () => {
    const { data: tas } = await supabase
      .from("product_template_attributes")
      .select("id, attribute_id, product_attributes(name)")
      .eq("product_id", productId);
    const ids = (tas ?? []).map((t: any) => t.id);
    let vals: any[] = [];
    if (ids.length) {
      const { data } = await supabase
        .from("product_template_attribute_values")
        .select("id, template_attribute_id, value_id, price_extra, product_attribute_values(name, color)")
        .in("template_attribute_id", ids);
      vals = data ?? [];
    }
    setAttrs((tas ?? []).map((t: any) => ({ ...t, values: vals.filter((v: any) => v.template_attribute_id === t.id) })));

    const { data: aa } = await supabase.from("product_attributes").select("id,name,product_attribute_values(id,name,color)").order("name");
    setAllAttrs(aa ?? []);

    const { data: vs } = await supabase
      .from("product_variants")
      .select("id, sku, barcode, price_extra, active, weight, product_variant_values(value_id, product_attribute_values(name))")
      .eq("product_id", productId);
    setVariants(vs ?? []);
  };

  useEffect(() => { load(); }, [productId]);

  const addAttr = async (attribute_id: string) => {
    if (attrs.find((a) => a.attribute_id === attribute_id)) return;
    await supabase.from("product_template_attributes").insert({ product_id: productId, attribute_id });
    load();
  };

  const toggleValue = async (templateAttrId: string, value_id: string, on: boolean) => {
    if (on) {
      await supabase.from("product_template_attribute_values").insert({ template_attribute_id: templateAttrId, value_id });
    } else {
      await supabase.from("product_template_attribute_values").delete().eq("template_attribute_id", templateAttrId).eq("value_id", value_id);
    }
    load();
  };

  const removeAttr = async (id: string) => {
    await supabase.from("product_template_attributes").delete().eq("id", id);
    load();
  };

  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_product_variants", { _product: productId });
    if (error) return toast.error(error.message);
    toast.success(`${data ?? 0} variantes geradas`);
    load();
  };

  const updateVariant = async (v: any, patch: any) => {
    await supabase.from("product_variants").update(patch).eq("id", v.id);
    load();
  };

  const removeVariant = async (id: string) => {
    await supabase.from("product_variants").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Atributos</div>
          <Select value="" onValueChange={addAttr}>
            <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Adicionar atributo…" /></SelectTrigger>
            <SelectContent>{allAttrs.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {attrs.length === 0 && <div className="text-sm text-muted-foreground">Nenhum atributo configurado</div>}
          {attrs.map((a) => {
            const fullAttr = allAttrs.find((x) => x.id === a.attribute_id);
            const selectedValueIds = new Set(a.values.map((v: any) => v.value_id));
            return (
              <div key={a.id} className="border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{a.product_attributes?.name}</div>
                  <Button size="icon" variant="ghost" onClick={() => removeAttr(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {fullAttr?.product_attribute_values?.map((v: any) => {
                    const on = selectedValueIds.has(v.id);
                    return (
                      <Badge key={v.id} variant={on ? "default" : "outline"} className="cursor-pointer"
                        onClick={() => toggleValue(a.id, v.id, !on)}>{v.name}</Badge>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <Button size="sm" onClick={generate} disabled={attrs.length === 0}>
          <Sparkles className="h-4 w-4 mr-1" />Gerar variantes
        </Button>
      </div>

      <div className="space-y-2">
        <div className="font-semibold">Variantes ({variants.length})</div>
        <table className="w-full text-sm border">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-2">Combinação</th>
              <th className="text-left p-2 w-32">SKU</th>
              <th className="text-left p-2 w-32">Código barras</th>
              <th className="text-left p-2 w-28">Preço extra</th>
              <th className="text-left p-2 w-24">Peso</th>
              <th className="text-left p-2 w-20">Ativo</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem variantes</td></tr>
            ) : variants.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="p-2">{(v.product_variant_values || []).map((x: any) => x.product_attribute_values?.name).join(" / ")}</td>
                <td className="p-1"><Input className="h-8" defaultValue={v.sku ?? ""} onBlur={(e) => updateVariant(v, { sku: e.target.value })} /></td>
                <td className="p-1"><Input className="h-8" defaultValue={v.barcode ?? ""} onBlur={(e) => updateVariant(v, { barcode: e.target.value })} /></td>
                <td className="p-1"><Input className="h-8" type="number" step="0.01" defaultValue={v.price_extra} onBlur={(e) => updateVariant(v, { price_extra: Number(e.target.value) })} /></td>
                <td className="p-1"><Input className="h-8" type="number" step="0.001" defaultValue={v.weight ?? 0} onBlur={(e) => updateVariant(v, { weight: Number(e.target.value) })} /></td>
                <td className="p-2"><input type="checkbox" defaultChecked={v.active} onChange={(e) => updateVariant(v, { active: e.target.checked })} /></td>
                <td><Button variant="ghost" size="icon" onClick={() => removeVariant(v.id)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
