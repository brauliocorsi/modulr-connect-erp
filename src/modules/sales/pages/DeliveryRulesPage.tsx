import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";

export default function DeliveryRulesPage() {
  return (
    <>
      <PageHeader
        title="Regras de Entrega"
        breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Regras de Entrega" }]}
      />
      <PageBody>
        <Tabs defaultValue="zip">
          <TabsList>
            <TabsTrigger value="zip">Por Código Postal</TabsTrigger>
            <TabsTrigger value="region">Por Distrito / Região</TabsTrigger>
          </TabsList>
          <TabsContent value="zip" className="pt-4"><ZipRules /></TabsContent>
          <TabsContent value="region" className="pt-4"><RegionRules /></TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function ZipRules() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["delivery_zip_rules"],
    queryFn: async () =>
      (await supabase.from("delivery_zip_rules").select("*").order("zip_from")).data ?? [],
  });
  const [draft, setDraft] = useState<any[]>([]);
  const rows = [...(data ?? []), ...draft];

  const save = useMutation({
    mutationFn: async (row: any) => {
      const payload = {
        label: row.label || null,
        zip_from: row.zip_from,
        zip_to: row.zip_to,
        price: Number(row.price || 0),
        active: row.active ?? true,
      };
      if (row.id?.startsWith?.("new-")) {
        const { error } = await supabase.from("delivery_zip_rules").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("delivery_zip_rules").update(payload).eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Guardado");
      setDraft([]);
      qc.invalidateQueries({ queryKey: ["delivery_zip_rules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = async (id: string) => {
    if (id.startsWith("new-")) {
      setDraft((d) => d.filter((x) => x.id !== id));
      return;
    }
    if (!confirm("Remover esta regra?")) return;
    await supabase.from("delivery_zip_rules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["delivery_zip_rules"] });
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define o preço de entrega por faixa de código postal (4 primeiros dígitos). Ex.: 1000 a 1999 — Lisboa centro.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDraft((d) => [
              ...d,
              { id: `new-${Date.now()}`, label: "", zip_from: "", zip_to: "", price: 0, active: true },
            ])
          }
        >
          <Plus className="h-4 w-4 mr-1" /> Nova faixa
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Etiqueta</th>
              <th className="text-left px-3 py-2 w-28">CP de</th>
              <th className="text-left px-3 py-2 w-28">CP até</th>
              <th className="text-left px-3 py-2 w-32">Preço</th>
              <th className="text-left px-3 py-2 w-24">Ativo</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Sem regras</td></tr>
            ) : rows.map((r, i) => (
              <Row key={r.id} row={r} onChange={(p) => {
                if (r.id.startsWith?.("new-")) {
                  setDraft((d) => d.map((x) => x.id === r.id ? { ...x, ...p } : x));
                } else {
                  // mutate local copy via re-render
                  Object.assign(r, p);
                  qc.setQueryData(["delivery_zip_rules"], (old: any[] = []) =>
                    old.map((x) => (x.id === r.id ? { ...x, ...p } : x))
                  );
                }
              }} onSave={() => save.mutate(r)} onRemove={() => remove(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Row({ row, onChange, onSave, onRemove }: any) {
  return (
    <tr className="border-t">
      <td className="px-2 py-1"><Input className="h-8" value={row.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Lisboa centro" /></td>
      <td className="px-2 py-1"><Input className="h-8" value={row.zip_from ?? ""} onChange={(e) => onChange({ zip_from: e.target.value })} placeholder="1000" maxLength={4} /></td>
      <td className="px-2 py-1"><Input className="h-8" value={row.zip_to ?? ""} onChange={(e) => onChange({ zip_to: e.target.value })} placeholder="1999" maxLength={4} /></td>
      <td className="px-2 py-1"><Input className="h-8" type="number" step="0.01" value={row.price ?? 0} onChange={(e) => onChange({ price: Number(e.target.value) })} /></td>
      <td className="px-2 py-1"><Switch checked={row.active ?? true} onCheckedChange={(v) => onChange({ active: v })} /></td>
      <td className="px-2 py-1">
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={onSave}><Save className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </td>
    </tr>
  );
}

function RegionRules() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["delivery_region_rules"],
    queryFn: async () =>
      (await supabase.from("delivery_region_rules").select("*").order("region")).data ?? [],
  });
  const [draft, setDraft] = useState<any[]>([]);
  const rows = [...(data ?? []), ...draft];

  const save = useMutation({
    mutationFn: async (row: any) => {
      const payload = {
        region: row.region,
        country: row.country || "PT",
        price: Number(row.price || 0),
        active: row.active ?? true,
      };
      if (row.id?.startsWith?.("new-")) {
        const { error } = await supabase.from("delivery_region_rules").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("delivery_region_rules").update(payload).eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Guardado");
      setDraft([]);
      qc.invalidateQueries({ queryKey: ["delivery_region_rules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = async (id: string) => {
    if (id.startsWith("new-")) {
      setDraft((d) => d.filter((x) => x.id !== id));
      return;
    }
    if (!confirm("Remover esta regra?")) return;
    await supabase.from("delivery_region_rules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["delivery_region_rules"] });
  };

  const update = (r: any, p: any) => {
    if (r.id.startsWith?.("new-")) {
      setDraft((d) => d.map((x) => x.id === r.id ? { ...x, ...p } : x));
    } else {
      Object.assign(r, p);
      qc.setQueryData(["delivery_region_rules"], (old: any[] = []) =>
        old.map((x) => (x.id === r.id ? { ...x, ...p } : x))
      );
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Usado como recurso quando o código postal do cliente não corresponde a nenhuma faixa. Compara com o campo "Distrito" do cliente.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDraft((d) => [...d, { id: `new-${Date.now()}`, region: "", country: "PT", price: 0, active: true }])
          }
        >
          <Plus className="h-4 w-4 mr-1" /> Nova região
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Distrito / Região</th>
              <th className="text-left px-3 py-2 w-24">País</th>
              <th className="text-left px-3 py-2 w-32">Preço</th>
              <th className="text-left px-3 py-2 w-24">Ativo</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Sem regras</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-2 py-1"><Input className="h-8" value={r.region ?? ""} onChange={(e) => update(r, { region: e.target.value })} placeholder="Lisboa" /></td>
                <td className="px-2 py-1"><Input className="h-8" value={r.country ?? "PT"} onChange={(e) => update(r, { country: e.target.value })} maxLength={2} /></td>
                <td className="px-2 py-1"><Input className="h-8" type="number" step="0.01" value={r.price ?? 0} onChange={(e) => update(r, { price: Number(e.target.value) })} /></td>
                <td className="px-2 py-1"><Switch checked={r.active ?? true} onCheckedChange={(v) => update(r, { active: v })} /></td>
                <td className="px-2 py-1">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => save.mutate(r)}><Save className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
