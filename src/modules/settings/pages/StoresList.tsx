import { ListView } from "@/core/layout/ListView";
import { Badge } from "@/components/ui/badge";

type StoreRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  active: boolean;
  warehouse: { name: string } | null;
  manager: { full_name: string } | null;
};

export default function StoresList() {
  return (
    <ListView<StoreRow>
      title="Lojas"
      breadcrumb={[
        { label: "Configurações", to: "/settings/apps" },
        { label: "Lojas" },
      ]}
      table="stores"
      select="id,code,name,city,active,warehouse:warehouses(name),manager:hr_employees(full_name)"
      searchColumn="name"
      createTo="/settings/stores/new"
      orderBy="name"
      ascending
      columns={[
        { key: "code", header: "Código" },
        { key: "name", header: "Nome" },
        { key: "city", header: "Cidade", render: (r) => r.city ?? "—" },
        { key: "warehouse", header: "Armazém", render: (r) => r.warehouse?.name ?? "—" },
        { key: "manager", header: "Gestor", render: (r) => r.manager?.full_name ?? "—" },
        {
          key: "active",
          header: "Estado",
          render: (r) => (
            <Badge variant={r.active ? "default" : "secondary"}>
              {r.active ? "Ativa" : "Inativa"}
            </Badge>
          ),
        },
      ]}
      rowLink={(r) => `/settings/stores/${r.id}`}
    />
  );
}
