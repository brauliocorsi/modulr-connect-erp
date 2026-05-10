import { ListView } from "@/core/layout/ListView";

export { PurchaseOrdersList } from "./PurchaseOrdersList";



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
      { key: "tax_id", header: "NIF" },
      { key: "email", header: "E-mail" },
      { key: "phone", header: "Telefone" },
      { key: "zip", header: "Cód. Postal" },
      { key: "city", header: "Localidade" },
      { key: "state", header: "Distrito" },
    ]}
  />
);
