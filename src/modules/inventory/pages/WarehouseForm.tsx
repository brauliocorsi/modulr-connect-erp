import { SimpleForm } from "@/core/layout/SimpleForm";

const STEP_OPTS = [
  { value: "one_step", label: "1 etapa (direto)" },
  { value: "two_steps", label: "2 etapas (Cais de Carga)" },
  { value: "three_steps", label: "3 etapas (Cais + Carrinha)" },
];

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
        { name: "delivery_steps", label: "Etapas de saída", type: "select", options: STEP_OPTS, default: "one_step" },
        { name: "reception_steps", label: "Etapas de receção", type: "select", options: STEP_OPTS, default: "one_step" },
        { name: "is_store", label: "É Loja (ponto de venda)", type: "boolean", default: false },
        { name: "active", label: "Ativo", type: "boolean", default: true },
      ]}
    />
  );
}
