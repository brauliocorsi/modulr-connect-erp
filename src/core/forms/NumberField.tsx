import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  align?: "left" | "right";
  className?: string;
  showStepper?: boolean;
};

const parsePtNumber = (s: string): number => {
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const formatPt = (n: number, decimals?: number): string => {
  if (!Number.isFinite(n)) return "";
  if (decimals != null) return n.toFixed(decimals).replace(".", ",");
  return String(n).replace(".", ",");
};

export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  decimals,
  prefix,
  suffix,
  align = "right",
  className,
  showStepper = true,
}: Props) {
  const [text, setText] = useState<string>(formatPt(value, decimals));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatPt(value, decimals));
  }, [value, decimals, focused]);

  const commit = (raw: string) => {
    let n = parsePtNumber(raw);
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (decimals != null) n = Number(n.toFixed(decimals));
    onChange(n);
    setText(formatPt(n, decimals));
  };

  const bump = (dir: 1 | -1) => {
    let n = (Number.isFinite(value) ? value : 0) + dir * step;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (decimals != null) n = Number(n.toFixed(decimals));
    onChange(n);
    setText(formatPt(n, decimals));
  };

  return (
    <div className={cn("relative flex items-stretch", className)}>
      {showStepper && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-7 rounded-r-none border-r-0 shrink-0"
          disabled={disabled || (min != null && value <= min)}
          onClick={() => bump(-1)}
          tabIndex={-1}
        >
          <Minus className="h-3 w-3" />
        </Button>
      )}
      <div className="relative flex-1">
        {prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          inputMode="decimal"
          className={cn(
            "h-8 tabular-nums",
            align === "right" ? "text-right" : "text-left",
            prefix && "pl-6",
            suffix && "pr-7",
            showStepper && "rounded-none",
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp") { e.preventDefault(); bump(1); }
            if (e.key === "ArrowDown") { e.preventDefault(); bump(-1); }
          }}
          disabled={disabled}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {showStepper && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-7 rounded-l-none border-l-0 shrink-0"
          disabled={disabled || (max != null && value >= max)}
          onClick={() => bump(1)}
          tabIndex={-1}
        >
          <Plus className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
