import { ListView } from "@/core/layout/ListView";
import { stateLabel } from "@/lib/picking";

export default function WavesList() {
  return (
    <ListView
      title="Ondas (Wave picking)"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ondas" }]}
      table="stock_picking_waves"
      searchColumn="name"
      rowLink={(r: any) => `/inventory/waves/${r.id}`}
      columns={[
        { key: "name", header: "Referência" },
        { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{stateLabel(r.state)}</span> },
        { key: "scheduled_at", header: "Programado", render: (r: any) => r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—" },
      ]}
    />
  );
}
