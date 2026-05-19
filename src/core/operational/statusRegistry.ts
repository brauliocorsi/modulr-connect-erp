// Central registry for operational status labels/variants across the ERP.
// Single source of truth — never duplicate switch/maps in pages.

export type StatusDomain =
  | "sale"
  | "operational"
  | "manufacturing"
  | "service"
  | "ticket"
  | "finance"
  | "package"
  | "purchase"
  | "purchase_need";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface StatusDef {
  label: string;
  variant: BadgeVariant;
  /** Optional tailwind class override (semantic tokens only). */
  className?: string;
  description?: string;
}

type Registry = Record<StatusDomain, Record<string, StatusDef>>;

export const STATUS_REGISTRY: Registry = {
  sale: {
    draft: { label: "Rascunho", variant: "outline" },
    sent: { label: "Enviado", variant: "secondary" },
    confirmed: { label: "Confirmado", variant: "default" },
    done: { label: "Concluído", variant: "secondary" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  },
  operational: {
    waiting_components: { label: "Aguardando componentes", variant: "secondary" },
    waiting_purchase: { label: "Aguardando compra", variant: "secondary" },
    waiting_manufacturing: { label: "Aguardando produção", variant: "secondary" },
    in_production: { label: "Em produção", variant: "default" },
    ready_delivery: { label: "Pronto para entrega", variant: "default" },
    scheduled: { label: "Agendado", variant: "secondary" },
    out_for_delivery: { label: "Em entrega", variant: "default" },
    completed: { label: "Concluído", variant: "secondary" },
  },
  manufacturing: {
    draft: { label: "Rascunho", variant: "outline" },
    waiting_material: { label: "Aguardando material", variant: "secondary" },
    ready: { label: "Pronta", variant: "default" },
    in_progress: { label: "Em curso", variant: "default" },
    paused: { label: "Pausada", variant: "secondary" },
    qc: { label: "Controlo qualidade", variant: "secondary" },
    done: { label: "Concluída", variant: "secondary" },
    cancelled: { label: "Cancelada", variant: "destructive" },
  },
  service: {
    new: { label: "Novo", variant: "default" },
    triage: { label: "Triagem", variant: "secondary" },
    waiting_photos: { label: "Aguarda fotos", variant: "secondary" },
    waiting_parts: { label: "Aguarda peças", variant: "secondary" },
    waiting_manufacturing: { label: "Aguarda produção", variant: "secondary" },
    waiting_schedule: { label: "Aguarda agendamento", variant: "secondary" },
    scheduled: { label: "Agendado", variant: "default" },
    in_route: { label: "Em rota", variant: "default" },
    in_repair: { label: "Em reparação", variant: "default" },
    done: { label: "Concluído", variant: "secondary" },
    cancelled: { label: "Cancelado", variant: "destructive" },
    rejected: { label: "Rejeitado", variant: "destructive" },
  },
  ticket: {
    new: { label: "Novo", variant: "default" },
    waiting_agent: { label: "Aguarda agente", variant: "default" },
    waiting_customer: { label: "Aguarda cliente", variant: "secondary" },
    linked_to_service_case: { label: "Ligado à assistência", variant: "secondary" },
    resolved: { label: "Resolvido", variant: "outline" },
    closed: { label: "Fechado", variant: "outline" },
    cancelled: { label: "Cancelado", variant: "destructive" },
  },
  finance: {
    unpaid: { label: "Por pagar", variant: "destructive" },
    partial: { label: "Pago parcial", variant: "secondary" },
    paid: { label: "Pago", variant: "secondary" },
    pending_confirmation: { label: "Aguarda confirmação", variant: "secondary" },
    refund_due: { label: "Reembolso devido", variant: "destructive" },
    credit_due: { label: "Crédito a aplicar", variant: "secondary" },
  },
  package: {
    good: { label: "Bom estado", variant: "secondary" },
    damaged: { label: "Danificado", variant: "destructive" },
    quarantine: { label: "Quarentena", variant: "secondary" },
    repaired: { label: "Reparado", variant: "default" },
    scrapped: { label: "Sucata", variant: "destructive" },
    outlet: { label: "Outlet", variant: "outline" },
  },
};

export function getStatusDef(domain: StatusDomain, status: string | null | undefined): StatusDef | null {
  if (!status) return null;
  return STATUS_REGISTRY[domain]?.[status] ?? null;
}
