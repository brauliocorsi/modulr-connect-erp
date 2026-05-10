import { SimpleForm } from "@/core/layout/SimpleForm";

export default function CarrierForm() {
  return (
    <SimpleForm
      table="delivery_carriers"
      title="Transportadora"
      basePath="/inventory/carriers"
      breadcrumb={[
        { label: "Inventário", to: "/inventory" },
        { label: "Transportadoras", to: "/inventory/carriers" },
        { label: "Editar" },
      ]}
      fields={[
        { name: "name", label: "Nome (ex: CTT, Chronopost)", required: true },
        { name: "contact", label: "Pessoa de contacto" },
        { name: "phone", label: "Telefone" },
        { name: "tracking_url_template", label: "URL de tracking (use {ref})", span: 2 },
        { name: "active", label: "Ativa", type: "boolean", default: true },
      ]}
    />
  );
}
