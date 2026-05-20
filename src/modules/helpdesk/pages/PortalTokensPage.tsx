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

type Token = {
  id: string;
  scope: string | null;
  status: string | null;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  customer_id: string | null;
  sale_order_id: string | null;
  service_case_id: string | null;
  partners?: { name: string } | null;
  sale_orders?: { name: string } | null;
  service_cases?: { case_number: string } | null;
};

function tokenStatus(t: Token): "active" | "used" | "revoked" | "expired" {
  if (t.revoked_at) return "revoked";
  if (t.used_at) return "used";
  if (t.expires_at && new Date(t.expires_at) < new Date()) return "expired";
  return "active";
}

export default function PortalTokensPage() {
  const [filters, setFilters] = useState<Record<string, FilterValue>>({ status: "active" });

  const { data: rows = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["portal-tokens", filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_portal_tokens")
        .select("id, scope, status, expires_at, used_at, revoked_at, created_at, customer_id, sale_order_id, service_case_id, partners:customer_id(name), sale_orders(name), service_cases(case_number)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const all = (data ?? []) as Token[];
      if (!filters.status) return all;
      return all.filter((t) => tokenStatus(t) === filters.status);
    },
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "status", label: "Estado", type: "select", options: [
      { value: "active", label: "Ativos" },
      { value: "used", label: "Usados" },
      { value: "revoked", label: "Revogados" },
      { value: "expired", label: "Expirados" },
    ]},
  ], []);

  const columns: Column<Token>[] = useMemo(() => [
    { key: "customer", header: "Cliente", cell: (r) => r.partners?.name ?? "—" },
    { key: "scope", header: "Escopo", cell: (r) => <Badge variant="outline">{r.scope ?? "—"}</Badge> },
    { key: "ref", header: "Referência", cell: (r) => r.sale_orders?.name ?? r.service_cases?.case_number ?? "—" },
    { key: "expires", header: "Expira", cell: (r) => r.expires_at ? new Date(r.expires_at).toLocaleString("pt-PT") : "—" },
    { key: "status", header: "Estado", cell: (r) => {
      const s = tokenStatus(r);
      const variants: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
        active: "default", used: "secondary", revoked: "destructive", expired: "outline",
      };
      return <Badge variant={variants[s]}>{s}</Badge>;
    }},
    { key: "created", header: "Criado", cell: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString("pt-PT") : "—" },
  ], []);

  return (
    <>
      <PageHeader
        title="Tokens do Portal Cliente"
        breadcrumb={[{ label: "Helpdesk", to: "/helpdesk/tickets" }, { label: "Portal Cliente" }]}
      />
      <PageBody>
        <OperationalDataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((s) => ({ ...s, [k]: v }))}
          onFiltersClear={() => setFilters({ status: "active" })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          emptyTitle="Sem tokens"
          emptyDescription="Tokens de acesso ao portal são gerados ao enviar links a clientes."
        />
      </PageBody>
    </>
  );
}
