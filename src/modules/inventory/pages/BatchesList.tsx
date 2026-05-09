import { ListView } from "@/core/layout/ListView";
import { stateLabel } from "@/lib/picking";

const STATE_VARIANTS: Record<string, string> = {
  draft: "secondary",
  in_progress: "default",
  done: "default",
  cancelled: "destructive",
};

export default function BatchesList() {
  return (
    <ListView
      title="Lotes (Batch picking)"
      breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Lotes" }]}
      table="stock_picking_batches"
      searchColumn="name"
      rowLink={(r: any) => `/inventory/batches/${r.id}`}
      columns={[
        { key: "name", header: "Referência" },
        { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{stateLabel(r.state)}</span> },
        { key: "scheduled_at", header: "Programado", render: (r: any) => r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—" },
        { key: "notes", header: "Notas", render: (r: any) => r.notes ?? "—" },
      ]}
    />
  );
}
