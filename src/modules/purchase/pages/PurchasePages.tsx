import { ListView } from "@/core/layout/ListView";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { LayoutGrid } from "lucide-react";

export const PurchaseOrdersList = () => (
  <ListView
    title="Pedidos de Compra"
    breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Pedidos" }]}
    table="purchase_orders"
    select="id, name, state, date_order, amount_total, partners(name)"
    searchColumn="name"
    createTo="/purchase/orders/new"
    rowLink={(r: any) => `/purchase/orders/${r.id}`}
    actions={
      <Button asChild size="sm" variant="outline">
        <Link to="/purchase/kanban"><LayoutGrid className="h-4 w-4 mr-1" /> Kanban</Link>
      </Button>
    }
    columns={[
      { key: "name", header: "Número" },
      { key: "partner", header: "Fornecedor", render: (r: any) => r.partners?.name },
      { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{r.state}</span> },
      { key: "amount_total", header: "Total", render: (r: any) => `${fmtMoney(r.amount_total)}` },
    ]}
  />
);

export const SuppliersList = () => (
  <ListView
    title="Fornecedores"
    breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Fornecedores" }]}
    table="partners"
    searchColumn="name"
    createTo="/purchase/suppliers/new"
    rowLink={(r: any) => `/purchase/suppliers/${r.id}`}
    filter={(q) => q.eq("is_supplier", true)}
    columns={[
      { key: "name", header: "Nome" },
      { key: "email", header: "E-mail" },
      { key: "phone", header: "Telefone" },
      { key: "city", header: "Cidade" },
    ]}
  />
);
