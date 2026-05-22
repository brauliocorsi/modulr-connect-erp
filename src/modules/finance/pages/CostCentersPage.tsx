import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Archive } from "lucide-react";
import { toast } from "sonner";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  ConfirmActionDialog,
  OperationalSearchInput,
} from "@/core/operational";

type Row = { id: string; code: string; name: string; parent_id: string | null; active: boolean };

export default function CostCentersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Row> | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("cost_centers")
      .select("id,code,name,parent_id,active")
      .order("code");
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
  }, [rows, q]);

  const parentMap = useMemo(() => new Map(rows.map((r) => [r.id, `${r.code} · ${r.name}`])), [rows]);

  const save = async () => {
    if (!editing) return;
    if (!editing.code || !editing.name) return toast.error("Código e nome são obrigatórios");
    setSaving(true);
    const { data, error } = await supabase.rpc("cost_center_upsert", {
      _payload: {
        id: editing.id ?? null,
        code: editing.code,
        name: editing.name,
        parent_id: editing.parent_id ?? null,
        active: editing.active ?? true,
      } as any,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    const res: any = data;
    if (res?.error) return toast.error(res.error);
    toast.success(editing.id ? "Centro de custo atualizado" : "Centro de custo criado");
    setEditing(null);
    load();
  };

  const archive = async (row: Row) => {
    setSaving(true);
    const { error } = await supabase.rpc("cost_center_archive", { _id: row.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Centro de custo arquivado");
    setArchiveTarget(null);
    load();
  };

  return (
    <>
      <PageHeader
        title="Centros de Custo"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Centros de Custo" }]}
        actions={
          <Button size="sm" onClick={() => setEditing({ active: true })}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        }
      />
      <PageBody>
        <div className="mb-3 max-w-sm">
          <OperationalSearchInput value={q} onChange={setQ} placeholder="Procurar por código ou nome…" />
        </div>
        <OperationalDataTable
          isLoading={loading}
          rows={filtered}
          getRowId={(r) => r.id}
          emptyTitle="Sem centros de custo"
          columns={[
            { key: "code", header: "Código", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { key: "name", header: "Nome", cell: (r) => r.name },
            { key: "parent", header: "Pai", cell: (r) => (r.parent_id ? parentMap.get(r.parent_id) ?? "—" : <span className="text-muted-foreground">—</span>) },
            { key: "active", header: "Estado", cell: (r) => (
              <OperationalStatusBadge domain="finance" status={r.active ? "open" : "archived"} />
            ) },
            { key: "actions", header: "", align: "right", cell: (r) => (
              <div className="flex gap-1 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                {r.active && (
                  <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(r)} title="Arquivar"><Archive className="h-4 w-4 text-destructive" /></Button>
                )}
              </div>
            ) },
          ]}
        />
      </PageBody>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar centro de custo" : "Novo centro de custo"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div><Label>Código</Label><Input value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><Label>Nome</Label><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div>
                <Label>Pai</Label>
                <Select value={editing.parent_id ?? ""} onValueChange={(v) => setEditing({ ...editing, parent_id: v || null })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {rows.filter((r) => r.id !== editing.id && r.active).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.code} · {r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                <Label>Ativo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!archiveTarget}
        onOpenChange={(v) => { if (!v) setArchiveTarget(null); }}
        title="Arquivar centro de custo"
        description={archiveTarget ? `Arquivar ${archiveTarget.code} · ${archiveTarget.name}? Não será removido fisicamente.` : ""}
        confirmLabel="Arquivar"
        destructive
        loading={saving}
        onConfirm={() => { if (archiveTarget) void archive(archiveTarget); }}
      />
    </>
  );
}
