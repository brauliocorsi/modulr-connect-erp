import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInstalledModules } from "@/core/modules/useInstalledModules";
import { MODULES } from "@/core/modules/registry";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  Truck,
  Factory,
  ShoppingBag,
  Headphones,
  Wrench,
  Bell,
  CheckSquare,
  ArrowRight,
  Search,
  LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiDef {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  tone: "primary" | "success" | "warning" | "danger" | "default";
  load: () => Promise<number>;
}

async function safeCount(builder: any): Promise<number> {
  try {
    const { count, error } = await builder;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

const KPIS: KpiDef[] = [
  {
    key: "sales_open",
    label: "Vendas abertas",
    icon: ShoppingCart,
    to: "/sales/orders",
    tone: "primary",
    load: () =>
      safeCount(
        supabase
          .from("sale_orders")
          .select("id", { count: "exact", head: true })
          .in("state", ["draft", "sent", "confirmed"]),
      ),
  },
  {
    key: "ready_delivery",
    label: "Prontos p/ entrega",
    icon: Truck,
    to: "/sales/orders",
    tone: "success",
    load: () =>
      safeCount(
        supabase
          .from("sale_orders")
          .select("id", { count: "exact", head: true })
          .eq("fulfillment_status", "ready"),
      ),
  },
  {
    key: "mo_in_progress",
    label: "OFs em produção",
    icon: Factory,
    to: "/manufacturing/orders",
    tone: "primary",
    load: () =>
      safeCount(
        supabase
          .from("manufacturing_orders")
          .select("id", { count: "exact", head: true })
          .in("state", ["in_progress", "waiting_material", "ready", "qc"]),
      ),
  },
  {
    key: "needs_pending",
    label: "Necessidades pendentes",
    icon: ShoppingBag,
    to: "/purchase/needs",
    tone: "warning",
    load: () =>
      safeCount(
        supabase
          .from("purchase_needs")
          .select("id", { count: "exact", head: true })
          .in("state", ["pending", "quoting", "approved"]),
      ),
  },
  {
    key: "tickets_open",
    label: "Tickets abertos",
    icon: Headphones,
    to: "/helpdesk/tickets",
    tone: "primary",
    load: () =>
      safeCount(
        supabase
          .from("customer_tickets")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "open", "waiting_agent", "in_progress"]),
      ),
  },
  {
    key: "service_waiting_parts",
    label: "Assistência aguarda peça",
    icon: Wrench,
    to: "/service/requests",
    tone: "warning",
    load: () =>
      safeCount(
        supabase
          .from("service_cases")
          .select("id", { count: "exact", head: true })
          .in("status", ["waiting_parts", "waiting_supplier", "waiting_manufacturing"]),
      ),
  },
  {
    key: "notifications_unread",
    label: "Notificações não lidas",
    icon: Bell,
    to: "/",
    tone: "default",
    load: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return 0;
      return safeCount(
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
          .is("read_at", null),
      );
    },
  },
  {
    key: "tasks_overdue",
    label: "Tarefas vencidas",
    icon: CheckSquare,
    to: "/",
    tone: "danger",
    load: () =>
      safeCount(
        supabase
          .from("erp_tasks")
          .select("id", { count: "exact", head: true })
          .lt("due_date", new Date().toISOString())
          .in("status", ["open", "in_progress", "blocked"]),
      ),
  },
];

const TONE_RING: Record<KpiDef["tone"], string> = {
  primary: "border-primary/40 hover:border-primary",
  success: "border-emerald-500/40 hover:border-emerald-500",
  warning: "border-amber-500/40 hover:border-amber-500",
  danger: "border-destructive/40 hover:border-destructive",
  default: "border-border hover:border-foreground/30",
};

const TONE_ICON: Record<KpiDef["tone"], string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600",
  warning: "bg-amber-500/10 text-amber-600",
  danger: "bg-destructive/10 text-destructive",
  default: "bg-muted text-muted-foreground",
};

function KpiCard({ def }: { def: KpiDef }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["home-kpi", def.key],
    queryFn: def.load,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const Icon = def.icon;
  return (
    <Link
      to={def.to}
      className={cn(
        "group rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-elegant hover:-translate-y-0.5",
        TONE_RING[def.tone],
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("h-9 w-9 rounded-lg grid place-items-center", TONE_ICON[def.tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="mt-3">
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : isError ? (
          <div className="text-2xl font-semibold text-muted-foreground">—</div>
        ) : (
          <div className="text-3xl font-bold tabular-nums">{data ?? 0}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1">{def.label}</div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const installed = useInstalledModules();
  const visible = MODULES.filter((m) => m.id === "settings" || installed.data?.[m.id as string]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 19) return "Boa tarde";
    return "Boa noite";
  })();
  const name = user?.email?.split("@")[0] ?? "";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">{greeting}{name && `, ${name}`} 👋</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Visão operacional do dia. Use <kbd className="border rounded px-1 text-[10px]">⌘K</kbd> para buscar.
          </p>
        </div>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" />
          Atalhos rápidos abaixo
        </div>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Indicadores operacionais</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {KPIS.map((def) => (
            <KpiCard key={def.key} def={def} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Acesso rápido aos módulos</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {visible.map((m) => (
            <Link
              key={m.id}
              to={m.basePath}
              className="group flex flex-col items-center gap-2 p-3 rounded-lg border bg-card hover:bg-accent transition-colors"
              title={m.description}
            >
              <div className={cn("h-9 w-9 rounded-md grid place-items-center text-white", m.color)}>
                <m.icon className="h-4 w-4" />
              </div>
              <div className="text-[11px] font-medium text-center leading-tight">{m.shortName}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
