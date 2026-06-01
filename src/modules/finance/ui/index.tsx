/**
 * Primitivos visuais partilhados do módulo Financeiro.
 * Estilo "Fecho do Dia" — branco, azul #2563EB, bordas finas, cantos 8px.
 */
import { ReactNode, ComponentType } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

/* ---------- Formatters ---------- */
export const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-PT") : "—";

export const fmtDateLong = (d: Date = new Date()) =>
  d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
   .replace(/^\w/, (c) => c.toUpperCase());

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—";

export function hoursAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (diff < 1) return `há ${Math.max(1, Math.floor(diff * 60))}min`;
  if (diff < 24) return `há ${Math.floor(diff)}h`;
  return `há ${Math.floor(diff / 24)}d`;
}

/* ---------- StateBadge ---------- */
export type Tone = "green" | "amber" | "red" | "blue" | "gray";
export function StateBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const map: Record<Tone, string> = {
    green: "bg-[#DCFCE7] text-[#15803D]",
    amber: "bg-[#FEF3C7] text-[#B45309]",
    red:   "bg-[#FEE2E2] text-[#B91C1C]",
    blue:  "bg-[#DBEAFE] text-[#1D4ED8]",
    gray:  "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

/* ---------- KPI Card ---------- */
export function KpiCard({
  label, value, sub, subTone, icon: Icon, loading,
}: {
  label: string; value: string | number; sub?: string;
  subTone?: "red" | "muted" | "green";
  icon: ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  const subColor =
    subTone === "red" ? "text-[#DC2626]" :
    subTone === "green" ? "text-[#16A34A]" :
    "text-muted-foreground";
  return (
    <Card className="p-5 border border-border/60 shadow-none rounded-lg">
      <div className="flex items-start justify-between">
        <div className="space-y-2 min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <div className="text-[32px] leading-none font-semibold tabular-nums">{value}</div>
          )}
          {loading ? (
            <Skeleton className="h-4 w-28" />
          ) : sub ? (
            <div className={`text-sm ${subColor} truncate`}>{sub}</div>
          ) : <div className="h-4" />}
        </div>
        <div className="h-10 w-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

/* ---------- Panel (card com header de ícone+título) ---------- */
export function Panel({
  title, icon: Icon, children, action, className,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border border-border/60 shadow-none rounded-lg overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-[#2563EB]" />}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </Card>
  );
}

/* ---------- Empty / Loading helpers ---------- */
export function EmptyState({ message, icon: Icon }: { message: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className="text-sm text-muted-foreground text-center py-10 flex flex-col items-center gap-2">
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/40" />}
      <span>{message}</span>
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/* ---------- Page header ---------- */
export function FinancePageHeader({
  title, subtitle, onRefresh, actions, showDate = true,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  actions?: ReactNode;
  showDate?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {showDate && (
          <span className="text-sm text-muted-foreground hidden md:inline">{fmtDateLong()}</span>
        )}
        {actions}
        {onRefresh && (
          <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- Page wrapper ---------- */
export function FinancePage({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background min-h-full">
      <div className="max-w-[1400px] mx-auto px-6 py-6">{children}</div>
    </div>
  );
}

/* ---------- Style tokens reutilizáveis ---------- */
export const PRIMARY_BTN = "bg-[#2563EB] text-white hover:bg-[#1D4ED8]";
