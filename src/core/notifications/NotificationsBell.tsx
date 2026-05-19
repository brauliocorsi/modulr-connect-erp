import { useCallback, useEffect, useState } from "react";
import { Bell, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Notif = {
  id: string;
  title: string | null;
  body: string | null;
  module: string | null;
  category: string | null;
  severity: "info" | "warning" | "critical" | null;
  status: "unread" | "read" | "archived" | null;
  recipient_group: string | null;
  user_id: string | null;
  read_at: string | null;
  created_at: string;
};

const sevIcon = (s: string | null) => {
  if (s === "critical") return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  if (s === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
};

export function NotificationsBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("notification_list_for_user" as any, {
      _category: null,
      _status: null,
      _limit: 30,
    });
    setLoading(false);
    if (error) return;
    setItems((Array.isArray(data) ? (data as Notif[]) : []));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("notif-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, load]);

  const unread = items.filter((i) => (i.status ? i.status === "unread" : !i.read_at)).length;

  const markOne = async (id: string) => {
    await supabase.rpc("notification_mark_read" as any, { _notification_id: id });
    load();
  };

  const markAll = async () => {
    await supabase.rpc("notification_mark_all_read" as any, { _category: null });
    load();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-topbar-foreground hover:bg-white/10">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-destructive text-[10px] grid place-items-center px-1 text-destructive-foreground">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-semibold">Notificações</div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll}>
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {loading && items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">A carregar…</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Sem notificações</div>
          ) : (
            items.map((n) => {
              const isUnread = n.status ? n.status === "unread" : !n.read_at;
              return (
                <button
                  key={n.id}
                  onClick={() => isUnread && markOne(n.id)}
                  className={"w-full text-left p-3 border-b last:border-b-0 hover:bg-accent/30 " + (isUnread ? "bg-accent/40" : "")}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {sevIcon(n.severity)}
                    {n.category && <Badge variant="outline" className="text-[10px] py-0 h-4">{n.category}</Badge>}
                    {n.recipient_group && <Badge variant="secondary" className="text-[10px] py-0 h-4">{n.recipient_group}</Badge>}
                    {n.module && <span className="uppercase tracking-wide">{n.module}</span>}
                  </div>
                  {n.title && <div className="font-medium text-sm mt-0.5">{n.title}</div>}
                  {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                  </div>
                </button>
              );
            })
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
