import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Trash2 } from "lucide-react";

export function FormHeader({
  title,
  breadcrumb,
  state,
  actions,
  onDelete,
  backTo,
}: {
  title: string;
  breadcrumb?: { label: string; to?: string }[];
  state?: { label: string; tone?: "default" | "success" | "warning" | "info" | "destructive" };
  actions?: ReactNode;
  onDelete?: () => void;
  backTo?: string;
}) {
  const nav = useNavigate();
  const tone = state?.tone ?? "default";
  const toneCls =
    tone === "success" ? "bg-success/10 text-success border-success/20"
    : tone === "warning" ? "bg-warning/10 text-warning border-warning/20"
    : tone === "info" ? "bg-info/10 text-info border-info/20"
    : tone === "destructive" ? "bg-destructive/10 text-destructive border-destructive/20"
    : "bg-muted text-muted-foreground";
  return (
    <div className="border-b bg-card">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {breadcrumb?.map((b, i) => (
          <span key={i} className="flex items-center gap-2">
            {b.to ? <Link to={b.to} className="hover:underline">{b.label}</Link> : <span>{b.label}</span>}
            {i < (breadcrumb?.length ?? 0) - 1 && <span>/</span>}
          </span>
        ))}
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
        {backTo && (
          <Button variant="ghost" size="icon" onClick={() => nav(backTo)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
        {state && <span className={"o-state-badge " + toneCls}>{state.label}</span>}
        <div className="flex-1" />
        {actions}
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
