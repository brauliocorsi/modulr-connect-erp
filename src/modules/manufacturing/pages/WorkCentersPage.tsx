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
  type: string | null;
  capacity_per_day: number | null;
  efficiency_percent: number | null;
  cost_per_hour: number | null;
  active: boolean;
  warehouse_id: string | null;
  warehouses?: { name: string } | null;
};

export default function WorkCentersPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ active: "true", type: null });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["work-centers", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("work_centers")
        .select("id, code, name, type, capacity_per_day, efficiency_percent, cost_per_hour, active, warehouse_id, warehouses(name)")
        .order("name");
      if (search.trim()) q = q.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
      if (filters.active === "true") q = q.eq("active", true);
      if (filters.active === "false") q = q.eq("active", false);
      if (filters.type) q = q.eq("type", filters.type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "active", label: "Estado", type: "select", options: [
      { value: "true", label: "Ativos" }, { value: "false", label: "Inativos" },
    ]},
    { key: "type", label: "Tipo", type: "select", options: [
      { value: "assembly", label: "Montagem" },
      { value: "cutting", label: "Corte" },
      { value: "finishing", label: "Acabamento" },
      { value: "packaging", label: "Embalagem" },
      { value: "quality", label: "Qualidade" },
      { value: "other", label: "Outro" },
    ]},
  ], []);

  const columns: Column<Row>[] = useMemo(() => [
    { key: "code", header: "Código", cell: (r) => r.code ?? "—", width: "120px" },
    { key: "name", header: "Nome", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Tipo", cell: (r) => r.type ?? "—" },
    { key: "warehouse", header: "Armazém", cell: (r) => r.warehouses?.name ?? "—" },
    { key: "capacity", header: "Capac./dia", align: "right", cell: (r) => r.capacity_per_day ?? "—" },
    { key: "eff", header: "Eficiência %", align: "right", cell: (r) => r.efficiency_percent ?? "—" },
    { key: "cost", header: "€/hora", align: "right", cell: (r) => r.cost_per_hour ?? "—" },
    { key: "active", header: "Ativo", cell: (r) => <Badge variant={r.active ? "default" : "outline"}>{r.active ? "Ativo" : "Inativo"}</Badge> },
  ], []);

  return (
    <>
      <PageHeader title="Centros de trabalho" breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Centros de trabalho" }]} />
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
          onFiltersClear={() => setFilters({ active: "true", type: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          emptyTitle="Sem centros de trabalho"
          emptyDescription="Configure os centros de trabalho da sua fábrica para começar a registar operações."
        />
      </PageBody>
    </>
  );
}
