import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function SuppliersTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("product_suppliers").select("*").eq("product_id", productId).order("priority");
      setRows(data ?? []);
      const { data: p } = await supabase.from("partners").select("id,name").eq("is_supplier", true).order("name");
      setPartners(p ?? []);
    })();
  }, [productId]);

  const add = () => setRows((r) => [...r, { id: `new-${Date.now()}`, partner_id: null, supplier_sku: "", price: 0, min_qty: 1, lead_time_days: 7, priority: r.length + 1 }]);
  const set = (i: number, p: any) => setRows((r) => { const n = [...r]; n[i] = { ...n[i], ...p, _dirty: true }; return n; });
  const remove = async (i: number) => {
    const r = rows[i];
    if (!r.id?.startsWith?.("new-")) await supabase.from("product_suppliers").delete().eq("id", r.id);
    setRows((p) => p.filter((_, x) => x !== i));
  };
  const save = async () => {
    for (const r of rows) {
      if (!r.partner_id) continue;
      const payload = { product_id: productId, partner_id: r.partner_id, supplier_sku: r.supplier_sku || null,
        price: Number(r.price || 0), min_qty: Number(r.min_qty || 1), lead_time_days: Number(r.lead_time_days || 0), priority: Number(r.priority || 1) };
      if (r.id?.startsWith?.("new-")) await supabase.from("product_suppliers").insert(payload);
      else if (r._dirty) await supabase.from("product_suppliers").update(payload).eq("id", r.id);
    }
    toast.success("Fornecedores guardados");
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-semibold">Fornecedores</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={add}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
          <Button size="sm" onClick={save}>Guardar</Button>
        </div>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left p-2">Fornecedor</th>
            <th className="text-left p-2 w-32">SKU</th>
            <th className="text-left p-2 w-24">Preço</th>
            <th className="text-left p-2 w-20">Qtd Mín</th>
            <th className="text-left p-2 w-24">Lead (dias)</th>
            <th className="text-left p-2 w-20">Prioridade</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem fornecedores</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className="p-1">
                <Select value={r.partner_id ?? ""} onValueChange={(v) => set(i, { partner_id: v })}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="…" /></SelectTrigger>
                  <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </td>
              <td className="p-1"><Input className="h-8" value={r.supplier_sku ?? ""} onChange={(e) => set(i, { supplier_sku: e.target.value })} /></td>
              <td className="p-1"><Input className="h-8" type="number" step="0.01" value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
              <td className="p-1"><Input className="h-8" type="number" value={r.min_qty} onChange={(e) => set(i, { min_qty: e.target.value })} /></td>
              <td className="p-1"><Input className="h-8" type="number" value={r.lead_time_days} onChange={(e) => set(i, { lead_time_days: e.target.value })} /></td>
              <td className="p-1"><Input className="h-8" type="number" value={r.priority} onChange={(e) => set(i, { priority: e.target.value })} /></td>
              <td><Button variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
