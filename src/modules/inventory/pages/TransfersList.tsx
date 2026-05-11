import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdvancedFilters, FilterValues } from "@/core/filters/AdvancedFilters";
import { StateBadge } from "@/core/layout/StateBadge";
import { AlertTriangle, CheckCircle2, Clock, Layers, PackageCheck, Search, Truck, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { kindLabel } from "@/lib/picking";
import { groupByOrigin, readToggle, writeToggle, type Group } from "@/modules/inventory/lib/groupChain";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function TransfersList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: "created_at", asc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupMode, setGroupMode] = useState<boolean>(() => readToggle("transfers-group-by-origin", true));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { writeToggle("transfers-group-by-origin", groupMode); }, [groupMode]);
  const toggleExpand = (key: string) => setExpanded((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });
  const { data: batches } = useQuery({
    queryKey: ["batches-min"],
    queryFn: async () => (await supabase.from("stock_picking_batches").select("id,name").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });
  const { data: carriers } = useQuery({
    queryKey: ["carriers-min"],
    queryFn: async () => (await supabase.from("delivery_carriers").select("id,name").eq("active", true).order("name")).data ?? [],
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["transfers-list", q, filters, sort, groupMode],
    queryFn: async () => {
      let query: any = supabase
        .from("stock_pickings")
        .select("id,name,kind,state,scheduled_at,created_at,done_at,step_label,batch_id,warehouse_id,origin,source_location_id,destination_location_id,reschedule_count,tracking_ref,partners(name),vehicles(name,license_plate),delivery_carriers(name)")
        .order(sort.key, { ascending: sort.asc })
        .limit(1000);
      if (q) query = query.ilike("name", `%${q}%`);
      if (filters.kind) query = query.eq("kind", filters.kind);
      // When grouping, state filter is applied to the consolidated state client-side so we keep all chain steps.
      if (filters.state && !groupMode) query = query.eq("state", filters.state);
      if (filters.warehouse_id) query = query.eq("warehouse_id", filters.warehouse_id);
      if (filters.batch_id) query = query.eq("batch_id", filters.batch_id);
      if (filters.carrier_id) query = query.eq("carrier_id", filters.carrier_id);
      if (filters.tracking_ref) query = query.ilike("tracking_ref", `%${filters.tracking_ref}%`);
      if (filters.step) query = query.ilike("step_label", `%${filters.step}%`);
      if (filters.from) query = query.gte("scheduled_at", filters.from);
      if (filters.to) query = query.lte("scheduled_at", filters.to + "T23:59:59");
      if (filters.done_from) query = query.gte("done_at", filters.done_from);
      if (filters.done_to) query = query.lte("done_at", filters.done_to + "T23:59:59");
      if (filters.origin) query = query.ilike("origin", `%${filters.origin}%`);
      const { data } = await query;

      let result = data ?? [];

      // optional partner filter (post-fetch since partner is joined)
      if (filters.partner_search) {
        const needle = filters.partner_search.toLowerCase();
        result = result.filter((r: any) => (r.partners?.name ?? "").toLowerCase().includes(needle));
      }

      // optional product filter via stock_moves
      if (filters.product_search && result.length) {
        const ids = result.map((r: any) => r.id);
        const { data: mv } = await supabase
          .from("stock_moves")
          .select("picking_id, products!inner(name)")
          .in("picking_id", ids)
          .ilike("products.name", `%${filters.product_search}%`);
        const ok = new Set((mv ?? []).map((m: any) => m.picking_id));
        result = result.filter((r: any) => ok.has(r.id));
      }
      return result;
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

  const grouped = useMemo(() => {
    if (!groupMode) return { groups: [] as Group<any>[], singletons: visibleRows as any[] };
    const { groups, singletons } = groupByOrigin(rows as any[]);
    // Apply state filter against consolidated state when grouping
    const stFilter = filters.state;
    const fGroups = stFilter ? groups.filter((g) => g.state === stFilter) : groups;
    const fSing = stFilter ? singletons.filter((s: any) => s.state === stFilter) : singletons;
    return { groups: fGroups, singletons: fSing };
  }, [rows, visibleRows, groupMode, filters.state]);

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
        <div className="grid gap-3 md:grid-cols-4 mb-3">
          <Card className="p-3 border-l-4 border-l-warning">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="o-section-title">Bloqueadas</div>
                <div className="text-2xl font-semibold">{flowStats.waiting}</div>
              </div>
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">A aguardar stock ou etapa anterior</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-success">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="o-section-title">Prontas</div>
                <div className="text-2xl font-semibold">{flowStats.ready}</div>
              </div>
              <PackageCheck className="h-5 w-5 text-success" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Disponíveis para validar agora</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-info">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="o-section-title">No cais</div>
                <div className="text-2xl font-semibold">{flowStats.dock}</div>
              </div>
              <Clock className="h-5 w-5 text-info" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Separação e carga em progresso</p>
          </Card>
          <Card className="p-3 border-l-4 border-l-primary">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="o-section-title">Carrinha/Entrega</div>
                <div className="text-2xl font-semibold">{flowStats.van}</div>
              </div>
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Carregamento ou entrega final</p>
          </Card>
        </div>
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar referência…" className="max-w-sm" />
          </div>
          <AdvancedFilters
            onChange={setFilters}
            storageKey="transfers-list"
            defaults={{ state: "ready" }}
            fields={[
              { key: "state", label: "Estado", type: "select", options: [
                { value: "draft", label: "Rascunho" }, { value: "waiting", label: "A aguardar" },
                { value: "ready", label: "Pronto" }, { value: "done", label: "Concluído" }, { value: "cancelled", label: "Cancelado" },
              ]},
              { key: "kind", label: "Tipo de operação", type: "select", options: [
                { value: "incoming", label: "Entrada" }, { value: "outgoing", label: "Saída" }, { value: "internal", label: "Interna" },
              ]},
              { key: "warehouse_id", label: "Armazém", type: "select", options: (warehouses ?? []).map((w: any) => ({ value: w.id, label: w.name })) },
              { key: "step", label: "Etapa (texto)", type: "text" },
              { key: "batch_id", label: "Lote", type: "select", options: (batches ?? []).map((b: any) => ({ value: b.id, label: b.name })) },
              { key: "carrier_id", label: "Transportadora", type: "select", options: (carriers ?? []).map((c: any) => ({ value: c.id, label: c.name })) },
              { key: "from", label: "Programado de", type: "date" },
              { key: "to", label: "Programado até", type: "date" },
              { key: "done_from", label: "Entregue de", type: "date" },
              { key: "done_to", label: "Entregue até", type: "date" },
              { key: "origin", label: "Documento origem", type: "text" },
              { key: "tracking_ref", label: "Tracking", type: "text" },
              { key: "partner_search", label: "Parceiro contém", type: "text" },
              { key: "product_search", label: "Produto contém", type: "text" },
            ]}
          />
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Switch id="group-origin" checked={groupMode} onCheckedChange={setGroupMode} />
            <Label htmlFor="group-origin" className="cursor-pointer">Agrupar por origem (SO/PO)</Label>
          </div>
        </Card>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                 <th className="w-10 px-3 py-2"><Checkbox checked={selected.size > 0 && selected.size === visibleRows.length} onCheckedChange={toggleAll} /></th>
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
              {(() => {
                const renderRow = (r: any, opts?: { indent?: boolean; stepIdx?: number; stepTotal?: number }) => (
                  <tr key={r.id} className={`border-t hover:bg-accent/30 ${r.state === "waiting" ? "bg-warning/10 border-l-4 border-l-warning" : r.state === "ready" ? "bg-success/10 border-l-4 border-l-success" : ""}`}>
                    <td className="px-3 py-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></td>
                    <td className="px-3 py-2" style={opts?.indent ? { paddingLeft: 36 } : undefined}>
                      <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline font-medium">
                        {opts?.indent ? "↳ " : ""}{r.name}
                      </Link>
                      {opts?.stepIdx ? <span className="text-[10px] text-muted-foreground ml-2">Etapa {opts.stepIdx}/{opts.stepTotal}</span> : null}
                    </td>
                    <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-1 items-center">
                          {r.step_label ? <Badge variant="outline" className="w-fit">{r.step_label}</Badge> : <span className="text-muted-foreground">—</span>}
                          {r.reschedule_count > 0 && <Badge variant="secondary" className="bg-orange-200 text-orange-900 text-[10px]">🔄 {r.reschedule_count}x</Badge>}
                          {r.vehicles && <Badge variant="secondary" className="text-[10px]"><Truck className="h-3 w-3 mr-1" />{r.vehicles.name}</Badge>}
                          {r.delivery_carriers && <Badge variant="secondary" className="text-[10px]">📦 {r.delivery_carriers.name}</Badge>}
                        </div>
                        {r.origin && !opts?.indent && <span className="text-xs text-muted-foreground">Doc: {r.origin}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.partners?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {r.state === "ready" && <CheckCircle2 className="h-4 w-4 text-success" />}
                        {r.state === "waiting" && <AlertTriangle className="h-4 w-4 text-warning" />}
                        <StateBadge value={r.state} />
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.batch_id ? <Link to={`/inventory/batches/${r.batch_id}`} className="text-primary hover:underline">Ver</Link> : "—"}</td>
                    <td className="px-3 py-2">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                  </tr>
                );

                if (!groupMode) {
                  if (visibleRows.length === 0) {
                    return <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Sem transferências</td></tr>;
                  }
                  return visibleRows.map((r: any) => renderRow(r));
                }

                const { groups, singletons } = grouped;
                if (groups.length === 0 && singletons.length === 0) {
                  return <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Sem transferências</td></tr>;
                }
                const out: JSX.Element[] = [];
                for (const g of groups) {
                  const isOpen = expanded.has(g.origin);
                  out.push(
                    <tr key={`g-${g.origin}`} className={`border-t bg-muted/20 hover:bg-accent/30 cursor-pointer ${g.state === "ready" ? "border-l-4 border-l-success" : g.state === "waiting" ? "border-l-4 border-l-warning" : ""}`} onClick={() => toggleExpand(g.origin)}>
                      <td className="px-3 py-2">
                        <button className="text-muted-foreground" onClick={(e) => { e.stopPropagation(); toggleExpand(g.origin); }}>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-semibold">{g.origin}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">Cadeia · {g.totalSteps} etapas</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{g.currentStep ? `Etapa ${g.currentStep}/${g.totalSteps}` : "Concluído"}</Badge>
                      </td>
                      <td className="px-3 py-2">{g.partner ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {g.state === "ready" && <CheckCircle2 className="h-4 w-4 text-success" />}
                          {g.state === "waiting" && <AlertTriangle className="h-4 w-4 text-warning" />}
                          <StateBadge value={g.state} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
                      <td className="px-3 py-2 text-xs">{g.scheduledAt ? new Date(g.scheduledAt).toLocaleString("pt-PT") : "—"}</td>
                    </tr>
                  );
                  if (isOpen) {
                    g.steps.forEach((s: any, idx: number) => {
                      out.push(renderRow(s, { indent: true, stepIdx: idx + 1, stepTotal: g.totalSteps }));
                    });
                  }
                }
                for (const r of singletons) out.push(renderRow(r));
                return out;
              })()}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
