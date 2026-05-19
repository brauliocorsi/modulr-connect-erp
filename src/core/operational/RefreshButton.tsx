import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RefreshButtonProps {
  onRefresh: () => void;
  isFetching?: boolean;
  label?: string;
  className?: string;
}

export function RefreshButton({ onRefresh, isFetching, label = "Atualizar", className }: RefreshButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRefresh}
      disabled={isFetching}
      className={className}
      aria-label={label}
    >
      <RefreshCw className={cn("h-4 w-4 mr-1", isFetching && "animate-spin")} />
      {label}
    </Button>
  );
}
