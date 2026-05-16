import { Check, Circle, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Mapeamento dos 8 passos visuais baseado no estado da rota e no manifesto.
// Não cria lógica nova — apenas reflete dados já existentes.
type Stage = {
  key: string;
  label: string;
  status: "done" | "current" | "pending" | "blocked";
};

interface Props {
  routeState: string;
  hasDockTransfers: boolean;
  hasManifest: boolean;
  manifestVerifiedCount: number;
  manifestRequiringVerification: number;
  deliveredCount: number;
  totalOrders: number;
  returnPendingCount: number;
}

export function RouteProgress(p: Props) {
  const s = p.routeState;
  const isReturn = s === "return_pending" || s === "awaiting_cash_closure";
  const isClosed = s === "closed" || s === "done";

  const stages: Stage[] = [
    {
      key: "planned",
      label: "Planeada",
      status: s === "planned" ? "current" : "done",
    },
    {
      key: "dock",
      label: "Cais",
      status: p.hasDockTransfers
        ? s === "planned"
          ? "current"
          : "done"
        : s === "planned"
        ? "pending"
        : "done",
    },
    {
      key: "loaded",
      label: "Carregada",
      status: p.hasManifest
        ? s === "loading"
          ? "current"
          : "done"
        : s === "loading"
        ? "current"
        : "pending",
    },
    {
      key: "verified",
      label: "Verificada",
      status:
        p.manifestRequiringVerification > 0
          ? p.manifestVerifiedCount >= p.manifestRequiringVerification
            ? "done"
            : s === "loading"
            ? "current"
            : "blocked"
          : ["in_progress", "return_pending", "awaiting_cash_closure", "closed", "done"].includes(s)
          ? "done"
          : "pending",
    },
    {
      key: "transit",
      label: "Em rota",
      status:
        s === "in_progress"
          ? "current"
          : ["return_pending", "awaiting_cash_closure", "closed", "done"].includes(s)
          ? "done"
          : "pending",
    },
    {
      key: "delivered",
      label: "Entregas",
      status:
        p.deliveredCount >= p.totalOrders && p.totalOrders > 0
          ? "done"
          : p.deliveredCount > 0
          ? "current"
          : "pending",
    },
    {
      key: "return",
      label: "Retornos",
      status: isClosed ? "done" : isReturn ? "current" : "pending",
    },
    {
      key: "closed",
      label: "Fechada",
      status: isClosed ? "done" : "pending",
    },
  ];

  return (
    <ol className="flex flex-wrap gap-2" aria-label="Progresso da rota">
      {stages.map((st, i) => (
        <li
          key={st.key}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
            st.status === "done" && "bg-emerald-50 border-emerald-300 text-emerald-900",
            st.status === "current" && "bg-blue-50 border-blue-300 text-blue-900",
            st.status === "pending" && "bg-muted/40 border-border text-muted-foreground",
            st.status === "blocked" && "bg-amber-50 border-amber-300 text-amber-900"
          )}
        >
          <span className="opacity-60">{i + 1}.</span>
          {st.status === "done" && <Check className="h-3 w-3" />}
          {st.status === "current" && <Loader2 className="h-3 w-3 animate-spin" />}
          {st.status === "pending" && <Circle className="h-3 w-3" />}
          {st.status === "blocked" && <AlertCircle className="h-3 w-3" />}
          <span>{st.label}</span>
        </li>
      ))}
    </ol>
  );
}
