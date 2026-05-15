import { ListView } from "@/core/layout/ListView";
import { MOStateBadge, MOPriorityBadge } from "../components/MOBadges";
import { MOOriginBadge } from "../components/MOOriginBadge";
import CreateManualMODialog from "../components/CreateManualMODialog";
import { fmtDate } from "@/lib/format";

export default function ManufacturingOrdersList() {
  return (
    <ListView<any>
      title="Ordens de Fabricação"
      breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Ordens" }]}
      table="manufacturing_orders"
      select="id,code,state,priority,origin,qty,due_date,created_at,product:products(name),partner:partners(name),sale:sale_orders(name)"
      searchColumn="code"
      orderBy="created_at"
      rowLink={(r) => `/manufacturing/orders/${r.id}`}
      actions={<CreateManualMODialog />}
      columns={[
        { key: "code", header: "Código", sortable: true },
        { key: "product", header: "Produto", render: (r) => r.product?.name ?? "—" },
        { key: "origin", header: "Origem", render: (r) => <MOOriginBadge origin={r.origin} /> },
        { key: "partner", header: "Cliente", render: (r) => r.partner?.name ?? "—" },
        { key: "sale", header: "Venda", render: (r) => r.sale?.name ?? "—" },
        { key: "qty", header: "Qtd", render: (r) => Number(r.qty) },
        { key: "due_date", header: "Prazo", sortable: true, render: (r) => fmtDate(r.due_date) },
        { key: "priority", header: "Prioridade", render: (r) => <MOPriorityBadge priority={r.priority} /> },
        { key: "state", header: "Estado", render: (r) => <MOStateBadge state={r.state} /> },
      ]}
    />
  );
}
