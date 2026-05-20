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
import OperationDialog, { type OperationRow } from "../components/OperationDialog";

type Row = OperationRow & { work_centers?: { name: string; code: string | null } | null };

export default function OperationsPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "true", wc: null });
  const [editing, setEditing] = useState<OperationRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: wcs = [] } = useQuery({
    queryKey: ["wc-min"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name").order("name")).data ?? [],
  });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["manufacturing-operations", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("manufacturing_operations")
        .select("id, code, name, description, default_work_center_id, requires_machine, requires_employee, requires_quality_check, active, work_centers:default_work_center_id(name,code)")
        .order("name");
      if (search.trim()) q = q.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
      if (filters.active === "true") q = q.eq("active", true);
      if (filters.active === "false") q = q.eq("active", false);
      if (filters.wc) q = q.eq("default_work_center_id", filters.wc);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const archive = useRpcMutation<{ _operation_id: string; _reason: string }, unknown>({
    rpc: "manufacturing_operation_archive",
    successMessage: "Operação arquivada",
    invalidateKeys: [["manufacturing-operations"]],
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "true", label: "Ativas" }, { value: "false", label: "Inativas" }] },
    { key: "wc", label: "Centro de trabalho", type: "select",
      options: (wcs as Array<{ id: string; name: string }>).map((w) => ({ value: w.id, label: w.name })) },
  ], [wcs]);

  const columns: Column<Row>[] = useMemo(() => [
    { key: "code", header: "Código", cell: (r) => r.code ?? "—", width: "120px" },
    { key: "name", header: "Nome", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "wc", header: "Centro de trabalho", cell: (r) => r.work_centers?.name ?? "—" },
    { key: "req", header: "Requer", cell: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.requires_machine && <Badge variant="outline">Máquina</Badge>}
        {r.requires_employee && <Badge variant="outline">Operador</Badge>}
        {r.requires_quality_check && <Badge variant="outline">QC</Badge>}
        {!r.requires_machine && !r.requires_employee && !r.requires_quality_check && "—"}
      </div>
    )},
    { key: "active", header: "Ativa", cell: (r) => <Badge variant={r.active ? "default" : "outline"}>{r.active ? "Sim" : "Não"}</Badge> },
  ], []);

  const headerActions: OperationalAction[] = [
    { key: "new", label: "Nova operação", icon: <Plus className="h-4 w-4" />, variant: "default",
      onClick: () => { setEditing(null); setDialogOpen(true); } },
  ];

  const rowActions = (row: OperationRow): OperationalAction[] => [
    { key: "edit", label: "Editar", icon: <Pencil className="h-4 w-4" />,
      onClick: () => { setEditing(row); setDialogOpen(true); } },
    { key: "archive", label: "Arquivar", icon: <Archive className="h-4 w-4" />, destructive: true,
      disabled: !row.active, disabledReason: !row.active ? "Já arquivada" : undefined,
      onClick: async () => {
        const reason = window.prompt("Motivo do arquivamento:");
        if (!reason || !reason.trim()) return;
        await archive.mutateAsync({ _operation_id: row.id, _reason: reason.trim() });
      } },
  ];

  return (
    <>
      <PageHeader title="Operações" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Operações" }]} />
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
          onFiltersClear={() => setFilters({ active: "true", wc: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          headerActions={headerActions}
          rowActions={rowActions as any}
          emptyTitle="Sem operações"
          emptyDescription="Configure operações para definir as etapas dos roteiros de fabrico."
        />
      </PageBody>
      <OperationDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={() => refetch()} />
    </>
  );
}
