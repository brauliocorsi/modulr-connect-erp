import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function BomForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [bom, setBom] = useState<any>({ code: "", product_id: null, type: "normal", quantity: 1, active: true });
  const [lines, setLines] = useState<any[]>([]);

  const { data: products } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: b } = await supabase.from("boms").select("*").eq("id", id!).maybeSingle();
      if (b) setBom(b);
      const { data: ls } = await supabase.from("bom_lines").select("*").eq("bom_id", id!).order("sequence");
      setLines(ls ?? []);
    })();
  }, [id, isNew]);

  const save = async () => {
    if (!bom.product_id) return toast.error("Selecione o produto");
    let bid = id as string | undefined;
    const payload: any = { code: bom.code || null, product_id: bom.product_id, type: bom.type, quantity: bom.quantity, active: bom.active };
    if (isNew) {
      const { data, error } = await supabase.from("boms").insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      bid = (data as any).id;
    } else {
      const { error } = await supabase.from("boms").update(payload).eq("id", bid!);
      if (error) return toast.error(error.message);
    }
    for (const l of lines) {
      if (!l.component_product_id) continue;
      const lp: any = { bom_id: bid, component_product_id: l.component_product_id, quantity: Number(l.quantity || 1), sequence: l.sequence ?? 10 };
      if (l.id?.startsWith?.("new-")) await supabase.from("bom_lines").insert(lp);
      else if (l._dirty) await supabase.from("bom_lines").update(lp).eq("id", l.id);
    }
    toast.success("Salvo");
    if (isNew && bid) nav(`/products/bom/${bid}`);
  };

  const addLine = () => setLines((p) => [...p, { id: `new-${Date.now()}`, component_product_id: null, quantity: 1, sequence: (p.length + 1) * 10 }]);
  const removeLine = async (idx: number) => {
    const l = lines[idx];
    if (!l.id?.startsWith?.("new-")) await supabase.from("bom_lines").delete().eq("id", l.id);
    setLines((p) => p.filter((_, i) => i !== idx));
  };
  const setLine = (idx: number, patch: any) =>
    setLines((p) => { const n = [...p]; n[idx] = { ...n[idx], ...patch, _dirty: true }; return n; });

  return (
    <>
      <FormHeader
        title={isNew ? "Nova BOM" : bom.code || "BOM"}
        breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "BOM", to: "/products/bom" }, { label: bom.code || "Nova" }]}
        backTo="/products/bom"
        actions={<Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Salvar</Button>}
      />
      <PageBody>
        <div className="space-y-4 max-w-4xl">
          <Card className="p-6 grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Código</Label>
              <Input value={bom.code ?? ""} onChange={(e) => setBom({ ...bom, code: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Produto *</Label>
              <Select value={bom.product_id ?? ""} onValueChange={(v) => setBom({ ...bom, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{products?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={bom.type} onValueChange={(v) => setBom({ ...bom, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="phantom">Fantasma</SelectItem>
                  <SelectItem value="kit">Kit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantidade produzida</Label>
              <Input type="number" step="0.01" value={bom.quantity} onChange={(e) => setBom({ ...bom, quantity: Number(e.target.value) })} />
            </div>
          </Card>

          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">Componentes</div>
              <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Componente</th>
                  <th className="text-left px-3 py-2 w-32">Quantidade</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-muted-foreground py-6">Sem componentes</td></tr>
                ) : lines.map((l, i) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-2 py-1">
                      <Select value={l.component_product_id ?? ""} onValueChange={(v) => setLine(i, { component_product_id: v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Produto…" /></SelectTrigger>
                        <SelectContent>{products?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1"><Input className="h-8" type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></td>
                    <td><Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4" /></Button></td>
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
