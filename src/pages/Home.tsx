import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useInstalledModules } from "@/core/modules/useInstalledModules";
import { MODULES } from "@/core/modules/registry";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/lib/utils";
import {
  BarChart3, Bell, CheckSquare, ArrowRight, Search,
  AlertCircle, Inbox,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type Notif = {
  id: string;
  title: string | null;
  body: string | null;
  severity: string | null;
  created_at: string;
  link: string | null;
  read_at: string | null;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

function useCriticalNotifications() {
  return useQuery({
    queryKey: ["home-critical-notifs"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return [] as Notif[];
      const { data, error } = await supabase
        .from("notifications" as any)
        .select("id,title,body,severity,created_at,link,read_at")
        .eq("user_id", uid)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [] as Notif[];
      return (data ?? []) as unknown as Notif[];
    },
  });
}

function useMyTasks() {
  return useQuery({
    queryKey: ["home-my-tasks"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return [] as Task[];
      const { data, error } = await supabase
        .from("erp_tasks" as any)
        .select("id,title,status,priority,due_date,entity_type,entity_id")
        .eq("assigned_to", uid)
        .in("status", ["open", "in_progress", "blocked"])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(5);
      if (error) return [] as Task[];
      return (data ?? []) as unknown as Task[];
    },
  });
}

function entityLink(t: Task): string | null {
  if (!t.entity_type || !t.entity_id) return null;
  const map: Record<string, string> = {
    sale_order: `/sales/orders/${t.entity_id}`,
    purchase_order: `/purchase/orders/${t.entity_id}`,
    manufacturing_order: `/manufacturing/orders/${t.entity_id}`,
    delivery_route: `/routes/${t.entity_id}`,
    customer_ticket: `/helpdesk/tickets/${t.entity_id}`,
    service_case: `/service/requests/${t.entity_id}`,
    product: `/products/${t.entity_id}`,
  };
  return map[t.entity_type] ?? null;
}

function NotificationsBlock() {
  const { data, isLoading } = useCriticalNotifications();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-600" /> Notificações
        </h2>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center flex flex-col items-center gap-2">
          <Inbox className="h-5 w-5" /> Tudo em dia. Sem novas notificações.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((n) => {
            const Body = (
              <div className="flex items-start gap-2 rounded-md border p-2 hover:bg-muted/40 transition-colors">
                <AlertCircle className={cn("h-4 w-4 mt-0.5 shrink-0",
                  n.severity === "critical" ? "text-destructive" : "text-amber-600")} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{n.title ?? "Notificação"}</div>
                  {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.link ? <Link to={n.link}>{Body}</Link> : Body}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MyTasksBlock() {
  const { data, isLoading } = useMyTasks();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-primary" /> Minhas tarefas
        </h2>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center flex flex-col items-center gap-2">
          <CheckSquare className="h-5 w-5" /> Nenhuma tarefa em aberto.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((t) => {
            const overdue =
              t.due_date && new Date(t.due_date) < new Date();
            const to = entityLink(t);
            const Body = (
              <div className={cn(
                "flex items-start gap-2 rounded-md border p-2 hover:bg-muted/40 transition-colors",
                overdue && "border-destructive/40 bg-destructive/5",
              )}>
                <CheckSquare className={cn("h-4 w-4 mt-0.5 shrink-0",
                  overdue ? "text-destructive" : "text-primary")} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{t.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {overdue ? "Atrasada · " : ""}
                    {t.due_date
                      ? formatDistanceToNow(new Date(t.due_date), { addSuffix: true, locale: ptBR })
                      : "Sem prazo"}
                    {" · "}{t.priority}
                  </div>
                </div>
              </div>
            );
            return <li key={t.id}>{to ? <Link to={to}>{Body}</Link> : Body}</li>;
          })}
        </ul>
      )}
    </div>
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
            Bem-vindo de volta. Use <kbd className="border rounded px-1 text-[10px]">⌘K</kbd> para buscar.
          </p>
        </div>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" />
          Atalhos rápidos abaixo
        </div>
      </header>

      {/* CTA Indicadores */}
      <section>
        <Link
          to="/indicators"
          data-testid="home-cta-indicators"
          className="group flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 p-5 hover:shadow-elegant transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold">Indicadores</div>
              <div className="text-xs text-muted-foreground">
                Vendas, produção, compras, stock, logística, financeiro e assistência num só lugar.
              </div>
            </div>
          </div>
          <Button variant="default" size="sm" className="shrink-0" asChild>
            <span>Ver indicadores <ArrowRight className="h-3.5 w-3.5 ml-1" /></span>
          </Button>
        </Link>
      </section>

      {/* Notificações + Tarefas */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NotificationsBlock />
        <MyTasksBlock />
      </section>

      {/* Acesso rápido */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Acesso rápido aos módulos
        </h2>
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
