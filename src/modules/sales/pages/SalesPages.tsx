import { fmtMoney } from "@/lib/format";
import { ListView } from "@/core/layout/ListView";
import { FulfillmentBadge, FULFILLMENT_OPTIONS } from "@/core/orders/FulfillmentBadge";
import { PaymentStatusBadge } from "@/core/orders/PaymentStatusBadge";
import { InvoiceStatusBadge } from "@/core/orders/InvoiceStatusBadge";
import { StateBadge } from "@/core/layout/StateBadge";

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
  <ListView
    title="Pedidos de Venda"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Pedidos" }]}
    table="sale_orders"
    select="id, name, state, fulfillment_status, payment_status, invoice_status, date_order, commitment_date, amount_total, partners(name)"
    searchColumn="name"
    createTo="/sales/orders/new"
    rowLink={(r: any) => `/sales/orders/${r.id}`}
    filter={(q) => q.in("state", ["confirmed", "done"])}
    filters={[
      { key: "state", label: "Estado", type: "select", options: SALE_STATE_OPTS.filter((s) => ["confirmed","done"].includes(s.value)) },
      { key: "fulfillment_status", label: "Fulfillment", type: "select", options: FULFILLMENT_OPTIONS },
      { key: "payment_status", label: "Pagamento", type: "select", options: [
        { value: "pending", label: "Pendente" }, { value: "partial", label: "Parcial" }, { value: "paid", label: "Pago" },
      ]},
      { key: "invoice_status", label: "Fatura", type: "select", options: [
        { value: "pending", label: "Pendente" }, { value: "invoiced", label: "Faturado" },
      ]},
      { key: "from", label: "Data de", type: "date" },
      { key: "to", label: "Data até", type: "date" },
      { key: "delivery_from", label: "Entrega de", type: "date" },
      { key: "delivery_to", label: "Entrega até", type: "date" },
      { key: "min_total", label: "Total mínimo", type: "text" },
    ]}
    applyFilter={(q, v) => {
      if (v.state) q = q.eq("state", v.state);
      if (v.fulfillment_status) q = q.eq("fulfillment_status", v.fulfillment_status);
      if (v.payment_status) q = q.eq("payment_status", v.payment_status);
      if (v.invoice_status) q = q.eq("invoice_status", v.invoice_status);
      if (v.from) q = q.gte("date_order", v.from);
      if (v.to) q = q.lte("date_order", v.to + "T23:59:59");
      if (v.delivery_from) q = q.gte("commitment_date", v.delivery_from);
      if (v.delivery_to) q = q.lte("commitment_date", v.delivery_to);
      if (v.min_total) q = q.gte("amount_total", Number(v.min_total));
      return q;
    }}
    columns={[
      { key: "name", header: "Número", sortable: true },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name },
      { key: "state", header: "Estado", sortable: true, render: (r: any) => <StateBadge value={r.state} /> },
      { key: "commitment_date", header: "Entrega", sortable: true, render: (r: any) => r.commitment_date ? new Date(r.commitment_date).toLocaleDateString("pt-PT") : "—" },
      { key: "fulfillment_status", header: "Fulfillment", render: (r: any) => <FulfillmentBadge status={r.fulfillment_status} /> },
      { key: "payment_status", header: "Pagamento", render: (r: any) => <PaymentStatusBadge status={r.payment_status} /> },
      { key: "invoice_status", header: "Fatura", render: (r: any) => <InvoiceStatusBadge status={r.invoice_status} /> },
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
