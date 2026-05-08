import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { RefreshCw, Plus, Trash2 } from "lucide-react";
import { stateLabel } from "@/lib/picking";
import { toast } from "sonner";

const STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-destructive/10 text-destructive",
};

type LineDraft = { product_id: string | null; quantity: number };

function NewInternalDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>("");
  const [dest, setDest] = useState<string>("");
  const [lines, setLines] = useState<LineDraft[]>([{ product_id: null, quantity: 1 }]);
  const [saving, setSaving] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ["locations-internal"],
    queryFn: async () => (await supabase.from("stock_locations").select("id,name,full_path,type,warehouse_id").eq("type","internal").order("full_path")).data ?? [],
    enabled: open,
  });
  const { data: products } = useQuery({
    queryKey: ["products-min-int"],
    queryFn: async () => (await supabase.from("products").select("id,name,uom_id, product_uom!products_uom_id_fkey(category)").order("name")).data ?? [],
    enabled: open,
  });

  const addLine = () => setLines((l) => [...l, { product_id: null, quantity: 1 }]);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((l) => l.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!source || !dest) return toast.error("Origem e destino obrigatórios");
    if (source === dest) return toast.error("Origem e destino têm de ser diferentes");
    const valid = lines.filter((l) => l.product_id && l.quantity > 0);
    if (!valid.length) return toast.error("Adicionar pelo menos uma linha");
    setSaving(true);
    const { data, error } = await supabase.rpc("create_internal_transfer", {
      _source: source,
      _destination: dest,
      _lines: valid.map((l) => {
        const p = products?.find((x: any) => x.id === l.product_id);
        return { product_id: l.product_id, quantity: l.quantity, uom_id: p?.uom_id ?? null };
      }) as any,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Transferência criada");
    setOpen(false);
    setLines([{ product_id: null, quantity: 1 }]);
    setSource(""); setDest("");
    if (data) onCreated(data as string);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova transferência</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Nova transferência interna</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origem</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue placeholder="Localização origem…" /></SelectTrigger>
                <SelectContent>{(locations ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.full_path ?? l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Destino</Label>
              <Select value={dest} onValueChange={setDest}>
                <SelectTrigger><SelectValue placeholder="Localização destino…" /></SelectTrigger>
                <SelectContent>{(locations ?? []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.full_path ?? l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Linhas</Label>
              <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const p = products?.find((x: any) => x.id === l.product_id);
                const isInt = !p?.product_uom?.category || p.product_uom.category === "unit";
                return (
                  <div key={i} className="grid grid-cols-[1fr_120px_36px] gap-2 items-center">
                    <Select value={l.product_id ?? ""} onValueChange={(v) => setLine(i, { product_id: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Produto…" /></SelectTrigger>
                      <SelectContent>{(products ?? []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={0} step={isInt ? 1 : 0.01} value={l.quantity}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setLine(i, { quantity: isInt ? Math.max(0, Math.floor(v)) : v });
                      }} />
                    <Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Criando…" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InternalTransfersPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["internal-transfers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,done_at,origin, source:source_location_id(name,full_path,warehouse_id), dest:destination_location_id(name,full_path,warehouse_id)")
        .eq("kind", "internal")
        .order("scheduled_at", { ascending: false })
        .limit(500);
      return (data ?? []) as any[];
    },
  });
  const all = data ?? [];
  const within = all.filter((r) => r.source?.warehouse_id && r.dest?.warehouse_id && r.source.warehouse_id === r.dest.warehouse_id);
  const cross = all.filter((r) => r.source?.warehouse_id && r.dest?.warehouse_id && r.source.warehouse_id !== r.dest.warehouse_id);

  const Table = ({ rows }: { rows: any[] }) => (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Referência</th>
              <th className="text-left px-3 py-2">Origem</th>
              <th className="text-left px-3 py-2">Destino</th>
              <th className="text-left px-3 py-2">Programado</th>
              <th className="text-left px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Sem transferências</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />{r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs">{r.source?.full_path ?? r.source?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.dest?.full_path ?? r.dest?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${STATE_TONE[r.state] ?? ""}`}>{stateLabel(r.state)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Transferências internas"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências internas" }]}
        actions={<NewInternalDialog onCreated={(id) => { qc.invalidateQueries({ queryKey: ["internal-transfers"] }); nav(`/inventory/transfers/${id}`); }} />}
      />
      <PageBody>
        <Tabs defaultValue="within">
          <TabsList>
            <TabsTrigger value="within">Dentro do armazém <Badge variant="secondary" className="ml-2">{within.length}</Badge></TabsTrigger>
            <TabsTrigger value="cross">Entre armazéns <Badge variant="secondary" className="ml-2">{cross.length}</Badge></TabsTrigger>
            <TabsTrigger value="all">Todas <Badge variant="secondary" className="ml-2">{all.length}</Badge></TabsTrigger>
          </TabsList>
          <TabsContent value="within" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={within} />}</TabsContent>
          <TabsContent value="cross" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={cross} />}</TabsContent>
          <TabsContent value="all" className="mt-4">{isLoading ? <div className="p-4 text-muted-foreground">Carregando…</div> : <Table rows={all} />}</TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
