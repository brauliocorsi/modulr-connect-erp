import { LucideIcon, Package, ShoppingCart, ShoppingBag, Warehouse, Settings } from "lucide-react";
import type { ModuleId } from "@/core/permissions/usePermissions";

export type ModuleMenuItem = {
  label: string;
  to: string;
  icon?: LucideIcon;
  section?: string;
};

export type ModuleDef = {
  id: ModuleId | "settings";
  name: string;
  shortName: string;
  icon: LucideIcon;
  color: string; // tailwind bg color class
  basePath: string;
  description: string;
  menu: ModuleMenuItem[];
};

export const MODULES: ModuleDef[] = [
  {
    id: "sales",
    name: "Vendas",
    shortName: "Vendas",
    icon: ShoppingCart,
    color: "bg-[hsl(263_67%_56%)]",
    basePath: "/sales",
    description: "Cotações, pedidos, clientes e pipeline",
    menu: [
      { section: "Vendas", label: "Cotações", to: "/sales/quotations" },
      { section: "Vendas", label: "Pedidos", to: "/sales/orders" },
      { section: "Cadastros", label: "Clientes", to: "/sales/customers" },
      { section: "Configuração", label: "Tabelas de Preço", to: "/sales/pricelists" },
      { section: "Relatórios", label: "Vendas por Estado", to: "/reports/sales" },
    ],
  },
  {
    id: "purchase",
    name: "Compras",
    shortName: "Compras",
    icon: ShoppingBag,
    color: "bg-[hsl(217_91%_60%)]",
    basePath: "/purchase",
    description: "RFQs, pedidos de compra e fornecedores",
    menu: [
      { section: "Compras", label: "Pedidos de Compra", to: "/purchase/orders" },
      { section: "Compras", label: "Kanban RFQ", to: "/purchase/kanban" },
      { section: "Cadastros", label: "Fornecedores", to: "/purchase/suppliers" },
      { section: "Relatórios", label: "Compras por Estado", to: "/reports/purchase" },
    ],
  },
  {
    id: "inventory",
    name: "Inventário",
    shortName: "Stock",
    icon: Warehouse,
    color: "bg-[hsl(142_71%_38%)]",
    basePath: "/inventory",
    description: "Operações WMS, transferências e regras de stock",
    menu: [
      { section: "Operações", label: "Visão Geral", to: "/inventory" },
      { section: "Operações", label: "Transferências", to: "/inventory/transfers" },
      { section: "Operações", label: "Ajustes", to: "/inventory/adjustments" },
      { section: "Relatórios", label: "Kardex", to: "/inventory/kardex" },
      { section: "Relatórios", label: "Stock por Produto", to: "/reports/stock" },
      { section: "Relatórios", label: "Lotes/Séries", to: "/inventory/lots" },
      { section: "Configuração", label: "Armazéns", to: "/inventory/warehouses" },
      { section: "Configuração", label: "Locais", to: "/inventory/locations" },
      { section: "Configuração", label: "Regras de Reabastecimento", to: "/inventory/reordering" },
    ],
  },
  {
    id: "products",
    name: "Produtos",
    shortName: "Produtos",
    icon: Package,
    color: "bg-[hsl(38_92%_50%)]",
    basePath: "/products",
    description: "Catálogo, variantes e BOM",
    menu: [
      { section: "Catálogo", label: "Produtos", to: "/products" },
      { section: "Catálogo", label: "Categorias", to: "/products/categories" },
      { section: "Catálogo", label: "Atributos", to: "/products/attributes" },
      { section: "Engenharia", label: "Listas de Materiais (BOM)", to: "/products/bom" },
    ],
  },
  {
    id: "settings",
    name: "Configurações",
    shortName: "Config",
    icon: Settings,
    color: "bg-[hsl(222_22%_30%)]",
    basePath: "/settings",
    description: "Empresa, usuários, grupos, módulos",
    menu: [
      { section: "Geral", label: "Apps Instalados", to: "/settings/apps" },
      { section: "Usuários", label: "Usuários", to: "/settings/users" },
      { section: "Usuários", label: "Grupos & Permissões", to: "/settings/groups" },
      { section: "Empresa", label: "Empresa", to: "/settings/company" },
    ],
  },
];

export const getModuleByPath = (pathname: string) =>
  MODULES.find((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/")) ?? null;
