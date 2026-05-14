import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ListView } from "@/core/layout/ListView";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { StateBadge } from "@/core/layout/StateBadge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATE_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "triaged", label: "Triado" },
  { value: "scheduled", label: "Agendado" },
  { value: "in_progress", label: "Em curso" },
  { value: "done", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

const PRIORITY_TONES: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  normal: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  urgent: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
};
const PRIORITY_PT: Record<string, string> = {
  low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente",
};

const PriorityBadge = ({ value }: { value?: string | null }) => {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls = PRIORITY_TONES[value] ?? "bg-muted text-foreground";
  return (
    <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + cls}>
      {PRIORITY_PT[value] ?? value}
    </span>
  );
};

export const ServiceRequestsList = () => (
  <ListView
    title="Pedidos de Assistência"
    breadcrumb={[{ label: "Assistência" }]}
    table="service_requests"
    select="id, name, state, priority, created_at, partners(name), products(name), stock_pickings(name, origin)"
    searchColumn="name"
    rowLink={(r: any) => `/service/requests/${r.id}`}
    columns={[
      { key: "name", header: "Nº" },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name ?? "—" },
      { key: "product", header: "Produto", render: (r: any) => r.products?.name ?? "—" },
      {
        key: "delivery", header: "Entrega",
        render: (r: any) => r.stock_pickings?.name
          ? <span className="font-mono text-xs">{r.stock_pickings.name}</span>
          : <span className="text-muted-foreground">—</span>,
      },
      {
        key: "sale", header: "Venda",
        render: (r: any) => r.stock_pickings?.origin
          ? <span className="font-mono text-xs">{r.stock_pickings.origin}</span>
          : <span className="text-muted-foreground">—</span>,
      },
      { key: "priority", header: "Prioridade", render: (r: any) => <PriorityBadge value={r.priority} /> },
      { key: "state", header: "Estado", render: (r: any) => <StateBadge value={r.state} /> },
      { key: "created_at", header: "Aberto em", render: (r: any) => new Date(r.created_at).toLocaleString("pt-PT") },
    ]}
  />
);

function LinkedRefs({ id }: { id: string }) {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("service_requests")
        .select("state, priority, picking_id, stock_pickings(id, name, origin), partners(name)")
        .eq("id", id)
        .maybeSingle();
      setInfo(data);
    })();
  }, [id]);
  if (!info) return null;
  return (
    <Card className="p-4 max-w-3xl mb-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Estado:</span>
        <StateBadge value={info.state} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Prioridade:</span>
        <PriorityBadge value={info.priority} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Cliente:</span>
        <Badge variant="outline">{info.partners?.name ?? "—"}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Entrega:</span>
        {info.stock_pickings?.name ? (
          <Link to={`/inventory/shipments/${info.stock_pickings.id}`} className="font-mono text-xs underline">
            {info.stock_pickings.name}
          </Link>
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Venda:</span>
        {info.stock_pickings?.origin
          ? <span className="font-mono text-xs">{info.stock_pickings.origin}</span>
          : <span className="text-muted-foreground text-xs">—</span>}
      </div>
    </Card>
  );
}

export const ServiceRequestForm = () => {
  const { id } = useParams();
  return (
    <>
      {id && id !== "new" && (
        <div className="px-6 pt-4">
          <LinkedRefs id={id} />
        </div>
      )}
      <SimpleForm
        table="service_requests"
        title="Pedido de Assistência"
        basePath="/service/requests"
        breadcrumb={[{ label: "Assistência", to: "/service/requests" }, { label: "Pedido" }]}
        fields={[
          { name: "name", label: "Nº", required: true },
          { name: "partner_id", label: "Cliente ID" },
          { name: "product_id", label: "Produto ID" },
          { name: "priority", label: "Prioridade", type: "select", options: [
            { value: "low", label: "Baixa" }, { value: "normal", label: "Normal" },
            { value: "high", label: "Alta" }, { value: "urgent", label: "Urgente" },
          ]},
          { name: "state", label: "Estado", type: "select", options: STATE_OPTIONS },
          { name: "assigned_to", label: "Responsável (user id)" },
          { name: "scheduled_for", label: "Agendado para", type: "date" },
          { name: "description", label: "Descrição do problema", type: "textarea" },
          { name: "resolution", label: "Resolução / notas internas", type: "textarea" },
        ]}
      />
    </>
  );
};
