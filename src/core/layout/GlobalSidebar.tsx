import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ShoppingCart, Package, ShoppingBag, Factory, Warehouse, Truck,
  Wallet, Wrench, LifeBuoy, Settings as SettingsIcon, LucideIcon,
  ChevronDown, Search, Sparkles, BarChart3, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Status = "active" | "coming_soon" | "hidden";

type NavItem = {
  label: string;
  to?: string;
  status?: Status;
};

type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    id: "indicadores", label: "Indicadores", icon: BarChart3,
    items: [
      { label: "Visão operacional", to: "/indicators" },
    ],
  },
  {
    id: "comercial", label: "Comercial", icon: ShoppingCart,
    items: [
      { label: "Cotações", to: "/sales/quotations" },
      { label: "Pedidos", to: "/sales/orders" },
      { label: "Clientes", to: "/sales/customers" },
      { label: "Tabelas de Preço", to: "/sales/pricelists" },
      { label: "Regras de Entrega", to: "/sales/delivery-rules" },
      { label: "Stock para Venda", to: "/sales/stock" },
    ],
  },
  {
    id: "produtos", label: "Produtos & Engenharia", icon: Package,
    items: [
      { label: "Produtos", to: "/products" },
      { label: "Categorias", to: "/products/categories" },
      { label: "Atributos", to: "/products/attributes" },
      { label: "BOM", to: "/products/bom" },
      { label: "Colis / Templates", status: "coming_soon" },
    ],
  },
  {
    id: "compras", label: "Compras", icon: ShoppingBag,
    items: [
      { label: "Necessidades", to: "/purchase/needs" },
      { label: "Pedidos de Compra", to: "/purchase/orders" },
      { label: "Kanban RFQ", to: "/purchase/kanban" },
      { label: "Fornecedores", to: "/purchase/suppliers" },
      { label: "Contas a Pagar", to: "/finance/payables" },
    ],
  },
  {
    id: "producao", label: "Produção", icon: Factory,
    items: [
      { label: "Dashboard", to: "/manufacturing" },
      { label: "Ordens de Fabricação", to: "/manufacturing/orders" },
      { label: "Planeamento", to: "/manufacturing/planning" },
      { label: "Chão de Fábrica", to: "/shop-floor" },
      { label: "Controle de Qualidade", to: "/shop-floor/quality" },
      { label: "Centros de Trabalho", status: "coming_soon" },
      { label: "Operações", status: "coming_soon" },
      { label: "Máquinas", status: "coming_soon" },
    ],
  },
  {
    id: "inventario", label: "Inventário", icon: Warehouse,
    items: [
      { label: "Visão Geral", to: "/inventory" },
      { label: "Stock", to: "/inventory/stock" },
      { label: "Cronograma", to: "/inventory/schedule" },
      { label: "Recebimentos", to: "/inventory/receipts" },
      { label: "Transferências", to: "/inventory/transfers" },
      { label: "Lotes (Batch)", to: "/inventory/batches" },
      { label: "Ondas (Wave)", to: "/inventory/waves" },
      { label: "Movimentos", to: "/inventory/moves" },
      { label: "Ajustes", to: "/inventory/adjustments" },
      { label: "Kardex", to: "/inventory/kardex" },
      { label: "Armazéns", to: "/inventory/warehouses" },
      { label: "Locais", to: "/inventory/locations" },
      { label: "Stock por Bin", to: "/inventory/bins" },
      { label: "Códigos de Barras", to: "/barcode" },
      { label: "Danificados / Quarentena", status: "coming_soon" },
    ],
  },
  {
    id: "logistica", label: "Logística", icon: Truck,
    items: [
      { label: "Cronograma de Rotas", to: "/routes" },
      { label: "Rotas Fechadas", to: "/routes/closed" },
      { label: "Zonas", to: "/routes/zones" },
      { label: "Entregas", to: "/delivery" },
      { label: "Levantamentos", to: "/m5/pickups" },
      { label: "Transportadoras", to: "/m5/carrier" },
      { label: "Veículos", to: "/inventory/vehicles" },
    ],
  },
  {
    id: "financeiro", label: "Financeiro", icon: Wallet,
    items: [
      { label: "— Visão Geral —", status: "hidden" },
      { label: "Dashboard", to: "/finance" },
      { label: "Relatórios", to: "/finance/reports" },
      { label: "— Operações —", status: "hidden" },
      { label: "Contas a Receber", to: "/finance/receivables" },
      { label: "Contas a Pagar", to: "/finance/payables" },
      { label: "Confirmações Pendentes", to: "/finance/pending" },
      { label: "Despesas Fixas", to: "/finance/recurring" },
      { label: "Créditos de Cliente", to: "/finance/credits" },
      { label: "— Tesouraria —", status: "hidden" },
      { label: "Recebimentos de Vendas", to: "/finance/payments" },
      { label: "Recebimentos de Entregas", to: "/finance/handovers" },
      { label: "Caixa Físico", to: "/cashbox" },
      { label: "Importar Extrato", to: "/finance/bank-import" },
      { label: "Conciliação Bancária", to: "/finance/reconciliation" },
      { label: "— Configuração —", status: "hidden" },
      { label: "Plano de Contas", to: "/finance/chart-of-accounts" },
      { label: "Centros de Custo", to: "/finance/cost-centers" },
      { label: "Métodos de Pagamento", to: "/finance/methods" },
      { label: "Contas / Diários", to: "/finance/journals" },
    ],
  },
  {
    id: "assistencia", label: "Assistência", icon: Wrench,
    items: [
      { label: "Pedidos", to: "/service/requests" },
      { label: "Reparações", status: "coming_soon" },
      { label: "RMA", status: "coming_soon" },
    ],
  },
  {
    id: "helpdesk", label: "Helpdesk", icon: LifeBuoy,
    items: [
      { label: "Tickets", to: "/helpdesk/tickets" },
      { label: "Portal Cliente", status: "coming_soon" },
    ],
  },
  {
    id: "sistema", label: "Sistema", icon: SettingsIcon,
    items: [
      { label: "Discuss", to: "/discuss" },
      { label: "Apps Instalados", to: "/settings/apps" },
      { label: "Utilizadores", to: "/settings/users" },
      { label: "Grupos & Permissões", to: "/settings/groups" },
      { label: "Empresa", to: "/settings/company" },
      { label: "Lojas", to: "/settings/stores" },
      { label: "RH", to: "/hr/employees" },
      { label: "Minhas Tarefas", status: "coming_soon" },
      { label: "Health Checks", status: "coming_soon" },
    ],
  },
];

function isItemActive(pathname: string, to?: string) {
  if (!to) return false;
  if (pathname === to) return true;
  return pathname.startsWith(to + "/");
}

function groupContainsActive(pathname: string, group: NavGroup) {
  return group.items.some((it) => isItemActive(pathname, it.to));
}

export default function GlobalSidebar() {
  const { pathname } = useLocation();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("erp.sidebar.collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("erp.sidebar.collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const initialOpenId = useMemo(() => {
    const g = GROUPS.find((g) => groupContainsActive(pathname, g));
    return g?.id ?? null;
  }, [pathname]);

  // Single-open accordion: only one group expanded at a time.
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  // Keep in sync when route changes (only auto-open if no group is currently open
  // or the active route belongs to a different group than the one open).
  useEffect(() => {
    if (initialOpenId && initialOpenId !== openId) setOpenId(initialOpenId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenId]);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.label.toLowerCase().includes(q)),
      })).filter((g) => g.items.length > 0)
    : GROUPS;

  if (collapsed) {
    return (
      <aside
        data-testid="global-sidebar"
        data-collapsed="1"
        className="hidden md:flex w-14 flex-col border-r bg-sidebar text-sidebar-foreground"
      >
        <div className="p-2 border-b flex justify-center">
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            data-testid="sidebar-collapse-toggle"
            aria-label="Expandir menu"
            onClick={() => setCollapsed(false)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 overflow-auto py-2 space-y-1">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const target = g.items.find((it) => it.to)?.to ?? "#";
            const hasActive = groupContainsActive(pathname, g);
            return (
              <Tooltip key={g.id}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={target}
                    data-testid={`sidebar-collapsed-${g.id}`}
                    aria-label={g.label}
                    className={cn(
                      "flex items-center justify-center mx-1 my-0.5 h-9 w-12 rounded hover:bg-sidebar-accent",
                      hasActive && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">{g.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>
    );
  }


  return (
    <aside
      data-testid="global-sidebar"
      className="hidden md:flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="p-3 border-b flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar no menu…"
            className="pl-7 h-8 text-xs"
          />
        </div>
        <Button
          variant="ghost" size="icon" className="h-8 w-8 shrink-0"
          data-testid="sidebar-collapse-toggle"
          aria-label="Recolher menu"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <nav className="flex-1 overflow-auto p-2 space-y-1">
        {filtered.map((group) => {
          const isOpen = q ? true : openId === group.id;
          const Icon = group.icon;
          const hasActive = groupContainsActive(pathname, group);
          return (
            <Collapsible key={group.id} open={isOpen} onOpenChange={() => !q && toggle(group.id)}>
              <CollapsibleTrigger
                data-testid={`sidebar-group-${group.id}`}
                className={cn(
                  "flex items-center w-full gap-2 px-2 py-1.5 rounded text-sm hover:bg-sidebar-accent",
                  hasActive && "text-sidebar-accent-foreground font-medium",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-6 pt-0.5 pb-1 space-y-0.5">
                {group.items.map((it) => {
                  const disabled = it.status === "coming_soon" || !it.to;
                  if (it.status === "hidden") return null;
                  if (disabled) {
                    return (
                      <Tooltip key={it.label}>
                        <TooltipTrigger asChild>
                          <div
                            data-testid={`sidebar-item-disabled-${it.label}`}
                            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground/70 cursor-not-allowed select-none"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span className="truncate">{it.label}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right">Em breve</TooltipContent>
                      </Tooltip>
                    );
                  }
                  return (
                    <NavLink
                      key={it.label}
                      to={it.to!}
                      end={it.to === "/" }
                      className={({ isActive }) =>
                        cn(
                          "block px-2 py-1 rounded text-xs hover:bg-sidebar-accent",
                          isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                        )
                      }
                    >
                      {it.label}
                    </NavLink>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>
    </aside>
  );
}

export const __SIDEBAR_GROUPS_FOR_TEST = GROUPS;
