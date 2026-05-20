import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import {
  OperationalDataTable,
  useRpcMutation,
  type Column,
  type FilterDef,
  type FilterValue,
  type OperationalAction,
} from "@/core/operational";

type Pkg = {
  id: string;
  package_ref: string | null;
  qty: number;
  condition: string | null;
  status: string | null;
  disposition_status: string | null;
  current_location_id: string | null;
  service_case_id: string | null;
  product_id: string | null;
  sale_order_id: string | null;
  updated_at: string | null;
  products?: { name: string } | null;
  stock_locations?: { full_path: string | null; name: string | null } | null;
  sale_orders?: { name: string } | null;
};

export default function DamagedStockPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ disposition: null });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["damaged-packages", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("stock_packages")
        .select("id, package_ref, qty, condition, status, disposition_status, current_location_id, service_case_id, product_id, sale_order_id, updated_at, products(name), stock_locations:current_location_id(full_path,name), sale_orders(name)")
        .eq("condition", "damaged")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (search.trim()) q = q.ilike("package_ref", `%${search.trim()}%`);
      if (filters.disposition) q = q.eq("disposition_status", filters.disposition);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Pkg[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["damaged-packages"] });

  const openCase = useRpcMutation<{ _stock_package_id: string; _action: string }, unknown>({
    rpc: "service_case_create_from_damaged_package",
    successMessage: "Caso criado",
    onSuccess: invalidate,
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "disposition", label: "Disposição", type: "select", options: [
      { value: "pending", label: "Pendente" },
      { value: "repair", label: "Em reparação" },
      { value: "scrap", label: "A descartar" },
      { value: "return_supplier", label: "Devolução fornecedor" },
    ]},
  ], []);

  const columns: Column<Pkg>[] = useMemo(() => [
    { key: "ref", header: "Pacote", cell: (r) => <span className="font-mono text-xs">{r.package_ref ?? r.id.slice(0, 8)}</span>, width: "160px" },
    { key: "product", header: "Produto", cell: (r) => r.products?.name ?? "—" },
    { key: "qty", header: "Qtd", align: "right", cell: (r) => r.qty },
    { key: "location", header: "Localização", cell: (r) => r.stock_locations?.full_path ?? r.stock_locations?.name ?? "—" },
    { key: "origin", header: "Origem", cell: (r) => r.sale_orders?.name ?? "—" },
    { key: "disposition", header: "Disposição", cell: (r) => r.disposition_status
      ? <Badge variant="outline">{r.disposition_status}</Badge>
      : <Badge variant="secondary">Pendente</Badge> },
    { key: "case", header: "Caso", cell: (r) => r.service_case_id
      ? <Badge>Vinculado</Badge>
      : <span className="text-muted-foreground text-xs">—</span> },
    { key: "updated", header: "Atualizado", cell: (r) => r.updated_at ? new Date(r.updated_at).toLocaleString("pt-PT") : "—" },
  ], []);

  const rowActions = (r: Pkg): OperationalAction[] => {
    if (r.service_case_id) return [];
    return [
      {
        key: "repair",
        label: "Abrir reparação",
        icon: <Wrench className="h-4 w-4" />,
        onClick: () => openCase.mutateAsync({ _stock_package_id: r.id, _action: "repair" }),
        loading: openCase.isPending,
        confirm: {
          title: "Abrir caso de reparação",
          description: "Vai criar um caso de assistência interno para este pacote danificado.",
          confirmLabel: "Abrir caso",
        },
      },
    ];
  };

  return (
    <>
      <PageHeader title="Stock danificado" breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Danificados" }]} />
      <PageBody>
        <OperationalDataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          search={{ value: search, onChange: setSearch, placeholder: "Procurar por ref. pacote…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((s) => ({ ...s, [k]: v }))}
          onFiltersClear={() => setFilters({ disposition: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          rowActions={rowActions}
          emptyTitle="Sem pacotes danificados"
        />
      </PageBody>
    </>
  );
}
