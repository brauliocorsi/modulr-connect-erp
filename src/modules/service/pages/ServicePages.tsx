import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";

// ---------- color helpers ----------
const COLORS = ["slate","sky","violet","amber","blue","green","rose","emerald","orange","cyan","pink","teal","indigo","yellow","red"] as const;
const colorClass = (c?: string) => {
  const m: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    violet: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    blue: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
    green: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
    emerald: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    orange: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
    cyan: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
    pink: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200",
    teal: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
    indigo: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
    yellow: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  };
  return m[c ?? "slate"] ?? m.slate;
};
const colorDot = (c?: string) => {
  const m: Record<string, string> = {
    slate: "bg-slate-400", sky: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400",
    blue: "bg-blue-500", green: "bg-green-500", rose: "bg-rose-500", emerald: "bg-emerald-500",
    orange: "bg-orange-500", cyan: "bg-cyan-500", pink: "bg-pink-500", teal: "bg-teal-500",
    indigo: "bg-indigo-500", yellow: "bg-yellow-400", red: "bg-red-500",
  };
  return m[c ?? "slate"] ?? m.slate;
};

const PRIORITY_TONES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  normal: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-900",
  urgent: "bg-rose-100 text-rose-900",
};
const PRIORITY_PT: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };

type SState = { id: string; key: string; label: string; color: string; sort_order: number; is_default: boolean; is_closed: boolean };
type SR = {
  id: string; name: string; state: string; priority: string; created_at: string;
  partners: { name: string } | null;
  products: { name: string } | null;
  stock_pickings: { name: string; origin: string | null } | null;
};

const useStates = () => useQuery({
  queryKey: ["service_states"],
  queryFn: async () => {
    const { data, error } = await supabase.from("service_states" as any).select("*").order("sort_order");
    if (error) throw error;
    return (data ?? []) as unknown as SState[];
  },
});

const useRequests = () => useQuery({
  queryKey: ["service_requests_all"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("service_requests")
      .select("id, name, state, priority, created_at, partners(name), products(name), stock_pickings(name, origin)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as unknown as SR[];
  },
});

// ---------- List view ----------
function ListTab() {
  const { data: requests = [], isLoading } = useRequests();
  const { data: states = [] } = useStates();
  const stateMap = useMemo(() => Object.fromEntries(states.map(s => [s.key, s])), [states]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>;
  if (!requests.length) return <EmptyState title="Sem pedidos" description="Nenhum pedido de assistência." />;

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-[110px]" />
          <col />
          <col />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[100px]" />
          <col className="w-[130px]" />
          <col className="w-[160px]" />
        </colgroup>
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Nº</th>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Produto</th>
            <th className="px-3 py-2 font-medium">Entrega</th>
            <th className="px-3 py-2 font-medium">Venda</th>
            <th className="px-3 py-2 font-medium">Prioridade</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Aberto em</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const s = stateMap[r.state];
            return (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs"><Link to={`/service/requests/${r.id}`} className="hover:underline">{r.name}</Link></td>
                <td className="px-3 py-2 truncate">{r.partners?.name ?? "—"}</td>
                <td className="px-3 py-2 truncate">{r.products?.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs truncate">{r.stock_pickings?.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs truncate">{r.stock_pickings?.origin ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + (PRIORITY_TONES[r.priority] ?? "bg-muted")}>
                    {PRIORITY_PT[r.priority] ?? r.priority}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + colorClass(s?.color)}>
                    {s?.label ?? r.state}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-PT")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Kanban view ----------
function KanbanTab() {
  const qc = useQueryClient();
  const { data: requests = [] } = useRequests();
  const { data: states = [] } = useStates();
  const [dragId, setDragId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, SR[]> = {};
    states.forEach(s => g[s.key] = []);
    requests.forEach(r => { (g[r.state] ??= []).push(r); });
    return g;
  }, [states, requests]);

  const moveTo = async (id: string, key: string) => {
    const { error } = await supabase.from("service_requests").update({ state: key }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Estado atualizado");
    qc.invalidateQueries({ queryKey: ["service_requests_all"] });
  };

  if (!states.length) return <div className="text-sm text-muted-foreground">Crie estados na aba "Estados" primeiro.</div>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {states.map(s => (
        <div
          key={s.id}
          className="min-w-[280px] w-[280px] bg-muted/30 rounded-lg border flex flex-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragId) { moveTo(dragId, s.key); setDragId(null); } }}
        >
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={"h-2 w-2 rounded-full " + colorDot(s.color)} />
              <span className="font-medium text-sm">{s.label}</span>
            </div>
            <span className="text-xs text-muted-foreground">{grouped[s.key]?.length ?? 0}</span>
          </div>
          <div className="p-2 space-y-2 flex-1">
            {(grouped[s.key] ?? []).map(r => (
              <Link
                key={r.id}
                to={`/service/requests/${r.id}`}
                draggable
                onDragStart={() => setDragId(r.id)}
                onDragEnd={() => setDragId(null)}
                className="block bg-card border rounded-md p-2 text-xs hover:shadow-sm cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono">{r.name}</span>
                  <span className={"px-1.5 py-0.5 rounded-full text-[10px] " + (PRIORITY_TONES[r.priority] ?? "bg-muted")}>
                    {PRIORITY_PT[r.priority] ?? r.priority}
                  </span>
                </div>
                <div className="font-medium truncate">{r.partners?.name ?? "—"}</div>
                <div className="text-muted-foreground truncate">{r.products?.name ?? "—"}</div>
                {r.stock_pickings?.name && (
                  <div className="text-muted-foreground font-mono text-[10px] mt-1">📦 {r.stock_pickings.name}</div>
                )}
              </Link>
            ))}
            {(grouped[s.key]?.length ?? 0) === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">— vazio —</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- States management ----------
function StatesTab() {
  const qc = useQueryClient();
  const { data: states = [] } = useStates();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Partial<SState> | null>(null);

  const openNew = () => { setEdit({ key: "", label: "", color: "slate", sort_order: (states.at(-1)?.sort_order ?? 0) + 10, is_default: false, is_closed: false }); setOpen(true); };
  const openEdit = (s: SState) => { setEdit({ ...s }); setOpen(true); };

  const save = async () => {
    if (!edit?.key || !edit?.label) return toast.error("Preencha chave e nome");
    const payload = { key: edit.key.trim().toLowerCase().replace(/\s+/g, "_"), label: edit.label, color: edit.color ?? "slate", sort_order: edit.sort_order ?? 0, is_default: !!edit.is_default, is_closed: !!edit.is_closed };
    if (edit.is_default) {
      await supabase.from("service_states" as any).update({ is_default: false }).neq("id", edit.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const { error } = edit.id
      ? await supabase.from("service_states" as any).update(payload).eq("id", edit.id)
      : await supabase.from("service_states" as any).insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Estado salvo");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["service_states"] });
  };

  const remove = async (s: SState) => {
    if (!confirm(`Excluir estado "${s.label}"?`)) return;
    const { error } = await supabase.from("service_states" as any).delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["service_states"] });
  };

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Novo estado</Button>
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-12"></th>
              <th className="px-3 py-2 font-medium">Chave</th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Cor</th>
              <th className="px-3 py-2 font-medium w-20">Ordem</th>
              <th className="px-3 py-2 font-medium w-20">Padrão</th>
              <th className="px-3 py-2 font-medium w-20">Fechado</th>
              <th className="px-3 py-2 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody>
            {states.map(s => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2 text-muted-foreground"><GripVertical className="h-4 w-4" /></td>
                <td className="px-3 py-2 font-mono text-xs">{s.key}</td>
                <td className="px-3 py-2">
                  <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + colorClass(s.color)}>{s.label}</span>
                </td>
                <td className="px-3 py-2"><div className="flex items-center gap-2"><span className={"h-3 w-3 rounded-full " + colorDot(s.color)} /><span className="text-xs">{s.color}</span></div></td>
                <td className="px-3 py-2 text-xs">{s.sort_order}</td>
                <td className="px-3 py-2 text-xs">{s.is_default ? "Sim" : "—"}</td>
                <td className="px-3 py-2 text-xs">{s.is_closed ? "Sim" : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar estado" : "Novo estado"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Chave (técnica)</Label>
              <Input value={edit?.key ?? ""} disabled={!!edit?.id} onChange={(e) => setEdit({ ...edit!, key: e.target.value })} placeholder="ex: aguarda_peca" />
            </div>
            <div className="space-y-1">
              <Label>Nome visível</Label>
              <Input value={edit?.label ?? ""} onChange={(e) => setEdit({ ...edit!, label: e.target.value })} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setEdit({ ...edit!, color: c })}
                    className={"px-2 py-1 rounded-md text-xs flex items-center gap-1 border " + (edit?.color === c ? "ring-2 ring-ring" : "")}>
                    <span className={"h-3 w-3 rounded-full " + colorDot(c)} />{c}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Ordem</Label>
              <Input type="number" value={edit?.sort_order ?? 0} onChange={(e) => setEdit({ ...edit!, sort_order: Number(e.target.value) })} />
            </div>
            <div className="flex items-center gap-2 pt-6"><Switch checked={!!edit?.is_default} onCheckedChange={(v) => setEdit({ ...edit!, is_default: v })} /><Label>Estado inicial padrão</Label></div>
            <div className="flex items-center gap-2"><Switch checked={!!edit?.is_closed} onCheckedChange={(v) => setEdit({ ...edit!, is_closed: v })} /><Label>Estado de fecho</Label></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Page ----------
export const ServiceRequestsList = () => {
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Pedidos de Assistência" breadcrumb={[{ label: "Assistência" }]} actions={
        <Button size="sm" onClick={() => nav("/service/requests/new")}><Plus className="h-4 w-4 mr-1" /> Novo</Button>
      } />
      <PageBody>
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="states">Estados</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-3"><ListTab /></TabsContent>
          <TabsContent value="kanban" className="mt-3"><KanbanTab /></TabsContent>
          <TabsContent value="states" className="mt-3"><StatesTab /></TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
};

// ---------- Form ----------
function LinkedRefs({ id }: { id: string }) {
  const [info, setInfo] = useState<any>(null);
  const { data: states = [] } = useStates();
  const stateMap = useMemo(() => Object.fromEntries(states.map(s => [s.key, s])), [states]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("service_requests")
        .select("state, priority, picking_id, stock_pickings(id, name, origin), partners(name)")
        .eq("id", id)
        .maybeSingle();
      setInfo(data);
    })();
  }, [id]);
  if (!info) return null;
  const s = stateMap[info.state];
  return (
    <Card className="p-4 max-w-3xl mb-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Estado:</span>
        <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + colorClass(s?.color)}>{s?.label ?? info.state}</span>
      </div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Prioridade:</span>
        <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + (PRIORITY_TONES[info.priority] ?? "bg-muted")}>{PRIORITY_PT[info.priority] ?? info.priority}</span>
      </div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Cliente:</span><span className="text-xs">{info.partners?.name ?? "—"}</span></div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Entrega:</span><span className="font-mono text-xs">{info.stock_pickings?.name ?? "—"}</span></div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Venda:</span><span className="font-mono text-xs">{info.stock_pickings?.origin ?? "—"}</span></div>
    </Card>
  );
}

export const ServiceRequestForm = () => {
  const { id } = useParams();
  const { data: states = [] } = useStates();
  const stateOptions = states.map(s => ({ value: s.key, label: s.label }));
  return (
    <>
      {id && id !== "new" && <div className="px-6 pt-4"><LinkedRefs id={id} /></div>}
      <SimpleForm
        table="service_requests"
        title="Pedido de Assistência"
        basePath="/service/requests"
        breadcrumb={[{ label: "Assistência", to: "/service/requests" }, { label: "Pedido" }]}
        fields={[
          { name: "name", label: "Nº", required: true },
          { name: "partner_id", label: "Cliente ID" },
          { name: "product_id", label: "Produto ID" },
          { name: "priority", label: "Prioridade", type: "select", options: [
            { value: "low", label: "Baixa" }, { value: "normal", label: "Normal" },
            { value: "high", label: "Alta" }, { value: "urgent", label: "Urgente" },
          ]},
          { name: "state", label: "Estado", type: "select", options: stateOptions.length ? stateOptions : [{ value: "new", label: "Novo" }] },
          { name: "assigned_to", label: "Responsável (user id)" },
          { name: "scheduled_for", label: "Agendado para", type: "date" },
          { name: "description", label: "Descrição do problema", type: "textarea" },
          { name: "resolution", label: "Resolução / notas internas", type: "textarea" },
        ]}
      />
    </>
  );
};
