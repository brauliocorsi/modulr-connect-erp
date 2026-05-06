import { ListView } from "@/core/layout/ListView";

export default function CategoriesList() {
  return (
    <ListView
      title="Categorias de Produto"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Categorias" }]}
      table="product_categories"
      searchColumn="name"
      columns={[
        { key: "name", header: "Nome" },
        { key: "removal_strategy", header: "Estratégia de saída" },
      ]}
    />
  );
}
