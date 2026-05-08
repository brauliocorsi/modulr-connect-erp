import { SimpleForm } from "@/core/layout/SimpleForm";

export default function StoreForm() {
  return (
    <SimpleForm
      table="stores"
      title="Loja"
      basePath="/settings/stores"
      breadcrumb={[
        { label: "Configurações", to: "/settings/apps" },
        { label: "Lojas", to: "/settings/stores" },
        { label: "Editar" },
      ]}
      fields={[
        { name: "code", label: "Código", required: true },
        { name: "name", label: "Nome", required: true },
        { name: "active", label: "Ativa", type: "boolean", default: true },
        {
          name: "warehouse_id",
          label: "Armazém",
          type: "select",
          optionsFrom: { table: "warehouses", value: "id", label: "name" },
        },
        {
          name: "manager_id",
          label: "Gestor (colaborador)",
          type: "select",
          optionsFrom: { table: "hr_employees", value: "id", label: "full_name" },
        },
        { name: "phone", label: "Telefone" },
        { name: "email", label: "Email" },
        { name: "tax_id", label: "NIF" },
        { name: "street", label: "Morada", span: 2 },
        { name: "city", label: "Cidade" },
        { name: "zip", label: "Código Postal" },
        { name: "country", label: "País", default: "PT" },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
