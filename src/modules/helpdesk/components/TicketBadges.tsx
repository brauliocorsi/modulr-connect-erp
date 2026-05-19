import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  waiting_agent: "Aguarda agente",
  waiting_customer: "Aguarda cliente",
  linked_to_service_case: "Em assistência",
  resolved: "Resolvido",
  closed: "Fechado",
  cancelled: "Cancelado",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "default",
  waiting_agent: "default",
  waiting_customer: "secondary",
  linked_to_service_case: "secondary",
  resolved: "outline",
  closed: "outline",
  cancelled: "destructive",
};

const CATEGORY_LABEL: Record<string, string> = {
  order_status: "Status do pedido",
  delivery_schedule: "Agenda entrega",
  payment_question: "Pagamento",
  damaged_product: "Produto danificado",
  missing_part: "Peça em falta",
  warranty_claim: "Garantia",
  return_request: "Devolução",
  complaint: "Reclamação",
  general_question: "Dúvida",
  other: "Outro",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};
const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  normal: "secondary",
  high: "default",
  urgent: "destructive",
};

export const CONVERTIBLE_CATEGORIES = new Set([
  "damaged_product",
  "missing_part",
  "warranty_claim",
  "return_request",
  "complaint",
]);
export const SERVICE_HINT_CATEGORIES = new Set([
  "damaged_product",
  "missing_part",
  "warranty_claim",
  "return_request",
]);

export function TicketStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{STATUS_LABEL[status] ?? status}</Badge>;
}
export function TicketCategoryBadge({ category }: { category: string }) {
  return <Badge variant="outline">{CATEGORY_LABEL[category] ?? category}</Badge>;
}
export function TicketPriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={PRIORITY_VARIANT[priority] ?? "outline"}>{PRIORITY_LABEL[priority] ?? priority}</Badge>;
}

const PUBLIC_ORDER_LABEL: Record<string, string> = {
  draft: "Rascunho",
  confirmed: "Confirmado",
  in_production: "Em produção",
  ready: "Pronto",
  shipping: "Em expedição",
  delivered: "Entregue",
  cancelled: "Cancelado",
};
export function PublicOrderStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return <Badge variant="secondary">{PUBLIC_ORDER_LABEL[status] ?? status}</Badge>;
}
