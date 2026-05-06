import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TONE: Record<string, any> = { draft: "default", in_progress: "info", done: "success", cancelled: "destructive" };

export default function AdjustmentForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id || id === "new";
  const [adj, setAdj] = useState<any>({ name: "", state: "draft", location_id: null });
  const [lines, setLines] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const load = async () => {
    const [{ data: prods }, { data: locs }] = await Promise.all([
      supabase.from("products").select("id,name").eq("active", true).order("name"),
      supabase.from("stock_locations").select("id,name,full_path,type").eq("active", true).eq("type", "internal").order("name"),
    ]);
    setProducts(prods ?? []);
    setLocations(locs ?? []);
    if (!isNew) {
      const { data: a } = await supabase.from("inventory_adjustments").select("*").eq("id", id!).maybeSingle();
      setAdj(a);
      const { data: ls } = await supabase.from("inventory_adjustment_lines").select("*, products(name), stock_locations(name,full_path)").eq("adjustment_id", id!);
      setLines(ls ?? []);
    }
  };
  useEffect(() => { load(); }, [id]);

  const isLocked = adj?.state === "done" || adj?.state === "cancelled";

  const refreshTheoretical = async (line: any) => {
    if (!line.product_id || !line.location_id) return 0;
    const { data } = await supabase
      .from("stock_quants")
      .select("quantity")
      .eq("product_id", line.product_id)
      .eq("location_id", line.location_id);
    return (data ?? []).reduce((s: number, r: any) => s + Number(r.quantity), 0);
  };

  const updateLine = async (idx: number, patch: any) => {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    if (patch.product_id || patch.location_id) {
      next[idx].theoretical_qty = await refreshTheoretical(next[idx]);
      if (next[idx].counted_qty == null) next[idx].counted_qty = next[idx].theoretical_qty;
    }
    setLines(next);
  };

  const addLine = () => setLines((p) => [...p, { product_id: null, location_id: adj.location_id, theoretical_qty: 0, counted_qty: 0 }]);
  const removeLine = async (idx: number) => {
    const l = lines[idx];
    if (l.id) await supabase.from("inventory_adjustment_lines").delete().eq("id", l.id);
    setLines((p) => p.filter((_, i) => i !== idx));
  };

  const save = async () => {
    let adjId = adj.id;
    if (isNew) {
      const { data: seq } = await supabase.rpc("next_sequence", { _code: "inventory_adj" });
      const payload: any = { name: seq ?? `INV/ADJ/${Date.now()}`, state: "draft", location_id: adj.location_id };
      const { data, error } = await supabase.from("inventory_adjustments").insert(payload).select().single();
      if (error) return toast.error(error.message);
      adjId = data.id;
    } else {
      const { error } = await supabase.from("inventory_adjustments").update({ location_id: adj.location_id }).eq("id", adjId);
      if (error) return toast.error(error.message);
    }
    for (const l of lines) {
      if (!l.product_id || !l.location_id) continue;
      if (l.id) {
        await supabase.from("inventory_adjustment_lines").update({
          product_id: l.product_id, location_id: l.location_id,
          theoretical_qty: l.theoretical_qty ?? 0, counted_qty: l.counted_qty ?? 0,
        }).eq("id", l.id);
      } else {
        await supabase.from("inventory_adjustment_lines").insert({
          adjustment_id: adjId, product_id: l.product_id, location_id: l.location_id,
          theoretical_qty: l.theoretical_qty ?? 0, counted_qty: l.counted_qty ?? 0,
        });
      }
    }
    toast.success("Salvo");
    if (isNew) nav(`/inventory/adjustments/${adjId}`);
    else load();
  };

  const validate = async () => {
    await save();
    const targetId = adj.id ?? id;
    const { error } = await supabase.rpc("apply_inventory_adjustment", { _adj: targetId });
    if (error) return toast.error(error.message);
    toast.success("Ajuste validado");
    load();
  };

  return (
    <>
      <FormHeader
        title={isNew ? "Novo ajuste" : adj?.name ?? ""}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ajustes", to: "/inventory/adjustments" }, { label: isNew ? "Novo" : adj?.name }]}
        backTo="/inventory/adjustments"
        state={adj?.state ? { label: adj.state, tone: TONE[adj.state] ?? "default" } : undefined}
        actions={
          <div className="flex gap-2">
            {!isLocked && <Button size="sm" variant="outline" onClick={save}>Salvar</Button>}
            {!isLocked && !isNew && <Button size="sm" onClick={validate}><CheckCircle2 className="h-4 w-4 mr-1" /> Validar</Button>}
          </div>
        }
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-4 grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Local padrão</Label>
                <select className="w-full h-9 mt-1 border rounded-md bg-background px-2 text-sm"
                  value={adj.location_id ?? ""} disabled={isLocked}
                  onChange={(e) => setAdj({ ...adj, location_id: e.target.value || null })}>
                  <option value="">—</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.full_path ?? l.name}</option>)}
                </select>
              </div>
            </Card>

            <Card>
              <div className="px-4 py-3 border-b font-semibold flex items-center justify-between">
                <span>Linhas de contagem</span>
                {!isLocked && <Button size="sm" variant="ghost" onClick={addLine}><Plus className="h-4 w-4 mr-1" /> Linha</Button>}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Produto</th>
                    <th className="text-left px-3 py-2 w-64">Local</th>
                    <th className="text-left px-3 py-2 w-28">Teórico</th>
                    <th className="text-left px-3 py-2 w-28">Contado</th>
                    <th className="text-left px-3 py-2 w-28">Diferença</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const diff = Number(l.counted_qty ?? 0) - Number(l.theoretical_qty ?? 0);
                    return (
                      <tr key={l.id ?? `n${i}`} className="border-t">
                        <td className="px-2 py-1">
                          <select className="w-full h-8 border rounded bg-background px-2 text-sm"
                            value={l.product_id ?? ""} disabled={isLocked}
                            onChange={(e) => updateLine(i, { product_id: e.target.value })}>
                            <option value="">—</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select className="w-full h-8 border rounded bg-background px-2 text-sm"
                            value={l.location_id ?? ""} disabled={isLocked}
                            onChange={(e) => updateLine(i, { location_id: e.target.value })}>
                            <option value="">—</option>
                            {locations.map((lc) => <option key={lc.id} value={lc.id}>{lc.full_path ?? lc.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <Input className="h-8" type="number" step="0.01" value={l.theoretical_qty ?? 0} disabled />
                        </td>
                        <td className="px-2 py-1">
                          <Input className="h-8" type="number" step="0.01" value={l.counted_qty ?? 0} disabled={isLocked}
                            onChange={(e) => updateLine(i, { counted_qty: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          <span className={diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : ""}>{diff.toFixed(2)}</span>
                        </td>
                        <td className="px-2 py-1">
                          {!isLocked && (
                            <Button size="icon" variant="ghost" onClick={() => removeLine(i)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sem linhas</td></tr>
                  )}
                </tbody>
              </table>
            </Card>

            {!isNew && <RecordSidebar recordType="inventory_adjustment" recordId={id!} />}
          </div>
          <aside />
        </div>
      </PageBody>
    </>
  );
}
