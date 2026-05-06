import { ListView } from "@/core/layout/ListView";

export default function ProductsList() {
  return (
    <ListView
      title="Produtos"
      breadcrumb={[{ label: "Produtos" }]}
      table="products"
      searchColumn="name"
      createTo="/products/new"
      rowLink={(r: any) => `/products/${r.id}`}
      columns={[
        { key: "internal_ref", header: "Ref" },
        { key: "name", header: "Nome" },
        { key: "type", header: "Tipo" },
        {
          key: "list_price",
          header: "Preço",
          render: (r: any) => `R$ ${Number(r.list_price ?? 0).toFixed(2)}`,
        },
        {
          key: "standard_cost",
          header: "Custo",
          render: (r: any) => `R$ ${Number(r.standard_cost ?? 0).toFixed(2)}`,
        },
      ]}
    />
  );
}
