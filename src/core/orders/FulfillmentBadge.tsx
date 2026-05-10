import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-muted text-muted-foreground" },
  ordered: { label: "Encomendado", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  backordered: { label: "Encomendado", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  purchased: { label: "Encomenda efetuada", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
  partial_available: { label: "Disponível parcial", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  partial: { label: "Disponível parcial", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  available: { label: "Disponível", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  ready: { label: "Pronto p/ entrega", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  scheduled: { label: "Agendado", cls: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200" },
  delivered_partial: { label: "Entregue parcial", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  delivered: { label: "Entregue", cls: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100" },
  settled: { label: "Entregue & prestado", cls: "bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100" },
  cancelled: { label: "Cancelado", cls: "bg-destructive/10 text-destructive" },
};

export function FulfillmentBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  const m = MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", m.cls, className)}>
      {m.label}
    </span>
  );
}

export const FULFILLMENT_OPTIONS = [
  { value: "pending", label: "Pendente" },
  { value: "ordered", label: "Encomendado" },
  { value: "purchased", label: "Encomenda efetuada" },
  { value: "partial_available", label: "Disponível parcial" },
  { value: "available", label: "Disponível" },
  { value: "scheduled", label: "Agendado" },
  { value: "delivered_partial", label: "Entregue parcial" },
  { value: "delivered", label: "Entregue" },
  { value: "settled", label: "Entregue & prestado" },
  { value: "cancelled", label: "Cancelado" },
];
