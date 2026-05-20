import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  ShoppingCart, Factory, ShoppingBag, Warehouse, Truck, Wallet, Wrench,
  ArrowRight, LucideIcon, BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/core/operational/RefreshButton";
import { LastUpdated } from "@/core/operational/LastUpdated";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";

type Period = "today" | "7d" | "30d";
type Tone = "primary" | "success" | "warning" | "danger" | "default" | "muted";

type Loader = (period: Period) => Promise<number | string | null>;

interface IndicatorDef {
  key: string;
  label: string;
  to: string;
  tone: Tone;
  load: Loader;
  /** when true, value formatted as money */
  money?: boolean;
  /** when true, hide period filter effect (always all-time) */
  ignorePeriod?: boolean;
}

interface AreaDef {
  id: string;
  label: string;
  icon: LucideIcon;
  items: IndicatorDef[];
}

// ---------- helpers ----------

function periodStartISO(p: Period): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "7d") d.setDate(d.getDate() - 6);
  if (p === "30d") d.setDate(d.getDate() - 29);
  return d.toISOString();
}

async function safeCount(builder: any): Promise<number | null> {
  try {
    const { count, error } = await builder;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function safeSum(table: string, column: string, modify: (q: any) => any): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = supabase.from(table as any).select(column);
    const { data, error } = await modify(q);
    if (error) throw error;
    const total = (data ?? []).reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: number, r: any) => s + Number(r?.[column] ?? 0),
      0,
    );
    return total;
  } catch {
    return null;
  }
}

const todayISODate = () => new Date().toISOString().slice(0, 10);

// ---------- area & indicator definitions ----------

const AREAS: AreaDef[] = [
  {
    id: "comercial", label: "Comercial", icon: ShoppingCart,
    items: [
      {
        key: "sales_open", label: "Vendas abertas", tone: "primary",
        to: "/sales/orders?state=draft,sent,confirmed",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("sale_orders" as any).select("id", { count: "exact", head: true })
              .in("state", ["draft", "sent", "confirmed"]),
          ),
      },
      {
        key: "sales_ready", label: "Prontas para entrega", tone: "success",
        to: "/sales/orders?fulfillment=ready",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("sale_orders" as any).select("id", { count: "exact", head: true })
              .eq("fulfillment_status", "ready"),
          ),
      },
      {
        key: "sales_done_period", label: "Vendas concluídas (período)", tone: "default",
        to: "/sales/orders?state=done",
        load: (p) =>
          safeCount(
            supabase.from("sale_orders" as any).select("id", { count: "exact", head: true })
              .eq("state", "done")
              .gte("updated_at", periodStartISO(p)),
          ),
      },
      {
        key: "sales_value_period", label: "Valor vendido (período)", tone: "primary", money: true,
        to: "/sales/orders?state=done",
        load: (p) =>
          safeSum("sale_orders", "amount_total", (q) =>
            q.in("state", ["confirmed", "done"]).gte("created_at", periodStartISO(p)),
          ),
      },
    ],
  },
  {
    id: "producao", label: "Produção", icon: Factory,
    items: [
      {
        key: "mo_in_progress", label: "OFs em produção", tone: "primary",
        to: "/manufacturing/orders?state=in_progress",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("manufacturing_orders" as any).select("id", { count: "exact", head: true })
              .eq("state", "in_progress"),
          ),
      },
      {
        key: "mo_waiting", label: "Aguardando material", tone: "warning",
        to: "/manufacturing/orders?state=waiting_material",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("manufacturing_orders" as any).select("id", { count: "exact", head: true })
              .eq("state", "waiting_material"),
          ),
      },
      {
        key: "mo_overdue", label: "OFs atrasadas", tone: "danger",
        to: "/manufacturing/orders?overdue=1",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("manufacturing_orders" as any).select("id", { count: "exact", head: true })
              .lt("due_date", new Date().toISOString())
              .not("state", "in", "(done,cancelled)"),
          ),
      },
      {
        key: "ops_blocked", label: "Operações bloqueadas", tone: "danger",
        to: "/shop-floor",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("mo_operations" as any).select("id", { count: "exact", head: true })
              .eq("state", "blocked"),
          ),
      },
    ],
  },
  {
    id: "compras", label: "Compras", icon: ShoppingBag,
    items: [
      {
        key: "needs_pending", label: "Necessidades pendentes", tone: "warning",
        to: "/purchase/needs?state=pending",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("purchase_needs" as any).select("id", { count: "exact", head: true })
              .eq("state", "pending"),
          ),
      },
      {
        key: "po_open", label: "POs abertas", tone: "primary",
        to: "/purchase/orders?state=open",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("purchase_orders" as any).select("id", { count: "exact", head: true })
              .in("state", ["draft", "rfq_sent", "confirmed"]),
          ),
      },
      {
        key: "po_overdue", label: "POs atrasadas", tone: "danger",
        to: "/purchase/orders?overdue=1",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("purchase_orders" as any).select("id", { count: "exact", head: true })
              .lt("expected_date", todayISODate())
              .not("state", "in", "(done,cancelled,received)"),
          ),
      },
      {
        key: "needs_no_po", label: "Necessidades sem PO", tone: "warning",
        to: "/purchase/needs?no_po=1",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("purchase_needs" as any).select("id", { count: "exact", head: true })
              .is("purchase_order_id", null)
              .not("state", "in", "(done,cancelled,fulfilled)"),
          ),
      },
    ],
  },
  {
    id: "stock", label: "Stock / WMS", icon: Warehouse,
    items: [
      {
        key: "packages_in_stock", label: "Colis em stock", tone: "default",
        to: "/inventory/bins",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("stock_packages" as any).select("id", { count: "exact", head: true })
              .eq("status", "in_stock"),
          ),
      },
      {
        key: "packages_quarantine", label: "Em quarentena", tone: "warning",
        to: "/inventory/bins?condition=quarantine",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("stock_packages" as any).select("id", { count: "exact", head: true })
              .eq("condition", "quarantine"),
          ),
      },
      {
        key: "packages_damaged", label: "Danificados", tone: "danger",
        to: "/inventory/bins?condition=damaged",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("stock_packages" as any).select("id", { count: "exact", head: true })
              .eq("condition", "damaged"),
          ),
      },
      {
        key: "stock_reserved", label: "Quants reservados", tone: "primary",
        to: "/inventory",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("stock_quants" as any).select("id", { count: "exact", head: true })
              .gt("reserved_quantity", 0),
          ),
      },
    ],
  },
  {
    id: "logistica", label: "Logística", icon: Truck,
    items: [
      {
        key: "routes_open", label: "Rotas abertas", tone: "primary",
        to: "/routes?state=open",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("delivery_routes" as any).select("id", { count: "exact", head: true })
              .not("state", "in", "(closed,cancelled)"),
          ),
      },
      {
        key: "deliveries_today", label: "Entregas hoje", tone: "primary",
        to: "/routes",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("delivery_routes" as any).select("id", { count: "exact", head: true })
              .eq("route_date", todayISODate()),
          ),
      },
      {
        key: "deliveries_failed", label: "Entregas falhadas", tone: "danger",
        to: "/routes",
        load: (p) =>
          safeCount(
            supabase.from("delivery_orders" as any).select("id", { count: "exact", head: true })
              .in("state", ["failed", "returned"])
              .gte("updated_at", periodStartISO(p)),
          ),
      },
      {
        key: "routes_pending_close", label: "Rotas a fechar", tone: "warning",
        to: "/routes?state=completed",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("delivery_routes" as any).select("id", { count: "exact", head: true })
              .eq("state", "completed"),
          ),
      },
    ],
  },
  {
    id: "financeiro", label: "Financeiro", icon: Wallet,
    items: [
      {
        key: "ar_open", label: "Contas a receber", tone: "primary",
        to: "/finance/receivables",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("customer_payments" as any).select("id", { count: "exact", head: true })
              .in("state", ["pending", "partial"]),
          ),
      },
      {
        key: "ap_open", label: "Contas a pagar", tone: "warning",
        to: "/finance/payables",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("supplier_bills" as any).select("id", { count: "exact", head: true })
              .in("state", ["draft", "open", "partial"]),
          ),
      },
      {
        key: "pending_confirmations", label: "Pendentes conciliação", tone: "warning",
        to: "/finance/pending",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("customer_payments" as any).select("id", { count: "exact", head: true })
              .eq("state", "pending"),
          ),
      },
      {
        key: "cash_open", label: "Caixas abertas", tone: "success",
        to: "/cashbox",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("cash_sessions" as any).select("id", { count: "exact", head: true })
              .eq("state", "open"),
          ),
      },
    ],
  },
  {
    id: "service", label: "Assistência / Helpdesk", icon: Wrench,
    items: [
      {
        key: "tickets_open", label: "Tickets abertos", tone: "primary",
        to: "/helpdesk/tickets?status=new,waiting_agent",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("customer_tickets" as any).select("id", { count: "exact", head: true })
              .in("status", ["new", "open", "waiting_agent", "in_progress"]),
          ),
      },
      {
        key: "service_triage", label: "Em triagem", tone: "default",
        to: "/service/requests?status=triage",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("service_cases" as any).select("id", { count: "exact", head: true })
              .eq("status", "triage"),
          ),
      },
      {
        key: "service_waiting_parts", label: "Aguardando peça", tone: "warning",
        to: "/service/requests?status=waiting_parts",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("service_cases" as any).select("id", { count: "exact", head: true })
              .in("status", ["waiting_parts", "waiting_supplier", "waiting_manufacturing"]),
          ),
      },
      {
        key: "service_open", label: "Assistências em aberto", tone: "primary",
        to: "/service/requests",
        ignorePeriod: true,
        load: () =>
          safeCount(
            supabase.from("service_cases" as any).select("id", { count: "exact", head: true })
              .not("status", "in", "(done,cancelled,closed)"),
          ),
      },
    ],
  },
];

// ---------- presentational ----------

const TONE_RING: Record<Tone, string> = {
  primary: "border-primary/30 hover:border-primary",
  success: "border-emerald-500/30 hover:border-emerald-500",
  warning: "border-amber-500/30 hover:border-amber-500",
  danger: "border-destructive/30 hover:border-destructive",
  muted: "border-border hover:border-foreground/30",
  default: "border-border hover:border-foreground/30",
};
const TONE_ICON: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600",
  warning: "bg-amber-500/10 text-amber-600",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  default: "bg-muted text-muted-foreground",
};

function IndicatorCard({
  def, period, areaIcon,
}: { def: IndicatorDef; period: Period; areaIcon: LucideIcon }) {
  const Icon = areaIcon;
  const queryKey = ["indicator", def.key, def.ignorePeriod ? "all" : period];
  // ts-friendly inline query
  const [q] = useQueries({
    queries: [{
      queryKey,
      queryFn: () => def.load(period),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }],
  });

  const isLoading = q.isLoading;
  const isError = q.isError;
  const v = q.data;
  const display =
    isError || v == null
      ? "—"
      : def.money
      ? fmtMoney(typeof v === "number" ? v : Number(v))
      : String(v);

  return (
    <Link
      to={def.to}
      data-testid={`indicator-${def.key}`}
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
      <div className="mt-3 min-h-[56px]">
        {isLoading ? (
          <Skeleton className="h-7 w-20" data-testid={`indicator-skeleton-${def.key}`} />
        ) : (
          <div
            className={cn(
              "text-2xl font-bold tabular-nums break-words",
              (isError || v == null) && "text-muted-foreground",
            )}
            data-testid={`indicator-value-${def.key}`}
          >
            {display}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-1">{def.label}</div>
      </div>
    </Link>
  );
}

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const opts: { id: Period; label: string }[] = [
    { id: "today", label: "Hoje" },
    { id: "7d", label: "7 dias" },
    { id: "30d", label: "30 dias" },
  ];
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5" data-testid="indicators-period">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          data-testid={`indicators-period-${o.id}`}
          className={cn(
            "px-3 py-1 text-xs rounded-sm transition-colors",
            value === o.id ? "bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function IndicatorsPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [lastRefresh, setLastRefresh] = useState<Date>(() => new Date());
  const [bump, setBump] = useState(0); // force-refetch via queryKey nonce

  const refreshAll = () => {
    setLastRefresh(new Date());
    setBump((b) => b + 1);
  };

  const refreshKey = useMemo(() => bump, [bump]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
            <BarChart3 className="h-3.5 w-3.5" /> Indicadores
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold">Visão operacional do negócio</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Acompanha as áreas críticas em tempo quase real. Clica num card para abrir a lista filtrada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodTabs value={period} onChange={setPeriod} />
          <RefreshButton onRefresh={refreshAll} />
          <LastUpdated date={lastRefresh} />
        </div>
      </header>

      {AREAS.map((area) => (
        <section key={area.id} data-testid={`indicators-area-${area.id}`}>
          <div className="flex items-center gap-2 mb-3">
            <area.icon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {area.label}
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {area.items.map((def) => (
              <IndicatorCard
                key={`${def.key}-${refreshKey}`}
                def={def}
                period={period}
                areaIcon={area.icon}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="text-center pt-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">Voltar para Home</Link>
        </Button>
      </div>
    </div>
  );
}

export const __INDICATOR_AREAS_FOR_TEST = AREAS;
