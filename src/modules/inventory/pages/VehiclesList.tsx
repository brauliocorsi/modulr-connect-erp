import { ListView } from "@/core/layout/ListView";

export default function VehiclesList() {
  return (
    <ListView
      title="Carrinhas / Veículos"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Carrinhas" }]}
      table="vehicles"
      select="id, name, license_plate, barcode, active, cash_registers(name)"
      searchColumn="name"
      createTo="/inventory/vehicles/new"
      rowLink={(r: any) => `/inventory/vehicles/${r.id}`}
      columns={[
        { key: "name", header: "Nome" },
        { key: "license_plate", header: "Matrícula" },
        { key: "barcode", header: "Código de barras" },
        { key: "cash_register", header: "Caixa", render: (r: any) => r.cash_registers?.name ?? "—" },
        { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
      ]}
    />
  );
}
