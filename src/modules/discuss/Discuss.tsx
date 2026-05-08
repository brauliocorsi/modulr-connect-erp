import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Hash, Plus, Send, Lock, Users, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";

type Channel = { id: string; name: string; kind: string; is_private: boolean; description: string | null };
type Message = { id: string; channel_id: string; author_id: string; body: string; mentions: string[]; created_at: string };
type Profile = { id: string; full_name: string | null; email: string | null };

export default function Discuss() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmSearch, setDmSearch] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("chat_channels").select("*").order("created_at").then(({ data }) => setChannels((data ?? []) as Channel[]));
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => setProfiles(data ?? []));
  }, []);

  useEffect(() => {
    if (!channelId) return;
    supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at")
      .limit(200)
      .then(({ data }) => {
        setMessages((data ?? []) as Message[]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      });
    const ch = supabase
      .channel(`discuss-${channelId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, (payload) => {
        setMessages((m) => [...m, payload.new as Message]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelId]);

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const current = channels.find((c) => c.id === channelId);

  const send = async () => {
    if (!text.trim() || !channelId || !user) return;
    const mentions = Array.from(text.matchAll(/@([\w.@-]+)/g))
      .map((m) => profiles.find((p) => (p.full_name ?? p.email ?? "").toLowerCase().includes(m[1].toLowerCase()))?.id)
      .filter(Boolean) as string[];
    await supabase.from("chat_messages").insert({ channel_id: channelId, author_id: user.id, body: text.trim(), mentions });
    setText("");
  };

  const createChannel = async () => {
    if (!newName.trim() || !user) return;
    const { data } = await supabase.from("chat_channels").insert({ name: newName.trim(), created_by: user.id }).select().single();
    if (data) {
      await supabase.from("chat_channel_members").insert({ channel_id: data.id, user_id: user.id });
      setChannels((c) => [...c, data as Channel]);
      setNewName(""); setOpen(false);
      nav(`/discuss/${data.id}`);
    }
  };

  const dmKey = (a: string, b: string) => "dm:" + [a, b].sort().join("|");
  const profileLabel = (p: Profile) => p.full_name ?? p.email ?? "Utilizador";

  const openDm = async (otherId: string) => {
    if (!user || otherId === user.id) return;
    const key = dmKey(user.id, otherId);
    const { data: existing } = await supabase
      .from("chat_channels").select("*").eq("kind", "dm").eq("name", key).maybeSingle();
    let channel = existing as Channel | null;
    if (!channel) {
      const otherProf = profiles.find((p) => p.id === otherId);
      const { data: created, error } = await supabase
        .from("chat_channels")
        .insert({ name: key, kind: "dm", is_private: true, created_by: user.id, description: otherProf ? `DM com ${profileLabel(otherProf)}` : "Mensagem direta" })
        .select().single();
      if (error || !created) return;
      channel = created as Channel;
      await supabase.from("chat_channel_members").insert([
        { channel_id: channel.id, user_id: user.id },
        { channel_id: channel.id, user_id: otherId },
      ]);
      setChannels((c) => [...c, channel as Channel]);
    }
    setDmOpen(false); setDmSearch("");
    nav(`/discuss/${channel.id}`);
  };

  const dmDisplayName = (c: Channel) => {
    if (c.kind !== "dm" || !user) return c.name;
    // name is sorted user ids joined by "|" prefixed with "dm:"
    const ids = c.name.replace(/^dm:/, "").split("|");
    const otherId = ids.find((i) => i !== user.id);
    const p = profiles.find((x) => x.id === otherId);
    return p ? profileLabel(p) : "Mensagem direta";
  };

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="p-3 border-b flex items-center justify-between gap-1">
          <span className="font-semibold text-sm">Conversas</span>
          <div className="flex items-center">
            <Dialog open={dmOpen} onOpenChange={setDmOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" title="Nova mensagem direta"><MessageCircle className="h-4 w-4" /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Nova mensagem direta</DialogTitle></DialogHeader>
                <Input placeholder="Buscar utilizador…" value={dmSearch} onChange={(e) => setDmSearch(e.target.value)} />
                <div className="max-h-72 overflow-auto border rounded-md divide-y">
                  {profiles
                    .filter((p) => p.id !== user?.id)
                    .filter((p) => {
                      const q = dmSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (p.full_name ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q);
                    })
                    .slice(0, 50)
                    .map((p) => (
                      <button key={p.id} onClick={() => openDm(p.id)}
                        className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/15 grid place-items-center text-xs font-semibold">
                          {profileLabel(p)[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{profileLabel(p)}</div>
                          {p.email && <div className="text-xs text-muted-foreground truncate">{p.email}</div>}
                        </div>
                      </button>
                    ))}
                  {profiles.filter((p) => p.id !== user?.id).length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">Nenhum utilizador disponível.</div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" title="Novo canal"><Plus className="h-4 w-4" /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Novo canal</DialogTitle></DialogHeader>
                <Input placeholder="nome-do-canal" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <DialogFooter><Button onClick={createChannel}>Criar</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-0.5">
          {channels.map((c) => (
            <Link key={c.id} to={`/discuss/${c.id}`}
              className={cn("flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted",
                channelId === c.id && "bg-muted font-medium")}>
              {c.is_private ? <Lock className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
              {c.name}
            </Link>
          ))}
          {channels.length === 0 && <div className="text-xs text-muted-foreground p-2">Crie o primeiro canal.</div>}
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        {current ? (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Hash className="h-4 w-4" />
              <div>
                <div className="font-semibold">{current.name}</div>
                {current.description && <div className="text-xs text-muted-foreground">{current.description}</div>}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.map((m) => {
                const p = profileMap[m.author_id];
                return (
                  <div key={m.id} className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/15 grid place-items-center text-xs font-semibold">
                      {(p?.full_name ?? p?.email ?? "?")[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{p?.full_name ?? p?.email ?? "Utilizador"}</span>
                        <span className="ml-2">{fmtDateTime(m.created_at)}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="border-t p-3 flex gap-2">
              <Textarea rows={1} placeholder={`Mensagem em #${current.name} — use @nome para mencionar`} value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <Button onClick={send}><Send className="h-4 w-4" /></Button>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-muted-foreground">
            <div className="text-center"><Users className="h-12 w-12 mx-auto mb-2" /><p>Selecione um canal</p></div>
          </div>
        )}
      </section>
    </div>
  );
}
