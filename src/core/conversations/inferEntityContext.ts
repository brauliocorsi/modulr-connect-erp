/**
 * Best-effort: derive (entityType, entityId) from a URL pathname.
 * Returns null when no mapping matches.
 * Used by GlobalChatDock to scope the "Esta página" tab.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const MAP: Array<{ re: RegExp; entityType: string; label: string }> = [
  { re: new RegExp(`^/sales/(?:orders|quotations)/(${UUID})`), entityType: "sale_order", label: "Pedido" },
  { re: new RegExp(`^/orders/(${UUID})`), entityType: "sale_order", label: "Pedido" },
  { re: new RegExp(`^/manufacturing/(?:orders|mo)/(${UUID})`), entityType: "manufacturing_order", label: "Produção" },
  { re: new RegExp(`^/routes/(${UUID})`), entityType: "delivery_route", label: "Rota" },
  { re: new RegExp(`^/helpdesk/tickets?/(${UUID})`), entityType: "customer_ticket", label: "Ticket" },
  { re: new RegExp(`^/service/cases?/(${UUID})`), entityType: "service_case", label: "Serviço" },
  { re: new RegExp(`^/products/(${UUID})`), entityType: "product", label: "Produto" },
  { re: new RegExp(`^/partners/(${UUID})`), entityType: "partner", label: "Parceiro" },
];

export type EntityContext = { entityType: string; entityId: string; label: string };

export function inferEntityContextFromPath(pathname: string): EntityContext | null {
  for (const m of MAP) {
    const match = pathname.match(m.re);
    if (match?.[1]) return { entityType: m.entityType, entityId: match[1], label: m.label };
  }
  return null;
}
