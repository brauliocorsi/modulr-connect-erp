/**
 * F29 — Finance hero clean (estilo "Fecho do Dia").
 * Header em branco + KPI cards consistentes com o resto do módulo financeiro.
 */
import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
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
    <div className={cn("mb-6", className)}>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground mb-1.5">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {kpis && kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map((k) => {
            const tone = k.tone ?? "default";
            const valueColor =
              tone === "danger" ? "text-[#DC2626]"
              : tone === "gold" ? "text-[#2563EB]"
              : tone === "muted" ? "text-muted-foreground"
              : "text-foreground";
            return (
              <Card
                key={k.key}
                className="p-5 border border-border/60 shadow-none rounded-lg"
              >
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</div>
                <div className={cn("text-[28px] leading-none font-semibold tabular-nums mt-2", valueColor)}>
                  {k.value}
                </div>
                {k.hint && <div className="text-xs text-muted-foreground mt-2">{k.hint}</div>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
