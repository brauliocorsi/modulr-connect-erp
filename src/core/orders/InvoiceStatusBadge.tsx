import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; cls: string }> = {
  not_invoiced: { label: "Não faturado", cls: "bg-muted text-muted-foreground" },
  invoiced: { label: "Faturado", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
};

export function InvoiceStatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const m = MAP[status ?? "not_invoiced"] ?? MAP.not_invoiced;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", m.cls, className)}>
      {m.label}
    </span>
  );
}
