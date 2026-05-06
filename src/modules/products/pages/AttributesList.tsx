import { ListView } from "@/core/layout/ListView";

export default function AttributesList() {
  return (
    <ListView
      title="Atributos"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Atributos" }]}
      table="product_attributes"
      searchColumn="name"
      columns={[
        { key: "name", header: "Nome" },
        { key: "display_type", header: "Exibição" },
      ]}
    />
  );
}
