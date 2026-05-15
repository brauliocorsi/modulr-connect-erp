import { Badge } from "@/components/ui/badge";

const STATE_LABEL: Record<string, string> = {
  draft: "Rascunho",
  waiting_material: "Aguardando matéria-prima",
  ready: "Pronto p/ produzir",
  in_progress: "Em produção",
  paused: "Pausado",
  qc: "Controle de qualidade",
  done: "Concluído",
  cancelled: "Cancelado",
};
const STATE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  waiting_material: "destructive",
  ready: "secondary",
  in_progress: "default",
  paused: "outline",
  qc: "secondary",
  done: "default",
  cancelled: "outline",
};
const PRIO_LABEL: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const PRIO_CLASS: Record<string, string> = {
  low: "bg-muted text-foreground",
  normal: "bg-secondary text-secondary-foreground",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  urgent: "bg-destructive/15 text-destructive",
};

export const MOStateBadge = ({ state }: { state: string }) => (
  <Badge variant={STATE_VARIANT[state] ?? "outline"}>{STATE_LABEL[state] ?? state}</Badge>
);

export const MOPriorityBadge = ({ priority }: { priority: string }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PRIO_CLASS[priority] ?? ""}`}>
    {PRIO_LABEL[priority] ?? priority}
  </span>
);

export const ComponentStockChip = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    reserved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    consumed: "bg-muted text-muted-foreground",
    partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    missing: "bg-destructive/15 text-destructive",
    pending: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    reserved: "Reservado", consumed: "Consumido", partial: "Parcial", missing: "Em falta", pending: "Pendente",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs ${map[status] ?? ""}`}>{label[status] ?? status}</span>;
};
