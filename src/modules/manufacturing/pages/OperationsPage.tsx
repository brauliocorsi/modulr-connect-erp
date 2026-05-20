import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import {
  OperationalDataTable,
  type Column,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";

type Row = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  default_work_center_id: string | null;
  requires_machine: boolean | null;
  requires_employee: boolean | null;
  requires_quality_check: boolean | null;
  active: boolean;
  work_centers?: { name: string; code: string | null } | null;
};

export default function OperationsPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "true", wc: null });

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

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "true", label: "Ativos" }, { value: "false", label: "Inativos" },
    ]},
    { key: "wc", label: "Centro de trabalho", type: "select",
      options: (wcs as any[]).map((w) => ({ value: w.id, label: w.name })) },
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
    { key: "active", header: "Ativo", cell: (r) => <Badge variant={r.active ? "default" : "outline"}>{r.active ? "Ativo" : "Inativo"}</Badge> },
  ], []);

  return (
    <>
      <PageHeader title="Operações" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Operações" }]} />
      <PageBody>
        <OperationalDataTable
          columns={columns}
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
          emptyTitle="Sem operações"
          emptyDescription="Configure operações para definir as etapas dos roteiros de fabrico."
        />
      </PageBody>
    </>
  );
}
