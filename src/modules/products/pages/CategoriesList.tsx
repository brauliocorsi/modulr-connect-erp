import { ListView } from "@/core/layout/ListView";

export default function CategoriesList() {
  return (
    <ListView
      title="Categorias de Produto"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Categorias" }]}
      table="product_categories"
      searchColumn="name"
      createTo="/products/categories/new"
      rowLink={(r: any) => `/products/categories/${r.id}`}
      columns={[
        { key: "name", header: "Nome" },
        { key: "removal_strategy", header: "Estratégia de saída" },
      ]}
    />
  );
}
