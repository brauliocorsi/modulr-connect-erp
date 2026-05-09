import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers, Search } from "lucide-react";
import { stateLabel, kindLabel } from "@/lib/picking";
import { toast } from "sonner";

export default function TransfersList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: rows = [] } = useQuery({
    queryKey: ["transfers-list", q],
    queryFn: async () => {
      let query = supabase
        .from("stock_pickings")
        .select("id,name,kind,state,scheduled_at,step_label,batch_id,partners(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (q) query = query.ilike("name", `%${q}%`);
      const { data } = await query;
      return data ?? [];
    },
  });

  const toggle = (id: string) => {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const createBatch = async () => {
    if (selected.size === 0) return;
    const { data, error } = await supabase.rpc("create_batch", { _pickings: Array.from(selected) });
    if (error) return toast.error(error.message);
    toast.success("Lote criado");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["transfers-list"] });
    nav(`/inventory/batches/${data}`);
  };

  return (
    <>
      <PageHeader
        title="Transferências"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências" }]}
        actions={
          <Button size="sm" onClick={createBatch} disabled={selected.size === 0}>
            <Layers className="h-4 w-4 mr-1" /> Criar lote ({selected.size})
          </Button>
        }
      />
      <PageBody>
        <Card className="p-3 mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar referência…" className="max-w-sm" />
        </Card>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="text-left px-3 py-2">Referência</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Etapa</th>
                <th className="text-left px-3 py-2">Parceiro</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Lote</th>
                <th className="text-left px-3 py-2">Programado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-accent/30">
                  <td className="px-3 py-2">
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline font-medium">{r.name}</Link>
                  </td>
                  <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2">{r.step_label ? <Badge variant="outline">{r.step_label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2">{r.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2"><span className="o-state-badge">{stateLabel(r.state)}</span></td>
                  <td className="px-3 py-2">{r.batch_id ? <Link to={`/inventory/batches/${r.batch_id}`} className="text-primary hover:underline">Ver</Link> : "—"}</td>
                  <td className="px-3 py-2">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Sem transferências</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
