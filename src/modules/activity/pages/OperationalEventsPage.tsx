import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/core/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, RefreshCw, Eye, EyeOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRealtimeChannel } from "@/core/realtime";

type Event = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  event_type: string;
  message: string | null;
  metadata: any;
  visibility: string | null;
  actor_user_id: string | null;
  created_at: string;
};

const LIMIT = 200;

export default function OperationalEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("activity_events")
      .select("id,entity_type,entity_id,event_type,message,metadata,visibility,actor_user_id,created_at")
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setEvents((data ?? []) as Event[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeChannel({
    channel: "operational-events-feed",
    filters: [{ table: "activity_events", event: "INSERT" }],
    onChange: load,
    debounceMs: 500,
  });

  const entityTypes = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => e.entity_type && s.add(e.entity_type));
    return Array.from(s).sort();
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (entityType !== "all" && e.entity_type !== entityType) return false;
      if (!q) return true;
      return (
        e.event_type.toLowerCase().includes(q) ||
        (e.message ?? "").toLowerCase().includes(q) ||
        (e.entity_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, search, entityType]);

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Eventos Operacionais"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-4 w-4 mr-1 " + (loading ? "animate-spin" : "")} />
            Atualizar
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Pesquisar evento, tipo ou mensagem…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Tipo de entidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as entidades</SelectItem>
            {entityTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary">{filtered.length} eventos</Badge>
      </div>

      <div className="border rounded-lg bg-card">
        {error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : loading && events.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">A carregar…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Sem eventos.</div>
        ) : (
          <ScrollArea className="h-[calc(100vh-260px)]">
            {filtered.map((e) => (
              <div key={e.id} className="px-4 py-3 border-b last:border-b-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <Clock className="h-3 w-3" />
                  <span>{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-[10px] py-0 h-4">
                    {e.event_type}
                  </Badge>
                  {e.entity_type && (
                    <Badge variant="secondary" className="text-[10px] py-0 h-4">
                      {e.entity_type}
                    </Badge>
                  )}
                  {e.visibility === "customer_visible" ? (
                    <span className="inline-flex items-center gap-1" title="Visível ao cliente">
                      <Eye className="h-3 w-3" /> público
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1" title="Interno">
                      <EyeOff className="h-3 w-3" /> interno
                    </span>
                  )}
                </div>
                {e.message && <div className="text-sm mt-1 whitespace-pre-wrap">{e.message}</div>}
                {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata).length > 0 && (
                  <pre className="text-[11px] text-muted-foreground mt-1 bg-muted/40 rounded px-2 py-1 overflow-x-auto">
                    {JSON.stringify(e.metadata)}
                  </pre>
                )}
              </div>
            ))}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
