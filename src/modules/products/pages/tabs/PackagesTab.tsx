import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

type Tpl = {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  package_sequence: number;
  package_total: number;
  package_group: string | null;
  default_length_cm: number | null;
  default_width_cm: number | null;
  default_height_cm: number | null;
  default_volume_m3: number | null;
  default_weight_kg: number | null;
  default_assembly_minutes: number | null;
  stackable: boolean;
  fragile: boolean;
  requires_flat_transport: boolean;
  requires_assembly: boolean;
  is_required: boolean;
  barcode_pattern: string | null;
  active: boolean;
};

const num = (v: string) => (v === "" ? null : Number(v));

export function PackagesTab({ productId }: { productId: string }) {
  const [items, setItems] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("product_package_templates")
      .select("*")
      .eq("product_id", productId)
      .order("package_sequence");
    if (error) toast.error(error.message);
    setItems(((data as any) ?? []) as Tpl[]);
  };
  useEffect(() => { load(); }, [productId]);

  const resequence = async (list: Tpl[]) => {
    await Promise.all(
      list.map((p, i) =>
        supabase
          .from("product_package_templates")
          .update({ package_sequence: i + 1, package_total: list.length })
          .eq("id", p.id),
      ),
    );
  };

  const add = async () => {
    setLoading(true);
    const next = items.length + 1;
    const { error } = await supabase.from("product_package_templates").insert({
      product_id: productId,
      name: `Colis ${next}`,
      package_sequence: next,
      package_total: next,
      active: true,
    } as any);
    setLoading(false);
    if (error) return toast.error(error.message);
    const { data } = await supabase
      .from("product_package_templates")
      .select("*")
      .eq("product_id", productId)
      .order("package_sequence");
    await resequence(((data as any) ?? []) as Tpl[]);
    load();
  };

  const update = async (id: string, patch: Partial<Tpl>) => {
    setItems((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase
      .from("product_package_templates")
      .update(patch as any)
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este template de colis?")) return;
    const { error } = await supabase
      .from("product_package_templates")
      .delete()
      .eq("id", id);
    if (error) return toast.error(error.message);
    const remaining = items.filter((x) => x.id !== id);
    await resequence(remaining);
    load();
  };

  const summary = useMemo(() => {
    const active = items.filter((i) => i.active);
    const volTotal = active.reduce((s, i) => s + Number(i.default_volume_m3 ?? 0), 0);
    const wTotal = active.reduce((s, i) => s + Number(i.default_weight_kg ?? 0), 0);
    const maxL = Math.max(0, ...active.map((i) => Number(i.default_length_cm ?? 0)));
    const maxW = Math.max(0, ...active.map((i) => Number(i.default_width_cm ?? 0)));
    const maxH = Math.max(0, ...active.map((i) => Number(i.default_height_cm ?? 0)));
    const asmTotal = active.reduce((s, i) => s + Number(i.default_assembly_minutes ?? 0), 0);
    return { count: active.length, volTotal, wTotal, maxL, maxW, maxH, asmTotal };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Templates de colis (logística)</h3>
          <p className="text-sm text-muted-foreground">
            Define os volumes físicos com que o produto é entregue. Alimenta cubicagem, capacidade de rota,
            package tracking e snapshot dos colis físicos criados em receção/produção.
          </p>
        </div>
        <Button size="sm" onClick={add} disabled={loading}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar template
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          Sem templates definidos — o produto é tratado como volume único.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs bg-muted/40 rounded-md p-3">
            <Cell label="Colis activos" value={summary.count} />
            <Cell label="Volume total" value={`${summary.volTotal.toFixed(3)} m³`} />
            <Cell label="Peso total" value={`${summary.wTotal.toFixed(2)} kg`} />
            <Cell label="Maior L" value={`${summary.maxL} cm`} />
            <Cell label="Maior W" value={`${summary.maxW} cm`} />
            <Cell label="Maior H" value={`${summary.maxH} cm`} />
            <Cell label="Montagem" value={`${summary.asmTotal} min`} />
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-2 text-left w-10">#</th>
                  <th className="px-2 py-2 text-left">Nome</th>
                  <th className="px-2 py-2 text-left w-20">L (cm)</th>
                  <th className="px-2 py-2 text-left w-20">W (cm)</th>
                  <th className="px-2 py-2 text-left w-20">H (cm)</th>
                  <th className="px-2 py-2 text-left w-24">Vol m³</th>
                  <th className="px-2 py-2 text-left w-20">Peso kg</th>
                  <th className="px-2 py-2 text-left w-20">Mont. min</th>
                  <th className="px-2 py-2 text-center w-12" title="Empilhável">Stk</th>
                  <th className="px-2 py-2 text-center w-12" title="Frágil">Frg</th>
                  <th className="px-2 py-2 text-center w-12" title="Transporte horizontal">Flat</th>
                  <th className="px-2 py-2 text-center w-12" title="Requer montagem">Mnt</th>
                  <th className="px-2 py-2 text-center w-12" title="Obrigatório">Req</th>
                  <th className="px-2 py-2 text-left">Barcode pattern</th>
                  <th className="px-2 py-2 text-center w-12">Act</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-1">{p.package_sequence}/{p.package_total}</td>
                    <td className="px-1 py-1">
                      <Input className="h-7" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
                    </td>
                    <td className="px-1 py-1">
                      <Input className="h-7" type="number" step="0.1" value={p.default_length_cm ?? ""} onChange={(e) => update(p.id, { default_length_cm: num(e.target.value) })} />
                    </td>
                    <td className="px-1 py-1">
                      <Input className="h-7" type="number" step="0.1" value={p.default_width_cm ?? ""} onChange={(e) => update(p.id, { default_width_cm: num(e.target.value) })} />
                    </td>
                    <td className="px-1 py-1">
                      <Input className="h-7" type="number" step="0.1" value={p.default_height_cm ?? ""} onChange={(e) => update(p.id, { default_height_cm: num(e.target.value) })} />
                    </td>
                    <td className="px-1 py-1 text-muted-foreground" title="Calculado automaticamente por L×W×H">
                      {p.default_volume_m3 != null ? Number(p.default_volume_m3).toFixed(4) : "—"}
                    </td>
                    <td className="px-1 py-1">
                      <Input className="h-7" type="number" step="0.01" value={p.default_weight_kg ?? ""} onChange={(e) => update(p.id, { default_weight_kg: num(e.target.value) })} />
                    </td>
                    <td className="px-1 py-1">
                      <Input className="h-7" type="number" value={p.default_assembly_minutes ?? ""} onChange={(e) => update(p.id, { default_assembly_minutes: num(e.target.value) as any })} />
                    </td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.stackable} onCheckedChange={(v) => update(p.id, { stackable: !!v })} /></td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.fragile} onCheckedChange={(v) => update(p.id, { fragile: !!v })} /></td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.requires_flat_transport} onCheckedChange={(v) => update(p.id, { requires_flat_transport: !!v })} /></td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.requires_assembly} onCheckedChange={(v) => update(p.id, { requires_assembly: !!v })} /></td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.is_required} onCheckedChange={(v) => update(p.id, { is_required: !!v })} /></td>
                    <td className="px-1 py-1">
                      <Input className="h-7 font-mono" value={p.barcode_pattern ?? ""} placeholder="opcional" onChange={(e) => update(p.id, { barcode_pattern: e.target.value || null })} />
                    </td>
                    <td className="px-1 py-1 text-center"><Checkbox checked={p.active} onCheckedChange={(v) => update(p.id, { active: !!v })} /></td>
                    <td className="px-1 py-1">
                      <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-muted-foreground flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <span>
              O volume é calculado automaticamente (L×W×H/1.000.000) por trigger do backend.
              Os snapshots de colis físicos (<code>stock_packages</code>) preservam as medidas no momento da criação,
              mesmo que o template seja alterado depois.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
