import { SimpleForm } from "@/core/layout/SimpleForm";

export default function PricelistForm() {
  return (
    <SimpleForm
      table="pricelists"
      title="Tabela de Preço"
      basePath="/sales/pricelists"
      breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Tabelas de Preço", to: "/sales/pricelists" }, { label: "Editar" }]}
      fields={[
        { name: "name", label: "Nome", required: true },
        { name: "currency", label: "Moeda", default: "EUR" },
        { name: "active", label: "Ativa", type: "boolean", default: true },
      ]}
    />
  );
}
