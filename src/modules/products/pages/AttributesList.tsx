import { ListView } from "@/core/layout/ListView";

export default function AttributesList() {
  return (
    <ListView
      title="Atributos"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Atributos" }]}
      table="product_attributes"
      searchColumn="name"
      createTo="/products/attributes/new"
      rowLink={(r: any) => `/products/attributes/${r.id}`}
      columns={[
        { key: "name", header: "Nome" },
        { key: "display_type", header: "Exibição" },
      ]}
    />
  );
}
