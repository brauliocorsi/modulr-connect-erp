import { SimpleForm } from "@/core/layout/SimpleForm";

export default function LocationForm() {
  return (
    <SimpleForm
      table="stock_locations"
      title="Local"
      basePath="/inventory/locations"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Locais", to: "/inventory/locations" }, { label: "Editar" }]}
      fields={[
        { name: "name", label: "Nome", required: true },
        { name: "type", label: "Tipo", type: "select", required: true, default: "internal", options: [
          { value: "internal", label: "Interno" },
          { value: "supplier", label: "Fornecedor" },
          { value: "customer", label: "Cliente" },
          { value: "transit", label: "Trânsito" },
          { value: "inventory", label: "Inventário" },
          { value: "scrap", label: "Sucata" },
          { value: "view", label: "View" },
        ] },
        { name: "warehouse_id", label: "Armazém", type: "select", optionsFrom: { table: "warehouses", value: "id", label: "name" } },
        { name: "parent_id", label: "Local Pai", type: "select", optionsFrom: { table: "stock_locations", value: "id", label: "name" } },
        { name: "is_zone", label: "É zona", type: "boolean" },
        { name: "is_bin", label: "É bin/posição", type: "boolean" },
        { name: "active", label: "Ativo", type: "boolean", default: true },
      ]}
    />
  );
}
