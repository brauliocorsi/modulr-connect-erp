import { ListView } from "@/core/layout/ListView";
import { StateBadge } from "@/core/layout/StateBadge";

const STATE_OPTS = [
  { value: "draft", label: "Rascunho" },
  { value: "in_progress", label: "Em separação" },
  { value: "done", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

export default function WavesList() {
  return (
    <ListView
      title="Ondas (Wave picking)"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ondas" }]}
      table="stock_picking_waves"
      searchColumn="name"
      createTo="/inventory/waves/new"
      rowLink={(r: any) => `/inventory/waves/${r.id}`}
      filters={[
        { key: "state", label: "Estado", type: "select", options: STATE_OPTS },
        { key: "from", label: "De", type: "date" },
        { key: "to", label: "Até", type: "date" },
      ]}
      applyFilter={(q, v) => {
        if (v.state) q = q.eq("state", v.state);
        if (v.from) q = q.gte("scheduled_at", v.from);
        if (v.to) q = q.lte("scheduled_at", v.to + "T23:59:59");
        return q;
      }}
      columns={[
        { key: "name", header: "Referência", sortable: true },
        { key: "state", header: "Estado", sortable: true, render: (r: any) => <StateBadge value={r.state} /> },
        { key: "scheduled_at", header: "Programado", sortable: true, render: (r: any) => r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—" },
      ]}
    />
  );
}
