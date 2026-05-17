import * as React from "react";
import { Info, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FieldInfoTooltipProps {
  title: string;
  description: string;
  example?: string;
  warning?: string;
  className?: string;
  iconClassName?: string;
  /** Accessible label for the trigger button. Defaults to "Ajuda: {title}". */
  ariaLabel?: string;
}

/**
 * FieldInfoTooltip — UI-only contextual help.
 *
 * Renders a small "i" icon button next to a label/field.
 * Click or tap opens a popover (works on desktop and mobile) with:
 *  - title
 *  - description
 *  - optional example
 *  - optional warning (highlighted)
 *
 * Does not touch backend, RPCs, or payloads.
 */
export function FieldInfoTooltip({
  title,
  description,
  example,
  warning,
  className,
  iconClassName,
  ariaLabel,
}: FieldInfoTooltipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? `Ajuda: ${title}`}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring align-middle",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 text-xs space-y-2 leading-relaxed"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-sm text-foreground">{title}</div>
        <p className="text-muted-foreground whitespace-pre-line">{description}</p>
        {example && (
          <div className="rounded-md bg-muted/60 px-2 py-1.5 text-foreground/90">
            <span className="font-medium">Exemplo: </span>
            <span className="text-muted-foreground">{example}</span>
          </div>
        )}
        {warning && (
          <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{warning}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * LabelWithInfo — convenience wrapper to render a label + info icon
 * with consistent spacing across forms.
 */
export function LabelWithInfo({
  children,
  info,
  className,
}: {
  children: React.ReactNode;
  info: FieldInfoTooltipProps;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <FieldInfoTooltip {...info} />
    </span>
  );
}
