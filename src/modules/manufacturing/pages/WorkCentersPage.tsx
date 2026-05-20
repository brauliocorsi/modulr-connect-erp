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
import WorkCenterDialog, { type WorkCenterRow } from "../components/WorkCenterDialog";

export default function WorkCentersPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "true", type: null });
  const [editing, setEditing] = useState<WorkCenterRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["work-centers", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("work_centers")
        .select("id, code, name, type, capacity_per_day, efficiency_percent, cost_per_hour, active, warehouse_id, notes, warehouses(name)")
        .order("name");
      if (search.trim()) q = q.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
      if (filters.active === "true") q = q.eq("active", true);
      if (filters.active === "false") q = q.eq("active", false);
      if (filters.type) q = q.eq("type", filters.type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<WorkCenterRow & { warehouses?: { name: string } | null }>;
    },
  });

  const archive = useRpcMutation<{ _work_center_id: string; _reason: string }, unknown>({
    rpc: "work_center_archive",
    successMessage: "Centro arquivado",
    invalidateKeys: [["work-centers"]],
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "true", label: "Ativos" }, { value: "false", label: "Inativos" }] },
    { key: "type", label: "Tipo", type: "select", options: [
      { value: "manual", label: "Manual" }, { value: "machine", label: "Máquina" },
      { value: "cutting", label: "Corte" }, { value: "sewing", label: "Costura" },
      { value: "upholstery", label: "Estofo" }, { value: "assembly", label: "Montagem" },
      { value: "quality", label: "Qualidade" }, { value: "packing", label: "Embalagem" },
      { value: "other", label: "Outro" },
    ]},
  ], []);

  const columns: Column<WorkCenterRow & { warehouses?: { name: string } | null }>[] = useMemo(() => [
    { key: "code", header: "Código", cell: (r) => r.code ?? "—", width: "120px" },
    { key: "name", header: "Nome", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Tipo", cell: (r) => r.type ?? "—" },
    { key: "warehouse", header: "Armazém", cell: (r) => r.warehouses?.name ?? "—" },
    { key: "capacity", header: "Capac./dia", align: "right", cell: (r) => r.capacity_per_day ?? "—" },
    { key: "eff", header: "Eficiência %", align: "right", cell: (r) => r.efficiency_percent ?? "—" },
    { key: "cost", header: "€/hora", align: "right", cell: (r) => r.cost_per_hour ?? "—" },
    { key: "active", header: "Ativo", cell: (r) => <Badge variant={r.active ? "default" : "outline"}>{r.active ? "Sim" : "Não"}</Badge> },
  ], []);

  const headerActions: OperationalAction[] = [
    { key: "new", label: "Novo centro", icon: <Plus className="h-4 w-4" />, variant: "default",
      onClick: () => { setEditing(null); setDialogOpen(true); } },
  ];

  const rowActions = (row: WorkCenterRow): OperationalAction[] => [
    { key: "edit", label: "Editar", icon: <Pencil className="h-4 w-4" />,
      onClick: () => { setEditing(row); setDialogOpen(true); } },
    { key: "archive", label: "Arquivar", icon: <Archive className="h-4 w-4" />, destructive: true,
      disabled: !row.active, disabledReason: !row.active ? "Já arquivado" : undefined,
      onClick: async () => {
        const reason = window.prompt("Motivo do arquivamento:");
        if (!reason || !reason.trim()) return;
        await archive.mutateAsync({ _work_center_id: row.id, _reason: reason.trim() });
      } },
  ];

  return (
    <>
      <PageHeader title="Centros de trabalho" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Centros de trabalho" }]} />
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
          onFiltersClear={() => setFilters({ active: "true", type: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          headerActions={headerActions}
          rowActions={rowActions as any}
          emptyTitle="Sem centros de trabalho"
          emptyDescription="Configure os centros de trabalho da sua fábrica para começar a registar operações."
        />
      </PageBody>
      <WorkCenterDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={() => refetch()} />
    </>
  );
}
