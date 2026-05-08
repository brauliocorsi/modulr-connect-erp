import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Member = { channel_id: string; last_read_at: string };
type Channel = { id: string; name: string; kind: string; is_private: boolean };
type Msg = { id: string; channel_id: string; body: string; author_id: string; created_at: string };
type Profile = { id: string; full_name: string | null; email: string | null };

export function MessagesBell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Record<string, Channel>>({});
  const [recent, setRecent] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  const load = async () => {
    if (!user) return;
    const { data: mem } = await supabase
      .from("chat_channel_members")
      .select("channel_id, last_read_at")
      .eq("user_id", user.id);
    const memList = (mem ?? []) as Member[];
    setMembers(memList);
    if (memList.length === 0) { setRecent([]); return; }
    const ids = memList.map((m) => m.channel_id);
    const { data: chs } = await supabase.from("chat_channels").select("id, name, kind, is_private").in("id", ids);
    const chMap: Record<string, Channel> = {};
    (chs ?? []).forEach((c: any) => (chMap[c.id] = c));
    setChannels(chMap);
    const { data: msgs } = await supabase
      .from("chat_messages")
      .select("id, channel_id, body, author_id, created_at")
      .in("channel_id", ids)
      .neq("author_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setRecent((msgs ?? []) as Msg[]);
    const authorIds = Array.from(new Set((msgs ?? []).map((m: any) => m.author_id)));
    if (authorIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", authorIds);
      const pm: Record<string, Profile> = {};
      (profs ?? []).forEach((p: any) => (pm[p.id] = p));
      setProfiles(pm);
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("msgbell-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_channel_members", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const lastReadMap = Object.fromEntries(members.map((m) => [m.channel_id, m.last_read_at]));
  const unread = recent.filter((m) => {
    const lr = lastReadMap[m.channel_id];
    return !lr || new Date(m.created_at) > new Date(lr);
  });

  const open = async (channelId: string) => {
    if (!user) return;
    await supabase
      .from("chat_channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("channel_id", channelId);
    nav(`/discuss/${channelId}`);
  };

  const channelLabel = (c?: Channel) => {
    if (!c) return "Canal";
    return (c.kind === "dm" ? "" : "#") + c.name;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-topbar-foreground hover:bg-white/10">
          <MessageSquare className="h-5 w-5" />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-destructive text-[10px] grid place-items-center px-1 text-destructive-foreground">
              {unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-semibold">Mensagens</div>
          <Button variant="ghost" size="sm" onClick={() => nav("/discuss")}>Abrir Conversas</Button>
        </div>
        <ScrollArea className="max-h-96">
          {recent.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Sem mensagens</div>
          ) : (
            recent.map((m) => {
              const c = channels[m.channel_id];
              const p = profiles[m.author_id];
              const isUnread = unread.some((u) => u.id === m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => open(m.channel_id)}
                  className={"w-full text-left p-3 border-b last:border-b-0 hover:bg-accent/50 " + (isUnread ? "bg-accent/40" : "")}
                >
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{channelLabel(c)}</div>
                  <div className="font-medium text-sm">{p?.full_name ?? p?.email ?? "Utilizador"}</div>
                  <div className="text-sm text-muted-foreground line-clamp-2">{m.body}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}
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
