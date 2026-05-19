import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OperationalActionBar, type OperationalAction } from "./OperationalActionBar";
import { RefreshButton } from "./RefreshButton";
import { LastUpdated } from "./LastUpdated";

export interface EntityHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: { label: string; to?: string }[];
  statusBadges?: ReactNode;
  metadata?: { label: string; value: ReactNode }[];
  primaryActions?: OperationalAction[];
  secondaryActions?: OperationalAction[];
  onRefresh?: () => void;
  isFetching?: boolean;
  lastUpdated?: Date | string | null;
  alerts?: ReactNode;
  footerSlot?: ReactNode;
  className?: string;
}

export function EntityHeader({
  title,
  subtitle,
  breadcrumb,
  statusBadges,
  metadata,
  primaryActions,
  secondaryActions,
  onRefresh,
  isFetching,
  lastUpdated,
  alerts,
  footerSlot,
  className,
}: EntityHeaderProps) {
  const allActions = [...(secondaryActions ?? []), ...(primaryActions ?? [])];
  return (
    <div className={cn("border-b bg-card", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-xs text-muted-foreground">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-2">
              {b.to ? <Link to={b.to} className="hover:underline">{b.label}</Link> : <span>{b.label}</span>}
              {i < breadcrumb.length - 1 && <span>/</span>}
            </span>
          ))}
        </div>
      )}
      <div className="px-4 py-3 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold truncate">{title}</h1>
            {statusBadges}
          </div>
          {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <LastUpdated value={lastUpdated} />}
          {onRefresh && <RefreshButton onRefresh={onRefresh} isFetching={isFetching} label="Atualizar" />}
          {allActions.length > 0 && <OperationalActionBar actions={allActions} />}
        </div>
      </div>
      {metadata && metadata.length > 0 && (
        <div className="px-4 pb-3">
          <Card className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {metadata.map((m, i) => (
              <div key={i}>
                <div className="text-[11px] uppercase text-muted-foreground">{m.label}</div>
                <div className="mt-0.5">{m.value}</div>
              </div>
            ))}
          </Card>
        </div>
      )}
      {alerts && <div className="px-4 pb-3">{alerts}</div>}
      {footerSlot && <div className="px-4 pb-3">{footerSlot}</div>}
    </div>
  );
}
