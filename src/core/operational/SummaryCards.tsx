import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SummaryCardItem {
  key: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "primary" | "success" | "warning" | "danger" | "muted";
  icon?: ReactNode;
}

const TONE: Record<NonNullable<SummaryCardItem["tone"]>, string> = {
  default: "border-border",
  primary: "border-primary/40 bg-primary/5",
  success: "border-emerald-500/40 bg-emerald-500/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  danger: "border-destructive/40 bg-destructive/5",
  muted: "border-border bg-muted/40",
};

export function SummaryCards({ items, className }: { items: SummaryCardItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div
      className={cn(
        "grid gap-3",
        items.length <= 3 && "grid-cols-1 sm:grid-cols-3",
        items.length === 4 && "grid-cols-2 lg:grid-cols-4",
        items.length >= 5 && "grid-cols-2 lg:grid-cols-5",
        className,
      )}
    >
      {items.map((it) => (
        <div
          key={it.key}
          className={cn(
            "rounded-lg border bg-card px-4 py-3 shadow-sm flex flex-col gap-1 min-h-[88px]",
            TONE[it.tone ?? "default"],
          )}
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            {it.icon}
            {it.label}
          </div>
          <div className="text-xl font-semibold leading-tight tabular-nums break-words">{it.value}</div>
          {it.hint && <div className="text-xs text-muted-foreground">{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}
