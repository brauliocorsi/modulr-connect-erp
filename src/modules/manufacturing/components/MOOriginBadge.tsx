import { Badge } from "@/components/ui/badge";

const LABEL: Record<string, string> = {
  sale: "Venda",
  manual: "Manual",
  replenishment: "Reposição",
  rework: "Retrabalho",
  other: "Outro",
};
const CLASS: Record<string, string> = {
  sale: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  manual: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  replenishment: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rework: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  other: "bg-muted text-foreground",
};

export const MOOriginBadge = ({ origin }: { origin?: string | null }) => {
  const k = origin ?? "manual";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLASS[k] ?? ""}`}>{LABEL[k] ?? k}</span>;
};
