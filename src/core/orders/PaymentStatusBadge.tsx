import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; cls: string }> = {
  unpaid: { label: "Não pago", cls: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
  deposit_paid: { label: "Sinal pago", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  partial: { label: "Parcial", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  paid: { label: "Pago", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  overpaid: { label: "Pago em excesso", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
};

export function PaymentStatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  const m = MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", m.cls, className)}>
      {m.label}
    </span>
  );
}
