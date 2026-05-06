import { SimpleForm } from "@/core/layout/SimpleForm";

export default function CategoryForm() {
  return (
    <SimpleForm
      table="product_categories"
      title="Categoria"
      basePath="/products/categories"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "Categorias", to: "/products/categories" }, { label: "Editar" }]}
      fields={[
        { name: "name", label: "Nome", required: true },
        { name: "parent_id", label: "Categoria Pai", type: "select", optionsFrom: { table: "product_categories", value: "id", label: "name" } },
        { name: "removal_strategy", label: "Estratégia de saída", type: "select", default: "fifo", options: [
          { value: "fifo", label: "FIFO" }, { value: "lifo", label: "LIFO" }, { value: "fefo", label: "FEFO" }, { value: "closest", label: "Mais próximo" },
        ] },
      ]}
    />
  );
}
