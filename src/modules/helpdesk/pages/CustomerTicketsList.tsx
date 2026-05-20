import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Wrench } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  type Column,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";
import { TicketCategoryBadge, TicketPriorityBadge, SERVICE_HINT_CATEGORIES } from "../components/TicketBadges";
import { NewTicketDialog } from "../components/NewTicketDialog";

type Ticket = {
  id: string;
  ticket_number: string;
  customer_id: string;
  sale_order_id: string | null;
  service_case_id: string | null;
  source: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  customer?: { name: string } | null;
  sale_order?: { name: string } | null;
};

const STATUSES = ["new", "waiting_agent", "waiting_customer", "linked_to_service_case", "resolved", "closed", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const CATEGORIES = [
  "order_status", "delivery_schedule", "payment_question", "damaged_product",
  "missing_part", "warranty_claim", "return_request", "complaint", "general_question", "other",
];

const STATUS_LABELS: Record<string, string> = {
  new: "Novo", waiting_agent: "Aguarda agente", waiting_customer: "Aguarda cliente",
  linked_to_service_case: "Ligado à assistência", resolved: "Resolvido", closed: "Fechado", cancelled: "Cancelado",
};
const CATEGORY_LABELS: Record<string, string> = {
  order_status: "Status do pedido", delivery_schedule: "Agenda entrega", payment_question: "Pagamento",
  damaged_product: "Produto danificado", missing_part: "Peça em falta", warranty_claim: "Garantia",
  return_request: "Devolução", complaint: "Reclamação", general_question: "Dúvida", other: "Outro",
};
const PRIORITY_LABELS: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };

export default function CustomerTicketsList() {
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({
    status: null, category: null, priority: null, service_case: null,
  });

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })) },
    { key: "category", label: "Categoria", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c })) },
    { key: "priority", label: "Prioridade", type: "select", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] ?? p })) },
    { key: "service_case", label: "Assistência", type: "select", options: [
      { value: "linked", label: "Com assistência" },
      { value: "unlinked", label: "Sem assistência" },
    ] },
  ], []);

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["customer_tickets", { filters, search }],
    queryFn: async () => {
      let q: any = supabase
        .from("customer_tickets")
        .select("id, ticket_number, customer_id, sale_order_id, service_case_id, source, category, priority, status, subject, assigned_to, created_at, updated_at, customer:partners!customer_tickets_customer_id_fkey(name), sale_order:sale_orders!customer_tickets_sale_order_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.category) q = q.eq("category", filters.category);
      if (filters.priority) q = q.eq("priority", filters.priority);
      if (filters.service_case === "linked") q = q.not("service_case_id", "is", null);
      if (filters.service_case === "unlinked") q = q.is("service_case_id", null);
      if (search.trim()) q = q.or(`ticket_number.ilike.%${search}%,subject.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });

  const tickets = data ?? [];

  const columns: Column<Ticket>[] = useMemo(() => [
    {
      key: "ticket_number",
      header: "Nº",
      cell: (t) => (
        <span className="font-mono text-xs flex items-center gap-1">
          {t.ticket_number}
          {SERVICE_HINT_CATEGORIES.has(t.category) && !t.service_case_id && (
            <Wrench className="h-3 w-3 text-amber-600" aria-label="potencial assistência" />
          )}
          {t.service_case_id && <Wrench className="h-3 w-3 text-emerald-600" aria-label="já vinculado" />}
        </span>
      ),
    },
    { key: "subject", header: "Assunto", cell: (t) => <span className="truncate max-w-xs block">{t.subject}</span> },
    { key: "customer", header: "Cliente", cell: (t) => t.customer?.name ?? "—" },
    {
      key: "sale_order",
      header: "Pedido",
      cell: (t) => t.sale_order ? (
        <Link to={`/sales/orders/${t.sale_order_id}`} onClick={(e) => e.stopPropagation()} className="underline text-primary">
          {t.sale_order.name}
        </Link>
      ) : "—",
    },
    { key: "category", header: "Categoria", cell: (t) => <TicketCategoryBadge category={t.category} /> },
    { key: "priority", header: "Prioridade", cell: (t) => <TicketPriorityBadge priority={t.priority} /> },
    { key: "status", header: "Status", cell: (t) => <OperationalStatusBadge domain="ticket" status={t.status} /> },
    {
      key: "created_at",
      header: "Criado",
      cell: (t) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
        </span>
      ),
    },
  ], []);

  return (
    <>
      <PageHeader
        title="Tickets de Helpdesk"
        breadcrumb={[{ label: "Helpdesk" }, { label: "Tickets" }]}
        actions={<NewTicketDialog onCreated={() => refetch()} />}
      />
      <PageBody>
        <OperationalDataTable<Ticket>
          columns={columns}
          rows={tickets}
          getRowId={(t) => t.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRowClick={(t) => nav(`/helpdesk/tickets/${t.id}`)}
          search={{ value: search, onChange: setSearch, placeholder: "Buscar nº ou assunto…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
          onFiltersClear={() => setFilters({ status: null, category: null, priority: null, service_case: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          emptyTitle="Sem tickets"
          emptyDescription="Nenhum ticket corresponde aos filtros."
        />
      </PageBody>
    </>
  );
}
