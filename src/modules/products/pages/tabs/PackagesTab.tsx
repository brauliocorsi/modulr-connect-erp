import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { printColisLabels } from "@/modules/barcode/printBarcodes";

type Pkg = {
  id: string;
  product_id: string;
  sequence: number;
  label: string;
  barcode: string | null;
  weight_kg: number | null;
  notes: string | null;
};

export function PackagesTab({ productId }: { productId: string }) {
  const [items, setItems] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("product_packages")
      .select("*")
      .eq("product_id", productId)
      .order("sequence");
    setItems((data as any) ?? []);
  };
  useEffect(() => { load(); }, [productId]);

  const add = async () => {
    setLoading(true);
    const next = (items[items.length - 1]?.sequence ?? 0) + 1;
    const total = items.length + 1;
    const label = `Caixa ${next}/${total}`;
    const { error } = await supabase.from("product_packages").insert({
      product_id: productId, sequence: next, label,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    // Re-label all to N/total
    const { data: fresh } = await supabase.from("product_packages").select("*").eq("product_id", productId).order("sequence");
    const list = (fresh as any[]) ?? [];
    await Promise.all(list.map((p, i) =>
      supabase.from("product_packages").update({ label: `Caixa ${i + 1}/${list.length}`, sequence: i + 1 }).eq("id", p.id)
    ));
    load();
  };

  const update = async (id: string, patch: Partial<Pkg>) => {
    setItems((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("product_packages").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este colis?")) return;
    const { error } = await supabase.from("product_packages").delete().eq("id", id);
    if (error) return toast.error(error.message);
    const remaining = items.filter((x) => x.id !== id);
    await Promise.all(remaining.map((p, i) =>
      supabase.from("product_packages").update({ label: `Caixa ${i + 1}/${remaining.length}`, sequence: i + 1 }).eq("id", p.id)
    ));
    load();
  };

  const printLabels = async () => {
    if (!items.length) return;
    await printColisLabels(items.map((p) => p.id));
  };

  const printOne = async (id: string) => {
    await printColisLabels([id]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Colis / Caixas do produto</h3>
          <p className="text-sm text-muted-foreground">
            Quando o produto é entregue em vários volumes (ex.: Caixa 1/2 + Caixa 2/2), defina aqui cada colis com o seu próprio código de barras.
            Compras e vendas continuam unitárias; receção e picking trabalham por colis.
          </p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && <Button variant="outline" size="sm" onClick={printLabels}><Printer className="h-4 w-4 mr-1" /> Etiquetas</Button>}
          <Button size="sm" onClick={add} disabled={loading}><Plus className="h-4 w-4 mr-1" /> Adicionar colis</Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          Sem colis definidos — produto tratado como volume único.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 w-16">Seq</th>
              <th className="text-left px-3 py-2">Etiqueta</th>
              <th className="text-left px-3 py-2">Código de barras</th>
              <th className="text-left px-3 py-2 w-32">Peso (kg)</th>
              <th className="text-left px-3 py-2">Notas</th>
              <th className="px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-1">{p.sequence}</td>
                <td className="px-2 py-1">
                  <Input className="h-8" value={p.label} onChange={(e) => update(p.id, { label: e.target.value })} />
                </td>
                <td className="px-2 py-1">
                  <Input className="h-8 font-mono" value={p.barcode ?? ""} placeholder="Scan…"
                    onChange={(e) => update(p.id, { barcode: e.target.value || null })} />
                </td>
                <td className="px-2 py-1">
                  <Input className="h-8" type="number" step="0.01" value={p.weight_kg ?? ""}
                    onChange={(e) => update(p.id, { weight_kg: e.target.value === "" ? null : Number(e.target.value) })} />
                </td>
                <td className="px-2 py-1">
                  <Input className="h-8" value={p.notes ?? ""} onChange={(e) => update(p.id, { notes: e.target.value || null })} />
                </td>
                <td className="px-2 py-1 flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => printOne(p.id)} title="Imprimir etiqueta"><Printer className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
