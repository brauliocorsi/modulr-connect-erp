import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterValue = string | string[] | { from?: string; to?: string } | null | undefined;

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "multi" | "date-range";
  options?: FilterOption[];
  /** Optional value formatter for active chip. */
  formatChip?: (value: FilterValue) => string | null;
  width?: string;
}

export interface OperationalFiltersBarProps {
  filters: FilterDef[];
  values: Record<string, FilterValue>;
  onChange: (key: string, value: FilterValue) => void;
  onClear?: () => void;
  className?: string;
}

function defaultChip(def: FilterDef, value: FilterValue): string | null {
  if (value == null || value === "" || value === "all") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `${def.label}: ${value.length} sel.`;
  }
  if (typeof value === "object") {
    const parts = [value.from, value.to].filter(Boolean);
    if (parts.length === 0) return null;
    return `${def.label}: ${parts.join(" → ")}`;
  }
  const opt = def.options?.find((o) => o.value === value);
  return `${def.label}: ${opt?.label ?? value}`;
}

export function OperationalFiltersBar({
  filters,
  values,
  onChange,
  onClear,
  className,
}: OperationalFiltersBarProps) {
  const activeChips = filters
    .map((f) => ({ def: f, chip: (f.formatChip ?? defaultChip.bind(null, f))(values[f.key]) }))
    .filter((c) => c.chip);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {filters.map((f) => {
        const value = values[f.key];
        if (f.type === "select" || f.type === "multi") {
          return (
            <Select
              key={f.key}
              value={(value as string) ?? "all"}
              onValueChange={(v) => onChange(f.key, v === "all" ? null : v)}
            >
              <SelectTrigger className={cn("h-8 text-xs", f.width ?? "w-44")}>
                <SelectValue placeholder={f.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{f.label}: Todos</SelectItem>
                {f.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        if (f.type === "date-range") {
          const v = (value as { from?: string; to?: string } | null) ?? {};
          return (
            <div key={f.key} className="flex items-center gap-1">
              <Input
                type="date"
                className="h-8 w-36 text-xs"
                value={v.from ?? ""}
                onChange={(e) => onChange(f.key, { ...v, from: e.target.value || undefined })}
                aria-label={`${f.label} de`}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                className="h-8 w-36 text-xs"
                value={v.to ?? ""}
                onChange={(e) => onChange(f.key, { ...v, to: e.target.value || undefined })}
                aria-label={`${f.label} até`}
              />
            </div>
          );
        }
        return null;
      })}

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {activeChips.map(({ def, chip }) => (
            <Badge key={def.key} variant="secondary" className="gap-1 text-xs">
              {chip}
              <button
                type="button"
                aria-label={`Remover ${def.label}`}
                onClick={() => onChange(def.key, null)}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {onClear && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
              Limpar filtros
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
