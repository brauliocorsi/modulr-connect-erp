import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AttributeForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [attr, setAttr] = useState<any>({ name: "", display_type: "select" });
  const [values, setValues] = useState<any[]>([]);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: a } = await supabase.from("product_attributes").select("*").eq("id", id!).maybeSingle();
      if (a) setAttr(a);
      const { data: vs } = await supabase.from("product_attribute_values").select("*").eq("attribute_id", id!).order("name");
      setValues(vs ?? []);
    })();
  }, [id, isNew]);

  const save = async () => {
    if (!attr.name) return toast.error("Nome obrigatório");
    let aid = id as string | undefined;
    if (isNew) {
      const { data, error } = await supabase.from("product_attributes").insert({ name: attr.name, display_type: attr.display_type }).select("id").single();
      if (error) return toast.error(error.message);
      aid = (data as any).id;
    } else {
      const { error } = await supabase.from("product_attributes").update({ name: attr.name, display_type: attr.display_type }).eq("id", aid!);
      if (error) return toast.error(error.message);
    }
    for (const v of values) {
      const payload = { attribute_id: aid, name: v.name, color: v.color || null };
      if (v.id?.startsWith?.("new-")) {
        await supabase.from("product_attribute_values").insert(payload);
      } else if (v._dirty) {
        await supabase.from("product_attribute_values").update(payload).eq("id", v.id);
      }
    }
    toast.success("Salvo");
    if (isNew && aid) nav(`/products/attributes/${aid}`);
  };

  const addValue = () => setValues((p) => [...p, { id: `new-${Date.now()}`, name: "", color: "" }]);
  const removeValue = async (idx: number) => {
    const v = values[idx];
    if (!v.id?.startsWith?.("new-")) await supabase.from("product_attribute_values").delete().eq("id", v.id);
    setValues((p) => p.filter((_, i) => i !== idx));
  };
  const setValue = (idx: number, patch: any) =>
    setValues((p) => { const n = [...p]; n[idx] = { ...n[idx], ...patch, _dirty: true }; return n; });

  return (
    <>
      <FormHeader
        title={isNew ? "Novo Atributo" : attr.name}
        breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Atributos", to: "/products/attributes" }, { label: attr.name || "Novo" }]}
        backTo="/products/attributes"
        actions={<Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Salvar</Button>}
      />
      <PageBody>
        <div className="space-y-4 max-w-3xl">
          <Card className="p-6 grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={attr.name} onChange={(e) => setAttr({ ...attr, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Exibição</Label>
              <Select value={attr.display_type} onValueChange={(v) => setAttr({ ...attr, display_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="select">Lista</SelectItem>
                  <SelectItem value="radio">Botões</SelectItem>
                  <SelectItem value="color">Cor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">Valores</div>
              <Button size="sm" variant="outline" onClick={addValue}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr><th className="text-left px-3 py-2">Nome</th><th className="text-left px-3 py-2 w-40">Cor (hex)</th><th className="w-10" /></tr>
              </thead>
              <tbody>
                {values.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-muted-foreground py-6">Sem valores</td></tr>
                ) : values.map((v, i) => (
                  <tr key={v.id} className="border-t">
                    <td className="px-2 py-1"><Input className="h-8" value={v.name} onChange={(e) => setValue(i, { name: e.target.value })} /></td>
                    <td className="px-2 py-1">
                      {attr.display_type === "color" ? (
                        <div className="flex items-center gap-2">
                          <label
                            className="relative h-8 w-8 rounded-md border cursor-pointer overflow-hidden flex-shrink-0"
                            style={{ background: v.color || "transparent" }}
                            title="Escolher cor"
                          >
                            {!v.color && (
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">+</span>
                            )}
                            <input
                              type="color"
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              value={v.color || "#000000"}
                              onChange={(e) => setValue(i, { color: e.target.value })}
                            />
                          </label>
                          <Input
                            className="h-8 font-mono"
                            placeholder="#000000"
                            value={v.color ?? ""}
                            onChange={(e) => setValue(i, { color: e.target.value })}
                          />
                          {v.color && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setValue(i, { color: "" })} title="Limpar">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">— (defina exibição como "Cor" para usar)</span>
                      )}
                    </td>
                    <td><Button variant="ghost" size="icon" onClick={() => removeValue(i)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
