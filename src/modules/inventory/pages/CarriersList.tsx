import { ListView } from "@/core/layout/ListView";

export default function CarriersList() {
  return (
    <ListView
      title="Transportadoras"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transportadoras" }]}
      table="delivery_carriers"
      select="id, name, contact, phone, tracking_url_template, active"
      searchColumn="name"
      createTo="/inventory/carriers/new"
      rowLink={(r: any) => `/inventory/carriers/${r.id}`}
      columns={[
        { key: "name", header: "Nome" },
        { key: "contact", header: "Contacto" },
        { key: "phone", header: "Telefone" },
        { key: "active", header: "Ativa", render: (r: any) => (r.active ? "Sim" : "Não") },
      ]}
    />
  );
}
