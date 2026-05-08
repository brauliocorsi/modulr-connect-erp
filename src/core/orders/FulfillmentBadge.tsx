import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-muted text-muted-foreground" },
  backordered: { label: "Encomendado", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  purchased: { label: "Comprado", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
  partial: { label: "Parcial", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  ready: { label: "Pronto p/ entrega", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  delivered: { label: "Entregue", cls: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100" },
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

export const FULFILLMENT_OPTIONS = Object.entries(MAP).map(([value, v]) => ({ value, label: v.label }));
