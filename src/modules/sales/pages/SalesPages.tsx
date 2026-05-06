import { ListView } from "@/core/layout/ListView";

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
    columns={[
      { key: "name", header: "Número" },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name },
      { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{r.state}</span> },
      { key: "amount_total", header: "Total", render: (r: any) => `${fmtMoney(r.amount_total)}` },
    ]}
  />
);

export const SalesOrdersList = () => (
  <ListView
    title="Pedidos de Venda"
    breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Pedidos" }]}
    table="sale_orders"
    select="id, name, state, date_order, amount_total, partners(name)"
    searchColumn="name"
    createTo="/sales/orders/new"
    rowLink={(r: any) => `/sales/orders/${r.id}`}
    filter={(q) => q.in("state", ["confirmed", "done"])}
    columns={[
      { key: "name", header: "Número" },
      { key: "partner", header: "Cliente", render: (r: any) => r.partners?.name },
      { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{r.state}</span> },
      { key: "amount_total", header: "Total", render: (r: any) => `${fmtMoney(r.amount_total)}` },
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
      { key: "name", header: "Nome" },
      { key: "email", header: "E-mail" },
      { key: "phone", header: "Telefone" },
      { key: "city", header: "Cidade" },
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
      { key: "name", header: "Nome" },
      { key: "currency", header: "Moeda" },
    ]}
  />
);

