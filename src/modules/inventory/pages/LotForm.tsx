import { SimpleForm } from "@/core/layout/SimpleForm";

export default function LotForm() {
  return (
    <SimpleForm
      table="stock_lots"
      title="Lote / Série"
      basePath="/inventory/lots"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Lotes", to: "/inventory/lots" }, { label: "Editar" }]}
      fields={[
        { name: "name", label: "Lote/Série", required: true },
        { name: "product_id", label: "Produto", type: "select", required: true, optionsFrom: { table: "products", value: "id", label: "name" } },
        { name: "expiration_date", label: "Validade", type: "date" },
      ]}
    />
  );
}
