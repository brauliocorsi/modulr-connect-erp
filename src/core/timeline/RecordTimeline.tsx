import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Clock, Eye, EyeOff, FileText, Truck, Calendar, CheckCircle2, XCircle,
  RotateCcw, Wrench, Ticket, Banknote, ShieldCheck, MessageSquare, Activity,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Event = {
  id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  message: string | null;
  metadata: any;
  visibility: "internal" | "customer_visible" | string;
  actor_id: string | null;
  created_at: string;
};

type EventStyle = {
  label: string;
  icon: any;
  tone: string; // tailwind classes for the dot/icon background
};

const DEFAULT_STYLE: EventStyle = {
  label: "",
  icon: Activity,
  tone: "bg-muted text-muted-foreground",
};

const EVENT_STYLES: Record<string, EventStyle> = {
  // Vendas / faturação
  sale_order_services_updated:    { label: "Serviços atualizados",      icon: Wrench,        tone: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200" },
  sale_order_delivery_mode_updated:{ label: "Modo de entrega",          icon: Truck,         tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  sale_order_delivery_zone_updated:{ label: "Zona de entrega",          icon: Truck,         tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  sale_order_invoiced:            { label: "Faturado",                  icon: FileText,      tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  sale_order_invoice_reverted:    { label: "Faturação revertida",       icon: RotateCcw,     tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },

  // Assistência / Montagem
  service_case_created:           { label: "Montagem agendada",         icon: Wrench,        tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
  service_case_status_changed:    { label: "Montagem · status",         icon: Wrench,        tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
  service_case_done:              { label: "Montagem concluída",        icon: CheckCircle2,  tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  service_request_created:        { label: "Pedido de assistência",     icon: Wrench,        tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },

  customer_ticket_created:        { label: "Ticket criado",             icon: Ticket,        tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
  customer_ticket_status_changed: { label: "Status do ticket",          icon: Ticket,        tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },

  // Entrega / agendamento
  delivery_schedule_requested:    { label: "Entrega · proposta",        icon: Calendar,      tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  delivery_schedule_scheduled:    { label: "Entrega · agendada",        icon: Calendar,      tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  delivery_schedule_confirmed:    { label: "Entrega · confirmada",      icon: CheckCircle2,  tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  delivery_schedule_rescheduled:  { label: "Entrega · reagendada",      icon: RotateCcw,     tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  delivery_schedule_replaced:     { label: "Entrega · substituída",     icon: RotateCcw,     tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  delivery_schedule_cancelled:    { label: "Entrega · cancelada",       icon: XCircle,       tone: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
  delivery_schedule_delivered:    { label: "Entregue ao cliente",       icon: Truck,         tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },

  // Pagamentos / caixa
  customer_payment_posted:        { label: "Recebimento registado",     icon: Banknote,      tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  customer_payment_cancelled:     { label: "Recebimento cancelado",     icon: XCircle,       tone: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
  cash_session_reconciled:        { label: "Caixa conciliado",          icon: ShieldCheck,   tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },

  // Genéricos
  note_added:                     { label: "Nota",                      icon: MessageSquare, tone: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200" },
};

function styleFor(eventType: string): EventStyle {
  return EVENT_STYLES[eventType] ?? { ...DEFAULT_STYLE, label: eventType };
}

function humanMeta(metadata: any): { key: string; value: string }[] {
  if (!metadata || typeof metadata !== "object") return [];
  const out: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null || v === "") continue;
    if (typeof v === "object") continue; // skip nested
    out.push({ key: k, value: String(v) });
  }
  return out.slice(0, 6);
}

function dayKey(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd");
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Hoje";
  if (dayKey(iso) === dayKey(y.toISOString())) return "Ontem";
  return format(d, "d 'de' MMMM yyyy", { locale: ptBR });
}

export function RecordTimeline({
  entityType,
  entityId,
  includeCustomerVisible = false,
  className = "",
}: {
  entityType: string;
  entityId: string;
  includeCustomerVisible?: boolean;
  className?: string;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("activity_list_for_entity" as any, {
      _entity_type: entityType,
      _entity_id: entityId,
      _include_customer_visible: includeCustomerVisible,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setError(null);
    setEvents(Array.isArray(data) ? (data as Event[]) : []);
  }, [entityType, entityId, includeCustomerVisible]);

  useEffect(() => {
    if (!entityId) return;
    load();
    const ch = supabase
      .channel(`timeline-${entityType}-${entityId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events", filter: `entity_id=eq.${entityId}` },
        load,
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [entityType, entityId, load]);

  // Agrupar por dia
  const grouped = useMemo(() => {
    const g = new Map<string, Event[]>();
    for (const e of events) {
      const k = dayKey(e.created_at);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(e);
    }
    return Array.from(g.entries());
  }, [events]);

  return (
    <div className={"border rounded-lg bg-card " + className}>
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center gap-2">
        <Clock className="h-4 w-4" /> Timeline
      </div>
      <div className="p-4">
        {loading && events.length === 0 ? (
          <div className="text-sm text-muted-foreground">A carregar…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sem eventos.</div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([day, items]) => (
              <div key={day}>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">
                  {dayLabel(items[0].created_at)}
                </div>
                <ol className="relative border-l border-border ml-2 space-y-3">
                  {items.map((e) => {
                    const st = styleFor(e.event_type);
                    const Icon = st.icon;
                    const meta = humanMeta(e.metadata);
                    return (
                      <li key={e.id} className="ml-4">
                        <span
                          className={`absolute -left-3 mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-card ${st.tone}`}
                          aria-hidden
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="rounded-md border bg-background/50 px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{st.label}</span>
                            {e.visibility === "customer_visible" ? (
                              <span title="Visível ao cliente" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200 text-[10px]">
                                <Eye className="h-3 w-3" /> público
                              </span>
                            ) : (
                              <span title="Interno" className="inline-flex items-center gap-1 text-[10px]">
                                <EyeOff className="h-3 w-3" /> interno
                              </span>
                            )}
                            <span>·</span>
                            <span title={format(new Date(e.created_at), "Pp", { locale: ptBR })}>
                              {format(new Date(e.created_at), "HH:mm")} · {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                          {e.message && (
                            <div className="text-sm mt-1 whitespace-pre-wrap leading-snug">{e.message}</div>
                          )}
                          {meta.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {meta.map((m) => (
                                <span key={m.key} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  <span className="font-medium text-foreground/80">{m.key}:</span> {m.value}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
