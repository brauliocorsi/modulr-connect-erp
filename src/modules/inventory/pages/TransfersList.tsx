import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AdvancedFilters, FilterValues } from "@/core/filters/AdvancedFilters";
import { StateBadge } from "@/core/layout/StateBadge";
import { AlertTriangle, CheckCircle2, Clock, Layers, PackageCheck, Search, Truck, ChevronDown, ChevronUp } from "lucide-react";
import { kindLabel } from "@/lib/picking";
import { toast } from "sonner";

export default function TransfersList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: "created_at", asc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });
  const { data: batches } = useQuery({
    queryKey: ["batches-min"],
    queryFn: async () => (await supabase.from("stock_picking_batches").select("id,name").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["transfers-list", q, filters, sort],
    queryFn: async () => {
      let query: any = supabase
        .from("stock_pickings")
        .select("id,name,kind,state,scheduled_at,created_at,step_label,batch_id,warehouse_id,origin,partners(name)")
        .order(sort.key, { ascending: sort.asc })
        .limit(500);
      if (q) query = query.ilike("name", `%${q}%`);
      if (filters.kind) query = query.eq("kind", filters.kind);
      if (filters.state) query = query.eq("state", filters.state);
      if (filters.warehouse_id) query = query.eq("warehouse_id", filters.warehouse_id);
      if (filters.batch_id) query = query.eq("batch_id", filters.batch_id);
      if (filters.step) query = query.ilike("step_label", `%${filters.step}%`);
      if (filters.from) query = query.gte("scheduled_at", filters.from);
      if (filters.to) query = query.lte("scheduled_at", filters.to + "T23:59:59");
      if (filters.origin) query = query.ilike("origin", `%${filters.origin}%`);
      const { data } = await query;

      // optional product filter via stock_moves
      if (filters.product_search && data?.length) {
        const ids = data.map((r: any) => r.id);
        const { data: mv } = await supabase
          .from("stock_moves")
          .select("picking_id, products!inner(name)")
          .in("picking_id", ids)
          .ilike("products.name", `%${filters.product_search}%`);
        const ok = new Set((mv ?? []).map((m: any) => m.picking_id));
        return (data ?? []).filter((r: any) => ok.has(r.id));
      }
      return data ?? [];
    },
  });

  const visibleRows = useMemo(() => {
    const priority: Record<string, number> = { waiting: 0, draft: 1, ready: 2, done: 3, cancelled: 4 };
    return [...rows].sort((a: any, b: any) => {
      const pa = priority[a.state] ?? 9;
      const pb = priority[b.state] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [rows]);

  const flowStats = useMemo(() => {
    const active = rows.filter((r: any) => !["done", "cancelled"].includes(r.state));
    const waiting = active.filter((r: any) => r.state === "waiting").length;
    const ready = active.filter((r: any) => r.state === "ready").length;
    const dock = active.filter((r: any) => (r.step_label ?? "").toLowerCase().includes("cais")).length;
    const van = active.filter((r: any) => (r.step_label ?? "").toLowerCase().includes("carrinha")).length;
    return { active: active.length, waiting, ready, dock, van };
  }, [rows]);

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((p) => p.size === visibleRows.length ? new Set() : new Set(visibleRows.map((r: any) => r.id)));

  const createBatch = async () => {
    if (selected.size === 0) return;
    const { data, error } = await supabase.rpc("create_batch", { _pickings: Array.from(selected) });
    if (error) return toast.error(error.message);
    toast.success("Lote criado");
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["transfers-list"] });
    nav(`/inventory/batches/${data}`);
  };

  const SortHead = ({ k, label }: { k: string; label: string }) => (
    <th
      onClick={() => setSort((s) => s.key === k ? { key: k, asc: !s.asc } : { key: k, asc: true })}
      className="text-left px-3 py-2 cursor-pointer hover:bg-muted select-none"
    >
      <span className="inline-flex items-center gap-1">{label}{sort.key === k && (sort.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
    </th>
  );

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
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar referência…" className="max-w-sm" />
          </div>
          <AdvancedFilters
            onChange={setFilters}
            fields={[
              { key: "kind", label: "Tipo", type: "select", options: [
                { value: "incoming", label: "Entrada" }, { value: "outgoing", label: "Saída" }, { value: "internal", label: "Interna" },
              ]},
              { key: "state", label: "Estado", type: "select", options: [
                { value: "draft", label: "Rascunho" }, { value: "waiting", label: "A aguardar" },
                { value: "ready", label: "Pronto" }, { value: "done", label: "Concluído" }, { value: "cancelled", label: "Cancelado" },
              ]},
              { key: "warehouse_id", label: "Armazém", type: "select", options: (warehouses ?? []).map((w: any) => ({ value: w.id, label: w.name })) },
              { key: "step", label: "Etapa (texto)", type: "text" },
              { key: "batch_id", label: "Lote", type: "select", options: (batches ?? []).map((b: any) => ({ value: b.id, label: b.name })) },
              { key: "from", label: "Programado de", type: "date" },
              { key: "to", label: "Programado até", type: "date" },
              { key: "origin", label: "Origem doc", type: "text" },
              { key: "product_search", label: "Produto contém", type: "text" },
            ]}
          />
        </Card>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="w-10 px-3 py-2"><Checkbox checked={selected.size > 0 && selected.size === rows.length} onCheckedChange={toggleAll} /></th>
                <SortHead k="name" label="Referência" />
                <SortHead k="kind" label="Tipo" />
                <th className="text-left px-3 py-2">Etapa</th>
                <th className="text-left px-3 py-2">Parceiro</th>
                <SortHead k="state" label="Estado" />
                <th className="text-left px-3 py-2">Lote</th>
                <SortHead k="scheduled_at" label="Programado" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-accent/30">
                  <td className="px-3 py-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-2"><Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline font-medium">{r.name}</Link></td>
                  <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2">{r.step_label ? <Badge variant="outline">{r.step_label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2">{r.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2"><StateBadge value={r.state} /></td>
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
