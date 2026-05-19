import { ReactNode, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DisabledReasonTooltip } from "./DisabledReasonTooltip";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export interface OperationalAction {
  key: string;
  label: string;
  onClick: () => void | Promise<void>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  /** When set, shows a confirm dialog before invoking onClick. */
  confirm?: {
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
  };
  /** Marks as destructive; auto-sets variant=destructive and applies destructive confirm styling. */
  destructive?: boolean;
  hidden?: boolean;
}

export interface OperationalActionBarProps {
  actions: OperationalAction[];
  className?: string;
  align?: "start" | "end";
}

export function OperationalActionBar({ actions, className, align = "end" }: OperationalActionBarProps) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const visible = actions.filter((a) => !a.hidden);
  const primaries = visible.filter((a) => !a.destructive);
  const destructives = visible.filter((a) => a.destructive);

  const renderBtn = (a: OperationalAction) => {
    const variant: ButtonProps["variant"] = a.destructive ? "destructive" : a.variant ?? "outline";
    const btn = (
      <Button
        key={a.key}
        size={a.size ?? "sm"}
        variant={variant}
        disabled={a.disabled || a.loading}
        onClick={() => {
          if (a.confirm) setConfirmKey(a.key);
          else void a.onClick();
        }}
      >
        {a.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : a.icon}
        {a.label}
      </Button>
    );
    if (a.disabled && a.disabledReason) {
      return (
        <DisabledReasonTooltip key={a.key} reason={a.disabledReason}>
          {btn}
        </DisabledReasonTooltip>
      );
    }
    return btn;
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          align === "end" && "justify-end",
          className,
        )}
        role="toolbar"
      >
        {primaries.map(renderBtn)}
        {destructives.length > 0 && primaries.length > 0 && (
          <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        )}
        {destructives.map(renderBtn)}
      </div>
      {visible.map((a) =>
        a.confirm ? (
          <ConfirmActionDialog
            key={a.key}
            open={confirmKey === a.key}
            onOpenChange={(o) => !o && setConfirmKey(null)}
            title={a.confirm.title}
            description={a.confirm.description}
            confirmLabel={a.confirm.confirmLabel}
            cancelLabel={a.confirm.cancelLabel}
            destructive={a.destructive}
            loading={a.loading}
            onConfirm={async () => {
              await a.onClick();
              setConfirmKey(null);
            }}
          />
        ) : null,
      )}
    </>
  );
}
