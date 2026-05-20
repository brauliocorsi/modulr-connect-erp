import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Archive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import {
  OperationalDataTable, useRpcMutation,
  type Column, type FilterDef, type FilterValue, type OperationalAction,
} from "@/core/operational";
import MachineDialog, { type MachineRow } from "../components/MachineDialog";

export default function MachinesPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "true", status: null, wc: null, maint: null });
  const [editing, setEditing] = useState<MachineRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: wcs = [] } = useQuery({
    queryKey: ["wc-min-machines"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name").order("name")).data ?? [],
  });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["machines", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("manufacturing_machines")
        .select("id, code, name, work_center_id, status, maintenance_status, capacity_per_hour, cost_per_hour, active, notes, machine_type, next_maintenance_at, work_centers:work_center_id(name)")
        .order("name");
      if (search.trim()) q = q.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
      if (filters.active === "true") q = q.eq("active", true);
      if (filters.active === "false") q = q.eq("active", false);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.wc) q = q.eq("work_center_id", filters.wc);
      if (filters.maint) q = q.eq("maintenance_status", filters.maint);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<MachineRow & { work_centers?: { name: string } | null }>;
    },
  });

  const archive = useRpcMutation<{ _machine_id: string; _reason: string }, unknown>({
    rpc: "machine_archive",
    successMessage: "Máquina arquivada",
    invalidateKeys: [["machines"]],
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "true", label: "Ativos" }, { value: "false", label: "Inativos" }] },
    { key: "status", label: "Disponibilidade", type: "select", options: [
      { value: "available", label: "Disponível" },
      { value: "busy", label: "Ocupada" },
      { value: "maintenance", label: "Manutenção" },
      { value: "inactive", label: "Inativa" },
    ]},
    { key: "wc", label: "Centro de trabalho", type: "select",
      options: (wcs as Array<{ id: string; name: string }>).map((w) => ({ value: w.id, label: w.name })) },
    { key: "maint", label: "Manutenção", type: "select", options: [
      { value: "ok", label: "OK" }, { value: "due", label: "Devida" },
      { value: "overdue", label: "Atrasada" }, { value: "blocked", label: "Bloqueada" }] },
  ], [wcs]);

  const fmt = (d: string | null) => d ? new Date(d).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";

  const maintBadge = (m: string | null) => {
    const map: Record<string, string> = { ok: "outline", due: "secondary", overdue: "destructive", blocked: "destructive" };
    return <Badge variant={(map[m ?? "ok"] ?? "outline") as any}>{m ?? "ok"}</Badge>;
  };

  const columns: Column<MachineRow & { work_centers?: { name: string } | null }>[] = useMemo(() => [
    { key: "code", header: "Código", cell: (r) => r.code ?? "—", width: "110px" },
    { key: "name", header: "Nome", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "wc", header: "Centro de trabalho", cell: (r) => r.work_centers?.name ?? "—" },
    { key: "status", header: "Estado", cell: (r) => <Badge variant="outline">{r.status}</Badge> },
    { key: "maint", header: "Manutenção", cell: (r) => maintBadge(r.maintenance_status) },
    { key: "cap", header: "Capac./h", align: "right", cell: (r) => r.capacity_per_hour ?? "—" },
    { key: "cost", header: "€/h", align: "right", cell: (r) => r.cost_per_hour ?? "—" },
    { key: "next", header: "Próx. manut.", cell: (r) => fmt(r.next_maintenance_at) },
    { key: "active", header: "Ativo", cell: (r) => <Badge variant={r.active ? "default" : "outline"}>{r.active ? "Sim" : "Não"}</Badge> },
  ], []);

  const headerActions: OperationalAction[] = [
    { key: "new", label: "Nova máquina", icon: <Plus className="h-4 w-4" />, variant: "default",
      onClick: () => { setEditing(null); setDialogOpen(true); } },
  ];

  const rowActions = (row: MachineRow): OperationalAction[] => [
    { key: "edit", label: "Editar", icon: <Pencil className="h-4 w-4" />,
      onClick: () => { setEditing(row); setDialogOpen(true); } },
    { key: "archive", label: "Arquivar", icon: <Archive className="h-4 w-4" />, destructive: true,
      disabled: !row.active, disabledReason: !row.active ? "Já arquivada" : undefined,
      confirm: { title: `Arquivar ${row.name}?`, description: "Indique o motivo no campo abaixo." },
      onClick: async () => {
        const reason = window.prompt("Motivo do arquivamento:");
        if (!reason || !reason.trim()) return;
        await archive.mutateAsync({ _machine_id: row.id, _reason: reason.trim() });
      } },
  ];

  return (
    <>
      <PageHeader title="Máquinas" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Máquinas" }]} />
      <PageBody>
        <OperationalDataTable
          columns={columns as any}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          search={{ value: search, onChange: setSearch, placeholder: "Procurar por nome ou código…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((s) => ({ ...s, [k]: v }))}
          onFiltersClear={() => setFilters({ active: "true", status: null, wc: null, maint: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          headerActions={headerActions}
          rowActions={rowActions as any}
          emptyTitle="Sem máquinas"
          emptyDescription="Adicione máquinas para associar a centros de trabalho e operações."
        />
      </PageBody>
      <MachineDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={() => refetch()} />
    </>
  );
}
