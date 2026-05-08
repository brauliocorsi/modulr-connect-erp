import { SimpleForm } from "@/core/layout/SimpleForm";

export default function WarehouseForm() {
  return (
    <SimpleForm
      table="warehouses"
      title="Armazém"
      basePath="/inventory/warehouses"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Armazéns", to: "/inventory/warehouses" }, { label: "Editar" }]}
      fields={[
        { name: "code", label: "Código", required: true },
        { name: "name", label: "Nome", required: true },
        { name: "address", label: "Endereço", span: 2 },
        { name: "is_store", label: "É Loja (ponto de venda)", type: "boolean", default: false },
        { name: "active", label: "Ativo", type: "boolean", default: true },
      ]}
    />
  );
}
