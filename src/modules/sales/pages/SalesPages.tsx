import { fmtMoney } from "@/lib/format";
import { ListView } from "@/core/layout/ListView";
import { ConfigurableListView } from "@/core/layout/ConfigurableListView";
import { FulfillmentBadge, FULFILLMENT_OPTIONS } from "@/core/orders/FulfillmentBadge";
import { PaymentStatusBadge } from "@/core/orders/PaymentStatusBadge";
import { InvoiceStatusBadge } from "@/core/orders/InvoiceStatusBadge";
import { StateBadge } from "@/core/layout/StateBadge";
import { Link } from "react-router-dom";

const SALE_STATE_OPTS = [
  { value: "draft", label: "Rascunho" },
  { value: "sent", label: "Enviado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "done", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

export const QuotationsList = () => (
  <ListView
    title="Cotações"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Cotações" }]}
    table="sale_orders"
    select="id, name, state, date_order, amount_total, partners(name)"
    searchColumn="name"
    createTo="/sales/orders/new"
    rowLink={(r: any) => `/sales/orders/${r.id}`}
    filter={(q) => q.in("state", ["draft", "sent"])}
    filters={[
      { key: "state", label: "Estado", type: "select", options: SALE_STATE_OPTS.filter((s) => ["draft","sent"].includes(s.value)) },
      { key: "from", label: "Data de", type: "date" },
      { key: "to", label: "Data até", type: "date" },
      { key: "min_total", label: "Total mínimo", type: "text" },
    ]}
    applyFilter={(q, v) => {
      if (v.state) q = q.eq("state", v.state);
      if (v.from) q = q.gte("date_order", v.from);
      if (v.to) q = q.lte("date_order", v.to + "T23:59:59");
      if (v.min_total) q = q.gte("amount_total", Number(v.min_total));
      return q;
    }}
    columns={[
      { key: "name", header: "Número", sortable: true },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name },
      { key: "state", header: "Estado", sortable: true, render: (r: any) => <StateBadge value={r.state} /> },
      { key: "date_order", header: "Data", sortable: true, render: (r: any) => r.date_order ? new Date(r.date_order).toLocaleDateString("pt-PT") : "—" },
      { key: "amount_total", header: "Total", sortable: true, render: (r: any) => `${fmtMoney(r.amount_total)}` },
    ]}
  />
);

export const SalesOrdersList = () => (
  <ConfigurableListView
    viewKey="sales.orders"
    title="Pedidos de Venda"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Pedidos" }]}
    table="sale_orders_with_schedule_summary"
    select="sale_order_id, name, state, fulfillment_status, payment_status, invoice_status, operational_status, date_order, commitment_date, amount_total, delivery_mode, include_delivery, include_assembly, delivery_zone_label, scheduled_date, slot_start, slot_end, schedule_status, schedule_confirmed, route_id, route_date, partner_id"
    searchColumn="name"
    createTo="/sales/orders/new"
    rowKey={(r: any) => r.sale_order_id}
    rowLink={(r: any) => `/sales/orders/${r.sale_order_id}`}
    orderBy="date_order"
    ascending={false}
    filter={(q) => q.in("state", ["confirmed", "done", "cancelled"])}
    filters={[
      { key: "state", label: "Estado", type: "select", options: SALE_STATE_OPTS.filter((s) => ["confirmed","done","cancelled"].includes(s.value)) },
      { key: "delivery_mode", label: "Modo", type: "select", options: [
        { value: "delivery", label: "Entrega" }, { value: "pickup", label: "Levantamento" }, { value: "direct", label: "Direto" },
      ]},
      { key: "fulfillment_status", label: "Fulfillment", type: "select", options: FULFILLMENT_OPTIONS },
      { key: "payment_status", label: "Pagamento", type: "select", options: [
        { value: "pending", label: "Pendente" }, { value: "partial", label: "Parcial" }, { value: "paid", label: "Pago" },
      ]},
      { key: "invoice_status", label: "Fatura", type: "select", options: [
        { value: "pending", label: "Pendente" }, { value: "invoiced", label: "Faturado" },
      ]},
      { key: "operational_status", label: "Operacional", type: "select", options: [
        { value: "new", label: "Novo" },
        { value: "in_progress", label: "Em curso" },
        { value: "ready", label: "Pronto" },
        { value: "delivered", label: "Entregue" },
        { value: "done", label: "Concluído" },
        { value: "blocked", label: "Bloqueado" },
      ]},
      { key: "schedule", label: "Agendamento", type: "select", options: [
        { value: "none", label: "Sem agendamento" },
        { value: "confirmed", label: "Confirmado" },
        { value: "pending", label: "Pendente" },
      ]},
      { key: "route_assigned", label: "Rota", type: "select", options: [
        { value: "yes", label: "Com rota" }, { value: "no", label: "Sem rota" },
      ]},
      { key: "slot_assigned", label: "Janela horária", type: "select", options: [
        { value: "yes", label: "Com janela" }, { value: "no", label: "Sem janela" },
      ]},
      { key: "assembly", label: "Montagem", type: "select", options: [
        { value: "yes", label: "Sim" }, { value: "no", label: "Não" },
      ]},
      { key: "include_delivery", label: "Inclui entrega", type: "select", options: [
        { value: "yes", label: "Sim" }, { value: "no", label: "Não" },
      ]},
      { key: "zone", label: "Zona de entrega", type: "text" },
      { key: "delivery_from", label: "Entrega de", type: "date" },
      { key: "delivery_to", label: "Entrega até", type: "date" },
      { key: "scheduled_from", label: "Agendada de", type: "date" },
      { key: "scheduled_to", label: "Agendada até", type: "date" },
      { key: "from", label: "Data pedido de", type: "date" },
      { key: "to", label: "Data pedido até", type: "date" },
      { key: "min_total", label: "Total mínimo", type: "text" },
      { key: "max_total", label: "Total máximo", type: "text" },
    ]}
    applyFilter={(q, v) => {
      if (v.state) q = q.eq("state", v.state);
      if (v.delivery_mode) q = q.eq("delivery_mode", v.delivery_mode);
      if (v.fulfillment_status) q = q.eq("fulfillment_status", v.fulfillment_status);
      if (v.payment_status) q = q.eq("payment_status", v.payment_status);
      if (v.invoice_status) q = q.eq("invoice_status", v.invoice_status);
      if (v.operational_status) q = q.eq("operational_status", v.operational_status);
      if (v.schedule === "none") q = q.is("scheduled_date", null);
      if (v.schedule === "confirmed") q = q.eq("schedule_confirmed", true);
      if (v.schedule === "pending") q = q.eq("schedule_confirmed", false);
      if (v.route_assigned === "yes") q = q.not("route_id", "is", null);
      if (v.route_assigned === "no") q = q.is("route_id", null);
      if (v.slot_assigned === "yes") q = q.not("slot_start", "is", null);
      if (v.slot_assigned === "no") q = q.is("slot_start", null);
      if (v.assembly === "yes") q = q.eq("include_assembly", true);
      if (v.assembly === "no") q = q.eq("include_assembly", false);
      if (v.include_delivery === "yes") q = q.eq("include_delivery", true);
      if (v.include_delivery === "no") q = q.eq("include_delivery", false);
      if (v.zone) q = q.ilike("delivery_zone_label", `%${v.zone}%`);
      if (v.delivery_from) q = q.gte("commitment_date", v.delivery_from);
      if (v.delivery_to) q = q.lte("commitment_date", v.delivery_to);
      if (v.scheduled_from) q = q.gte("scheduled_date", v.scheduled_from);
      if (v.scheduled_to) q = q.lte("scheduled_date", v.scheduled_to);
      if (v.from) q = q.gte("date_order", v.from);
      if (v.to) q = q.lte("date_order", v.to + "T23:59:59");
      if (v.min_total) q = q.gte("amount_total", Number(v.min_total));
      if (v.max_total) q = q.lte("amount_total", Number(v.max_total));
      return q;
    }}
    columns={[
      { key: "name", header: "Número", sortable: true, alwaysVisible: true },
      { key: "state", header: "Estado", sortable: true, render: (r: any) => <StateBadge value={r.state} /> },
      { key: "delivery_mode", header: "Modo", render: (r: any) => r.delivery_mode === "pickup" ? "Levantamento" : r.delivery_mode === "direct" ? "Direto" : "Entrega" },
      { key: "commitment_date", header: "Data entrega", sortable: true, render: (r: any) => r.commitment_date ? new Date(r.commitment_date).toLocaleDateString("pt-PT") : "—" },
      { key: "scheduled_date", header: "Data agendada", sortable: true, render: (r: any) => r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString("pt-PT") : "—" },
      { key: "slot", header: "Janela", render: (r: any) => r.slot_start && r.slot_end ? `${String(r.slot_start).slice(0,5)}–${String(r.slot_end).slice(0,5)}` : "—" },
      { key: "schedule_confirmed", header: "Confirmado", render: (r: any) => r.scheduled_date ? (r.schedule_confirmed ? "✓" : "Pendente") : "—" },
      { key: "route", header: "Rota", render: (r: any) => r.route_id ? <Link to={`/routes/${r.route_id}`} className="text-primary hover:underline text-xs">{r.route_date ?? "Rota"}</Link> : "—" },
      { key: "include_assembly", header: "Montagem", defaultVisible: false, render: (r: any) => r.include_assembly ? "Sim" : "Não" },
      { key: "fulfillment_status", header: "Fulfillment", render: (r: any) => <FulfillmentBadge status={r.fulfillment_status} /> },
      { key: "payment_status", header: "Pagamento", render: (r: any) => <PaymentStatusBadge status={r.payment_status} /> },
      { key: "invoice_status", header: "Fatura", defaultVisible: false, render: (r: any) => <InvoiceStatusBadge status={r.invoice_status} /> },
      { key: "date_order", header: "Data pedido", sortable: true, defaultVisible: false, render: (r: any) => r.date_order ? new Date(r.date_order).toLocaleDateString("pt-PT") : "—" },
      { key: "amount_total", header: "Total", sortable: true, render: (r: any) => `${fmtMoney(r.amount_total)}` },
    ]}
  />
);

export const CustomersList = () => (
  <ListView
    title="Clientes"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Clientes" }]}
    table="partners"
    searchColumn="name"
    createTo="/sales/customers/new"
    rowLink={(r: any) => `/sales/customers/${r.id}`}
    filter={(q) => q.eq("is_customer", true)}
    columns={[
      { key: "name", header: "Nome", sortable: true },
      { key: "tax_id", header: "NIF" },
      { key: "email", header: "E-mail" },
      { key: "phone", header: "Telefone" },
      { key: "zip", header: "Cód. Postal" },
      { key: "city", header: "Localidade" },
      { key: "state", header: "Distrito" },
    ]}
  />
);

export const PricelistsList = () => (
  <ListView
    title="Tabelas de Preço"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Tabelas de Preço" }]}
    table="pricelists"
    searchColumn="name"
    createTo="/sales/pricelists/new"
    rowLink={(r: any) => `/sales/pricelists/${r.id}`}
    columns={[
      { key: "name", header: "Nome", sortable: true },
      { key: "currency", header: "Moeda" },
    ]}
  />
);
