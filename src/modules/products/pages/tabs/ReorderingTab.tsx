import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Save, Trash2, Play, Info } from "lucide-react";
import { toast } from "sonner";

type Rule = {
  id?: string;
  product_id: string;
  variant_id?: string | null;
  warehouse_id: string;
  min_qty: number;
  max_qty: number;
  multiple_qty: number;
  active: boolean;
  _new?: boolean;
  _dirty?: boolean;
};

export function ReorderingTab({ productId }: { productId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: rs }, { data: wh }, { data: vs }, { data: sups }] = await Promise.all([
      supabase.from("reordering_rules").select("*").eq("product_id", productId).order("created_at"),
      supabase.from("warehouses").select("id,name,code").eq("active", true).order("name"),
      supabase.from("product_variants").select("id, product_variant_values(value:product_attribute_values(name))").eq("product_id", productId).eq("active", true),
      supabase.from("product_suppliers").select("id, priority, partner:partners(name)").eq("product_id", productId).order("priority"),
    ]);
    setRules((rs as any[]) ?? []);
    setWarehouses(wh ?? []);
    setVariants(
      (vs ?? []).map((v: any) => ({
        id: v.id,
        label: (v.product_variant_values ?? []).map((pv: any) => pv.value?.name).filter(Boolean).join(" / ") || "Variante",
      }))
    );
    setSuppliers(sups ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [productId]);

  const addRule = () => {
    const defaultWh = warehouses[0]?.id;
    if (!defaultWh) return toast.error("Cadastre um armazém primeiro");
    setRules((p) => [
      ...p,
      {
        product_id: productId,
        warehouse_id: defaultWh,
        variant_id: null,
        min_qty: 1,
        max_qty: 5,
        multiple_qty: 1,
        active: true,
        _new: true,
        _dirty: true,
      },
    ]);
  };

  const setRule = (idx: number, patch: Partial<Rule>) =>
    setRules((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], ...patch, _dirty: true };
      return n;
    });

  const removeRule = async (idx: number) => {
    const r = rules[idx];
    if (r.id) {
      const { error } = await supabase.from("reordering_rules").delete().eq("id", r.id);
      if (error) return toast.error(error.message);
    }
    setRules((p) => p.filter((_, i) => i !== idx));
    toast.success("Regra removida");
  };

  const saveAll = async () => {
    for (const r of rules) {
      if (!r._dirty) continue;
      const payload = {
        product_id: r.product_id,
        variant_id: r.variant_id || null,
        warehouse_id: r.warehouse_id,
        min_qty: Number(r.min_qty) || 0,
        max_qty: Number(r.max_qty) || 0,
        multiple_qty: Number(r.multiple_qty) || 1,
        active: r.active,
      };
      if (r._new) {
        const { error } = await supabase.from("reordering_rules").insert(payload);
        if (error) return toast.error(error.message);
      } else if (r.id) {
        const { error } = await supabase.from("reordering_rules").update(payload).eq("id", r.id);
        if (error) return toast.error(error.message);
      }
    }
    toast.success("Regras salvas");
    load();
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.rpc("run_reordering_rules");
    setRunning(false);
    if (error) return toast.error(error.message);
    toast.success(`Reabastecimento executado: ${data ?? 0} RFQ(s) criada(s)`);
  };

  const hasSupplier = suppliers.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Regras de Reabastecimento</h3>
          <p className="text-sm text-muted-foreground">
            Quando o disponível cair abaixo do mínimo, o sistema gera uma RFQ para o fornecedor preferencial até atingir o máximo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
            <Play className="h-4 w-4 mr-1" /> {running ? "Executando…" : "Executar agora"}
          </Button>
          <Button size="sm" variant="outline" onClick={addRule}>
            <Plus className="h-4 w-4 mr-1" /> Nova regra
          </Button>
          <Button size="sm" onClick={saveAll}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
        </div>
      </div>

      {!hasSupplier && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-warning" />
          <div>
            <strong>Sem fornecedor cadastrado.</strong> O cron ignora produtos sem fornecedor preferencial. Adicione um na aba <em>Compras → Fornecedores</em>.
          </div>
        </div>
      )}

      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Armazém</th>
              {variants.length > 0 && <th className="text-left px-3 py-2">Variante</th>}
              <th className="text-right px-3 py-2 w-24">Mínimo</th>
              <th className="text-right px-3 py-2 w-24">Máximo</th>
              <th className="text-right px-3 py-2 w-24">Múltiplo</th>
              <th className="text-center px-3 py-2 w-20">Ativo</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Carregando…</td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma regra cadastrada</td></tr>
            ) : (
              rules.map((r, i) => (
                <tr key={r.id ?? `new-${i}`} className="border-t">
                  <td className="px-2 py-1">
                    <Select value={r.warehouse_id} onValueChange={(v) => setRule(i, { warehouse_id: v })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  {variants.length > 0 && (
                    <td className="px-2 py-1">
                      <Select value={r.variant_id ?? "__all__"} onValueChange={(v) => setRule(i, { variant_id: v === "__all__" ? null : v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Todas as variantes</SelectItem>
                          {variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                  )}
                  <td className="px-2 py-1">
                    <Input className="h-8 text-right" type="number" step="1" value={r.min_qty} onChange={(e) => setRule(i, { min_qty: Number(e.target.value) })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="h-8 text-right" type="number" step="1" value={r.max_qty} onChange={(e) => setRule(i, { max_qty: Number(e.target.value) })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="h-8 text-right" type="number" step="1" value={r.multiple_qty} onChange={(e) => setRule(i, { multiple_qty: Number(e.target.value) })} />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Switch checked={r.active} onCheckedChange={(v) => setRule(i, { active: v })} />
                  </td>
                  <td className="px-1 py-1">
                    <Button variant="ghost" size="icon" onClick={() => removeRule(i)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        O cron <code>reordering-cron</code> executa periodicamente. Use "Executar agora" para forçar manualmente.
      </p>
    </div>
  );
}
