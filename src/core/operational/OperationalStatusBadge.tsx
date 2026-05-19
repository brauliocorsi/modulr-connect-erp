import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getStatusDef, type StatusDomain } from "./statusRegistry";

export interface OperationalStatusBadgeProps {
  domain: StatusDomain;
  status: string | null | undefined;
  className?: string;
}

export function OperationalStatusBadge({ domain, status, className }: OperationalStatusBadgeProps) {
  if (!status) return null;
  const def = getStatusDef(domain, status);
  if (!def) {
    return (
      <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", className)} title={`Status desconhecido: ${status}`}>
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant={def.variant} className={cn(def.className, className)} title={def.description}>
      {def.label}
    </Badge>
  );
}
