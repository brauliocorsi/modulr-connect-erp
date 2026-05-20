import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Wrench, Trash2 } from "lucide-react";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import {
  OperationalDataTable,
  useRpcMutation,
  type Column,
  type OperationalAction,
} from "@/core/operational";

type Pkg = {
  id: string;
  package_ref: string | null;
  qty: number;
  condition: string | null;
  status: string | null;
  disposition_status: string | null;
  service_case_id: string | null;
  product_id: string | null;
  updated_at: string | null;
  products?: { name: string } | null;
  stock_locations?: { full_path: string | null; name: string | null } | null;
};

export default function QuarantinePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["quarantine-packages", search],
    queryFn: async () => {
      let q: any = supabase
        .from("stock_packages")
        .select("id, package_ref, qty, condition, status, disposition_status, service_case_id, product_id, updated_at, products(name), stock_locations:current_location_id(full_path,name)")
        .eq("condition", "quarantine")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (search.trim()) q = q.ilike("package_ref", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Pkg[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["quarantine-packages"] });

  const openCase = useRpcMutation<{ _stock_package_id: string; _action: string }, unknown>({
    rpc: "service_case_create_from_damaged_package",
    successMessage: "Caso criado",
    onSuccess: invalidate,
  });

  const columns: Column<Pkg>[] = useMemo(() => [
    { key: "ref", header: "Pacote", cell: (r) => <span className="font-mono text-xs">{r.package_ref ?? r.id.slice(0, 8)}</span>, width: "160px" },
    { key: "product", header: "Produto", cell: (r) => r.products?.name ?? "—" },
    { key: "qty", header: "Qtd", align: "right", cell: (r) => r.qty },
    { key: "location", header: "Localização", cell: (r) => r.stock_locations?.full_path ?? r.stock_locations?.name ?? "—" },
    { key: "age", header: "Idade", cell: (r) => {
      if (!r.updated_at) return "—";
      const days = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
      return <span className={days > 7 ? "text-destructive" : ""}>{days}d</span>;
    }},
    { key: "case", header: "Caso", cell: (r) => r.service_case_id ? <Badge>Vinculado</Badge> : <span className="text-muted-foreground text-xs">—</span> },
  ], []);

  const rowActions = (r: Pkg): OperationalAction[] => {
    if (r.service_case_id) return [];
    return [
      {
        key: "repair",
        label: "Reparação",
        icon: <Wrench className="h-4 w-4" />,
        onClick: async () => { await openCase.mutateAsync({ _stock_package_id: r.id, _action: "repair" }); },
        loading: openCase.isPending,
        confirm: { title: "Abrir caso de reparação", confirmLabel: "Abrir caso" },
      },
      {
        key: "scrap",
        label: "Descartar",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onClick: async () => { await openCase.mutateAsync({ _stock_package_id: r.id, _action: "scrap" }); },
        loading: openCase.isPending,
        confirm: { title: "Marcar para descarte", description: "Será criado um caso para descarte do pacote.", confirmLabel: "Descartar" },
      },
    ];
  };

  return (
    <>
      <PageHeader title="Quarentena" breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Quarentena" }]} />
      <PageBody>
        <OperationalDataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          search={{ value: search, onChange: setSearch, placeholder: "Procurar por ref. pacote…" }}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          rowActions={rowActions}
          emptyTitle="Sem pacotes em quarentena"
        />
      </PageBody>
    </>
  );
}
