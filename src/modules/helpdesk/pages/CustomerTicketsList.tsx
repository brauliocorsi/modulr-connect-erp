import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TicketStatusBadge,
  TicketCategoryBadge,
  TicketPriorityBadge,
  SERVICE_HINT_CATEGORIES,
} from "../components/TicketBadges";
import { Wrench, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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

export default function CustomerTicketsList() {
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPriority, setFPriority] = useState<string>("all");
  const [fServiceCase, setFServiceCase] = useState<string>("all");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["customer_tickets", { fStatus, fCategory, fPriority, fServiceCase, search }],
    queryFn: async () => {
      let q: any = supabase
        .from("customer_tickets")
        .select("id, ticket_number, customer_id, sale_order_id, service_case_id, source, category, priority, status, subject, assigned_to, created_at, updated_at, customer:partners!customer_tickets_customer_id_fkey(name), sale_order:sale_orders!customer_tickets_sale_order_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (fStatus !== "all") q = q.eq("status", fStatus);
      if (fCategory !== "all") q = q.eq("category", fCategory);
      if (fPriority !== "all") q = q.eq("priority", fPriority);
      if (fServiceCase === "linked") q = q.not("service_case_id", "is", null);
      if (fServiceCase === "unlinked") q = q.is("service_case_id", null);
      if (search.trim()) q = q.or(`ticket_number.ilike.%${search}%,subject.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });

  const tickets = useMemo(() => data ?? [], [data]);

  return (
    <>
      <PageHeader
        title="Tickets de Helpdesk"
        breadcrumb={[{ label: "Helpdesk" }, { label: "Tickets" }]}
        onSearch={setSearch}
        searchPlaceholder="Buscar nº ou assunto…"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={"h-4 w-4 mr-1 " + (isFetching ? "animate-spin" : "")} /> Atualizar
          </Button>
        }
      />
      <PageBody>
        <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
          <FilterSelect value={fStatus} onChange={setFStatus} placeholder="Status" options={STATUSES} />
          <FilterSelect value={fCategory} onChange={setFCategory} placeholder="Categoria" options={CATEGORIES} />
          <FilterSelect value={fPriority} onChange={setFPriority} placeholder="Prioridade" options={PRIORITIES} />
          <FilterSelect
            value={fServiceCase}
            onChange={setFServiceCase}
            placeholder="Assistência"
            options={["linked", "unlinked"]}
            labels={{ linked: "Com assistência", unlinked: "Sem assistência" }}
          />
        </Card>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">A carregar…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{(error as Error).message}</div>
        ) : tickets.length === 0 ? (
          <EmptyState title="Sem tickets" description="Nenhum ticket corresponde aos filtros." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">Nº</th>
                  <th className="px-3 py-2">Assunto</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Pedido</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2">Prioridade</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Criado</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => nav(`/helpdesk/tickets/${t.id}`)}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-mono text-xs flex items-center gap-1">
                      {t.ticket_number}
                      {SERVICE_HINT_CATEGORIES.has(t.category) && !t.service_case_id && (
                        <Wrench className="h-3 w-3 text-amber-600" aria-label="potencial assistência" />
                      )}
                      {t.service_case_id && <Wrench className="h-3 w-3 text-emerald-600" aria-label="já vinculado" />}
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate">{t.subject}</td>
                    <td className="px-3 py-2">{t.customer?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {t.sale_order ? (
                        <Link
                          to={`/sales/orders/${t.sale_order_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="underline text-primary"
                        >
                          {t.sale_order.name}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2"><TicketCategoryBadge category={t.category} /></td>
                    <td className="px-3 py-2"><TicketPriorityBadge priority={t.priority} /></td>
                    <td className="px-3 py-2"><TicketStatusBadge status={t.status} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}

function FilterSelect({
  value, onChange, placeholder, options, labels,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}: Todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{labels?.[o] ?? o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
