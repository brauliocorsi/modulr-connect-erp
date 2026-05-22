import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Clock, Eye, EyeOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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

const EVENT_LABEL: Record<string, string> = {
  sale_order_services_updated: "Serviços atualizados",
  sale_order_delivery_mode_updated: "Modo de entrega",
  sale_order_delivery_zone_updated: "Zona de entrega",
  sale_order_invoiced: "Faturado",
  sale_order_invoice_reverted: "Faturação revertida",
  service_case_created: "Caso criado",
  service_case_status_changed: "Status alterado",
  customer_ticket_created: "Ticket criado",
  customer_ticket_status_changed: "Status do ticket",
  delivery_schedule_requested: "Entrega proposta",
  delivery_schedule_scheduled: "Entrega agendada",
  delivery_schedule_confirmed: "Entrega confirmada",
  delivery_schedule_rescheduled: "Entrega reagendada",
  delivery_schedule_replaced: "Agendamento substituído",
  delivery_schedule_cancelled: "Agendamento cancelado",
};

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
    if (error) {
      setError(error.message);
      return;
    }
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
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entityType, entityId, load]);

  return (
    <div className={"border rounded-lg bg-card " + className}>
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center gap-2">
        <Clock className="h-4 w-4" /> Timeline
      </div>
      <div>
        {loading && events.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">A carregar…</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : events.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem eventos.</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="px-4 py-3 border-b last:border-b-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px] py-0 h-4">
                  {EVENT_LABEL[e.event_type] ?? e.event_type}
                </Badge>
                {e.visibility === "customer_visible" ? (
                  <span title="Visível ao cliente" className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" /> público
                  </span>
                ) : (
                  <span title="Interno" className="inline-flex items-center gap-1">
                    <EyeOff className="h-3 w-3" /> interno
                  </span>
                )}
                <span>·</span>
                <span>{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}</span>
              </div>
              {e.message && <div className="text-sm mt-1 whitespace-pre-wrap">{e.message}</div>}
              {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata).length > 0 && (
                <pre className="text-[11px] text-muted-foreground mt-1 bg-muted/40 rounded px-2 py-1 overflow-x-auto">
                  {JSON.stringify(e.metadata)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
