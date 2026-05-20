import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Play, Check, Trash2, ArrowRightFromLine } from "lucide-react";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import {
  OperationalDataTable,
  useRpcMutation,
  type Column,
  type FilterDef,
  type FilterValue,
  type OperationalAction,
} from "@/core/operational";

type Item = {
  id: string;
  service_case_id: string;
  qty: number;
  status: string | null;
  issue_type: string | null;
  required_action: string | null;
  repair_status: string | null;
  repair_result: string | null;
  repair_started_at: string | null;
  repair_completed_at: string | null;
  notes: string | null;
  products?: { name: string } | null;
  stock_packages?: { package_ref: string | null } | null;
  service_cases?: { case_number: string; customer_id: string | null; status: string | null; partners?: { name: string } | null } | null;
};

export default function ServiceRepairsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ repair: null });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["service-repairs", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("service_case_items")
        .select("id, service_case_id, qty, status, issue_type, required_action, repair_status, repair_result, repair_started_at, repair_completed_at, notes, products(name), stock_packages(package_ref), service_cases(case_number,status,customer_id,partners:customer_id(name))")
        .eq("required_action", "repair")
        .order("repair_started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (filters.repair) q = q.eq("repair_status", filters.repair);
      if (search.trim()) q = q.ilike("service_cases.case_number", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["service-repairs"] });

  const startRpc = useRpcMutation({ rpc: "service_case_repair_start", successMessage: "Reparação iniciada", onSuccess: invalidate });
  const completeRpc = useRpcMutation({ rpc: "service_case_repair_complete", successMessage: "Reparação concluída", onSuccess: invalidate });
  const disposeRpc = useRpcMutation({ rpc: "service_case_dispose_package", successMessage: "Pacote descartado", onSuccess: invalidate });
  const releaseRpc = useRpcMutation({ rpc: "service_case_release_repaired_to_stock", successMessage: "Liberado para stock", onSuccess: invalidate });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "repair", label: "Estado reparação", type: "select", options: [
      { value: "pending", label: "Pendente" },
      { value: "in_progress", label: "Em curso" },
      { value: "completed", label: "Concluída" },
      { value: "disposed", label: "Descartada" },
      { value: "released", label: "Liberada" },
    ]},
  ], []);

  const columns: Column<Item>[] = useMemo(() => [
    { key: "case", header: "Caso", cell: (r) => <span className="font-mono text-xs">{r.service_cases?.case_number ?? "—"}</span>, width: "140px" },
    { key: "product", header: "Produto", cell: (r) => r.products?.name ?? "—" },
    { key: "pkg", header: "Pacote", cell: (r) => r.stock_packages?.package_ref ?? "—" },
    { key: "customer", header: "Cliente", cell: (r) => r.service_cases?.partners?.name ?? "—" },
    { key: "qty", header: "Qtd", align: "right", cell: (r) => r.qty },
    { key: "status", header: "Reparação", cell: (r) => r.repair_status
      ? <Badge variant={r.repair_status === "completed" || r.repair_status === "released" ? "default" : "outline"}>{r.repair_status}</Badge>
      : <Badge variant="secondary">pending</Badge> },
    { key: "started", header: "Iniciado", cell: (r) => r.repair_started_at ? new Date(r.repair_started_at).toLocaleDateString("pt-PT") : "—" },
  ], []);

  const rowActions = (r: Item): OperationalAction[] => {
    const st = r.repair_status ?? "pending";
    const acts: OperationalAction[] = [];
    if (st === "pending") {
      acts.push({
        key: "start", label: "Iniciar", icon: <Play className="h-4 w-4" />,
        onClick: async () => { await startRpc.mutateAsync({ _case_item_id: r.id }); },
        loading: startRpc.isPending,
      });
    }
    if (st === "in_progress") {
      acts.push({
        key: "complete", label: "Concluir", icon: <Check className="h-4 w-4" />,
        onClick: async () => { await completeRpc.mutateAsync({ _case_item_id: r.id, _result: "repaired" }); },
        loading: completeRpc.isPending,
        confirm: { title: "Concluir reparação", confirmLabel: "Concluir" },
      });
    }
    if (st === "completed") {
      acts.push({
        key: "release", label: "Liberar", icon: <ArrowRightFromLine className="h-4 w-4" />,
        onClick: async () => { await releaseRpc.mutateAsync({ _case_item_id: r.id }); },
        loading: releaseRpc.isPending,
        confirm: { title: "Liberar para stock", confirmLabel: "Liberar" },
      });
    }
    if (st !== "released" && st !== "disposed") {
      acts.push({
        key: "dispose", label: "Descartar", icon: <Trash2 className="h-4 w-4" />, destructive: true,
        onClick: async () => { await disposeRpc.mutateAsync({ _case_item_id: r.id, _reason: "Descartado via UI" }); },
        loading: disposeRpc.isPending,
        confirm: { title: "Descartar pacote", description: "Esta ação remove o pacote do stock.", confirmLabel: "Descartar" },
      });
    }
    return acts;
  };

  return (
    <>
      <PageHeader title="Reparações" breadcrumb={[{ label: "Assistência", to: "/service/requests" }, { label: "Reparações" }]} />
      <PageBody>
        <OperationalDataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          search={{ value: search, onChange: setSearch, placeholder: "Procurar por nº caso…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((s) => ({ ...s, [k]: v }))}
          onFiltersClear={() => setFilters({ repair: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          rowActions={rowActions}
          emptyTitle="Sem reparações"
        />
      </PageBody>
    </>
  );
}
