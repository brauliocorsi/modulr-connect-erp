import { LucideIcon, Package, ShoppingCart, ShoppingBag, Warehouse, Settings, MessageSquare, Users, Wallet, Banknote, Truck } from "lucide-react";
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
      { section: "Configuração", label: "Regras de Entrega", to: "/sales/delivery-rules" },
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
      { section: "Operações", label: "Cronograma", to: "/inventory/schedule" },
      { section: "Operações", label: "Recebimentos", to: "/inventory/receipts" },
      { section: "Operações", label: "Transferências", to: "/inventory/transfers" },
      { section: "Operações", label: "Lotes (Batch)", to: "/inventory/batches" },
      { section: "Operações", label: "Ondas (Wave)", to: "/inventory/waves" },
      { section: "Operações", label: "Códigos de Barras (App)", to: "/barcode" },
      { section: "Operações", label: "Movimentos", to: "/inventory/moves" },
      { section: "Operações", label: "Ajustes", to: "/inventory/adjustments" },
      { section: "Relatórios", label: "Kardex", to: "/inventory/kardex" },
      { section: "Relatórios", label: "Stock por Produto", to: "/reports/stock" },
      { section: "Relatórios", label: "Lotes/Séries", to: "/inventory/lots" },
      { section: "Configuração", label: "Armazéns", to: "/inventory/warehouses" },
      { section: "Configuração", label: "Locais", to: "/inventory/locations" },
      { section: "Configuração", label: "Carrinhas / Veículos", to: "/inventory/vehicles" },
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
    id: "hr" as any,
    name: "Recursos Humanos",
    shortName: "RH",
    icon: Users,
    color: "bg-[hsl(340_82%_52%)]",
    basePath: "/hr",
    description: "Colaboradores, ausências e assiduidade",
    menu: [
      { section: "Pessoas", label: "Colaboradores", to: "/hr/employees" },
      { section: "Pessoas", label: "Departamentos", to: "/hr/departments" },
      { section: "Assiduidade", label: "Relógio de Ponto", to: "/hr/attendance" },
      { section: "Assiduidade", label: "Registos", to: "/hr/attendances" },
      { section: "Ausências", label: "Pedidos", to: "/hr/leaves" },
    ],
  },
  {
    id: "finance" as any,
    name: "Financeiro",
    shortName: "Financeiro",
    icon: Wallet,
    color: "bg-[hsl(160_84%_39%)]",
    basePath: "/finance",
    description: "Recebimentos, contas a pagar e centros de custo",
    menu: [
      { section: "Visão Geral", label: "Dashboard", to: "/finance" },
      { section: "Operações", label: "Recebimentos", to: "/finance/payments" },
      { section: "Operações", label: "A Receber", to: "/finance/receivables" },
      { section: "Operações", label: "Confirmações", to: "/finance/pending" },
      { section: "Operações", label: "Contas a Pagar", to: "/finance/payables" },
      { section: "Configuração", label: "Diários", to: "/finance/journals" },
      { section: "Configuração", label: "Métodos de Pagamento", to: "/finance/methods" },
      { section: "Configuração", label: "Centros de Custo", to: "/finance/cost_centers" },
    ],
  },
  {
    id: "cashbox" as any,
    name: "Caixa",
    shortName: "Caixa",
    icon: Banknote,
    color: "bg-[hsl(24_95%_53%)]",
    basePath: "/cashbox",
    description: "Caixas de loja, sessões e movimentos diários",
    menu: [
      { section: "Caixas", label: "Caixas", to: "/cashbox" },
    ],
  },
  {
    id: "discuss" as any,
    name: "Conversas",
    shortName: "Chat",
    icon: MessageSquare,
    color: "bg-[hsl(199_89%_48%)]",
    basePath: "/discuss",
    description: "Canais de equipa e mensagens diretas",
    menu: [{ section: "Conversas", label: "Canais", to: "/discuss" }],
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
      { section: "Empresa", label: "Lojas", to: "/settings/stores" },
    ],
  },
];

export const getModuleByPath = (pathname: string) =>
  MODULES.find((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/")) ?? null;
