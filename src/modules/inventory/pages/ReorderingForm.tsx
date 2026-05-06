import { SimpleForm } from "@/core/layout/SimpleForm";

export default function ReorderingForm() {
  return (
    <SimpleForm
      table="reordering_rules"
      title="Regra de Reabastecimento"
      basePath="/inventory/reordering"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Reabastecimento", to: "/inventory/reordering" }, { label: "Editar" }]}
      fields={[
        { name: "product_id", label: "Produto", type: "select", required: true, optionsFrom: { table: "products", value: "id", label: "name" } },
        { name: "warehouse_id", label: "Armazém", type: "select", required: true, optionsFrom: { table: "warehouses", value: "id", label: "name" } },
        { name: "min_qty", label: "Mínimo", type: "number", default: 0, required: true },
        { name: "max_qty", label: "Máximo", type: "number", default: 0, required: true },
        { name: "multiple_qty", label: "Múltiplo", type: "number", default: 1 },
        { name: "active", label: "Ativo", type: "boolean", default: true },
      ]}
    />
  );
}
