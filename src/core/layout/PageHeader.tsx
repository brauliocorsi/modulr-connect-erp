import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  breadcrumb,
  actions,
  onSearch,
  searchPlaceholder = "Buscar…",
  createTo,
  createLabel = "Novo",
}: {
  title: string;
  breadcrumb?: { label: string; to?: string }[];
  actions?: ReactNode;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  createTo?: string;
  createLabel?: string;
}) {
  return (
    <div className="border-b bg-card">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
        {breadcrumb?.map((b, i) => (
          <span key={i} className="flex items-center gap-2">
            {b.to ? <Link to={b.to} className="hover:underline">{b.label}</Link> : <span>{b.label}</span>}
            {i < breadcrumb.length - 1 && <span>/</span>}
          </span>
        ))}
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="flex-1" />
        {onSearch && (
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              className="pl-8 w-64 h-9"
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        )}
        {actions}
        {createTo && (
          <Button asChild size="sm">
            <Link to={createTo}>
              <Plus className="h-4 w-4 mr-1" /> {createLabel}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="p-4">{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="border rounded-lg p-12 text-center bg-card">
      <div className="text-base font-semibold">{title}</div>
      {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
