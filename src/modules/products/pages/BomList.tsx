import { ListView } from "@/core/layout/ListView";

export default function BomList() {
  return (
    <ListView
      title="Listas de Materiais (BOM)"
      breadcrumb={[{ label: "Produtos", to: "/products" }, { label: "BOM" }]}
      table="boms"
      select="id, code, type, quantity, products(name)"
      searchColumn="code"
      createTo="/products/bom/new"
      rowLink={(r: any) => `/products/bom/${r.id}`}
      columns={[
        { key: "code", header: "Código" },
        { key: "product", header: "Produto", render: (r: any) => r.products?.name },
        { key: "type", header: "Tipo" },
        { key: "quantity", header: "Qtd" },
      ]}
    />
  );
}
