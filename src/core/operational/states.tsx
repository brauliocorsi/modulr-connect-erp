import { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border rounded-lg p-10 text-center bg-card", className)}>
      <div className="flex justify-center mb-2 text-muted-foreground">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <div className="text-base font-semibold">{title}</div>
      {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Ocorreu um erro",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("border border-destructive/40 bg-destructive/5 rounded-lg p-6 text-center", className)}
    >
      <div className="flex justify-center mb-2 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="text-base font-semibold">{title}</div>
      {description && <div className="text-sm text-destructive mt-1">{description}</div>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function LoadingState({
  rows = 5,
  className,
  inline,
}: {
  rows?: number;
  className?: string;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", className)} aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
