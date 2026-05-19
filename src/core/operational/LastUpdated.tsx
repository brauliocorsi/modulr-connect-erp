import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface LastUpdatedProps {
  value?: Date | string | null;
  className?: string;
  prefix?: string;
}

export function LastUpdated({ value, className, prefix = "Atualizado" }: LastUpdatedProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((v) => v + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {prefix} {formatDistanceToNow(d, { addSuffix: true, locale: ptBR })}
    </span>
  );
}
