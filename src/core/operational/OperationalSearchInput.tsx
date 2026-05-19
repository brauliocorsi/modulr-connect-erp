import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OperationalSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  autoFocus?: boolean;
}

export function OperationalSearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  debounceMs = 250,
  className,
  autoFocus,
}: OperationalSearchInputProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from parent when value changes externally (e.g. URL state).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (local === value) return;
    timer.current = setTimeout(() => onChange(local), debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, debounceMs]);

  return (
    <div className={cn("relative", className)}>
      <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input
        autoFocus={autoFocus}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8 h-9 w-64"
        aria-label={placeholder}
      />
      {local && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-9 w-9"
          aria-label="Limpar"
          onClick={() => {
            setLocal("");
            onChange("");
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
