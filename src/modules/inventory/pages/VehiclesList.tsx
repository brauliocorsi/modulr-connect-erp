import { ListView } from "@/core/layout/ListView";

export default function VehiclesList() {
  return (
    <ListView
      title="Carrinhas / Veículos"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Carrinhas" }]}
      table="vehicles"
      select="id, name, license_plate, barcode, active, usable_volume_m3, volume_m3, max_stops, assembly_minutes_capacity, cash_registers(name)"
      searchColumn="name"
      createTo="/inventory/vehicles/new"
      rowLink={(r: any) => `/inventory/vehicles/${r.id}`}
      columns={[
        { key: "name", header: "Nome" },
        { key: "license_plate", header: "Matrícula" },
        {
          key: "volume",
          header: "Volume útil (m³)",
          render: (r: any) => {
            const v = r.usable_volume_m3 ?? r.volume_m3;
            return v == null ? <span className="text-muted-foreground">—</span> : Number(v).toFixed(2);
          },
        },
        { key: "max_stops", header: "Paragens", render: (r: any) => r.max_stops ?? "—" },
        {
          key: "assembly",
          header: "Montagem (min)",
          render: (r: any) => r.assembly_minutes_capacity ?? "—",
        },
        { key: "cash_register", header: "Caixa", render: (r: any) => r.cash_registers?.name ?? "—" },
        { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
      ]}
    />
  );
}
