/**
 * F28-FIN Entrega C/D — Executive hero banner for finance pages.
 * Applies Emerald Prestige tokens (fin-hero + fin-kpi).
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FinanceHeroKpi = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "gold" | "danger" | "muted";
};

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  kpis?: FinanceHeroKpi[];
  className?: string;
}

export function FinanceHero({ eyebrow, title, subtitle, actions, kpis, className }: Props) {
  return (
    <div className={cn("fin-hero rounded-2xl p-6 md:p-7 mb-5", className)}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-xs uppercase tracking-[0.18em] font-semibold opacity-80 mb-1.5 flex items-center gap-2">
              <span style={{ color: "hsl(var(--finance-accent))" }}>●</span> {eyebrow}
            </div>
          )}
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm opacity-80 mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {kpis && kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {kpis.map((k) => {
            const tone = k.tone ?? "default";
            const valueColor =
              tone === "danger" ? "text-red-300"
              : tone === "gold" ? "text-[hsl(var(--finance-accent))]"
              : tone === "muted" ? "opacity-70"
              : "";
            return (
              <div
                key={k.key}
                className="rounded-xl bg-white/10 backdrop-blur border border-white/10 px-4 py-3"
              >
                <div className="text-[11px] uppercase tracking-wider opacity-70 font-medium">{k.label}</div>
                <div className={cn("text-xl md:text-2xl font-bold tabular-nums mt-1", valueColor)}>{k.value}</div>
                {k.hint && <div className="text-[11px] opacity-70 mt-0.5">{k.hint}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
