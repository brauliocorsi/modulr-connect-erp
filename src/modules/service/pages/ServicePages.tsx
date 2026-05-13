import { ListView } from "@/core/layout/ListView";
import { SimpleForm } from "@/core/layout/SimpleForm";

const STATE_OPTIONS = [
  { value: "new", label: "Novo" },
  { value: "triaged", label: "Triado" },
  { value: "scheduled", label: "Agendado" },
  { value: "in_progress", label: "Em curso" },
  { value: "done", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

export const ServiceRequestsList = () => (
  <ListView
    title="Pedidos de Assistência"
    breadcrumb={[{ label: "Assistência" }]}
    table="service_requests"
    select="id, name, state, priority, created_at, partners(name), products(name)"
    searchColumn="name"
    rowLink={(r: any) => `/service/requests/${r.id}`}
    columns={[
      { key: "name", header: "Nº" },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name ?? "—" },
      { key: "product", header: "Produto", render: (r: any) => r.products?.name ?? "—" },
      { key: "priority", header: "Prioridade" },
      { key: "state", header: "Estado" },
      { key: "created_at", header: "Aberto em", render: (r: any) => new Date(r.created_at).toLocaleString("pt-PT") },
    ]}
  />
);

export const ServiceRequestForm = () => (
  <SimpleForm
    table="service_requests"
    title="Pedido de Assistência"
    basePath="/service/requests"
    breadcrumb={[{ label: "Assistência", to: "/service/requests" }, { label: "Pedido" }]}
    fields={[
      { name: "name", label: "Nº", required: true },
      { name: "partner_id", label: "Cliente", type: "reference", refTable: "partners", refLabel: "name" },
      { name: "product_id", label: "Produto", type: "reference", refTable: "products", refLabel: "name" },
      { name: "priority", label: "Prioridade", type: "select", options: [
        { value: "low", label: "Baixa" }, { value: "normal", label: "Normal" },
        { value: "high", label: "Alta" }, { value: "urgent", label: "Urgente" },
      ]},
      { name: "state", label: "Estado", type: "select", options: STATE_OPTIONS },
      { name: "assigned_to", label: "Responsável", type: "reference", refTable: "profiles", refLabel: "full_name" },
      { name: "scheduled_for", label: "Agendado para", type: "datetime" },
      { name: "description", label: "Descrição do problema", type: "textarea" },
      { name: "resolution", label: "Resolução / notas internas", type: "textarea" },
    ]}
  />
);
