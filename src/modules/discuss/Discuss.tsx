import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Hash, Plus, Send, Lock, Users, MessageCircle, ImageIcon, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";

type Channel = { id: string; name: string; kind: string; is_private: boolean; description: string | null };
type Message = { id: string; channel_id: string; author_id: string; body: string | null; mentions: string[]; created_at: string; image_url: string | null; attachments: any };
type Profile = { id: string; full_name: string | null; email: string | null };
type Member = { channel_id: string; user_id: string; last_read_at: string | null };

const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

export default function Discuss() {
  const { channelId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmSearch, setDmSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showChannels, setShowChannels] = useState(true);
  const [showDms, setShowDms] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("chat_channels").select("*").order("created_at").then(({ data }) => setChannels((data ?? []) as Channel[]));
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => setProfiles(data ?? []));
  }, []);

  const markRead = async (id: string) => {
    await supabase.rpc("discuss_mark_read", { _channel: id });
  };

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
    supabase
      .from("chat_channel_members")
      .select("channel_id,user_id,last_read_at")
      .eq("channel_id", channelId)
      .then(({ data }) => setMembers((data ?? []) as Member[]));
    markRead(channelId);
    const ch = supabase
      .channel(`discuss-${channelId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel_id=eq.${channelId}` }, (payload) => {
        setMessages((m) => [...m, payload.new as Message]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        markRead(channelId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_channel_members", filter: `channel_id=eq.${channelId}` }, (payload) => {
        setMembers((prev) => {
          const next = payload.new as Member;
          if (payload.eventType === "DELETE") {
            const old = payload.old as Member;
            return prev.filter((m) => m.user_id !== old.user_id);
          }
          const exists = prev.some((m) => m.user_id === next.user_id);
          return exists ? prev.map((m) => (m.user_id === next.user_id ? next : m)) : [...prev, next];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelId]);

  const readReceipts = useMemo(() => {
    // For each member, find the latest message they have read (created_at <= last_read_at)
    const map: Record<string, { user_id: string; at: string }[]> = {};
    for (const mem of members) {
      if (!mem.last_read_at) continue;
      if (user && mem.user_id === user.id) continue;
      const lr = new Date(mem.last_read_at).getTime();
      let lastId: string | null = null;
      for (const msg of messages) {
        if (msg.author_id === mem.user_id) continue;
        if (new Date(msg.created_at).getTime() <= lr) lastId = msg.id;
        else break;
      }
      if (lastId) {
        (map[lastId] ||= []).push({ user_id: mem.user_id, at: mem.last_read_at });
      }
    }
    return map;
  }, [members, messages, user]);

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const current = channels.find((c) => c.id === channelId);

  const sendMessage = async (body: string, imageUrl: string | null) => {
    if (!channelId || !user) return;
    const mentions = body
      ? Array.from(body.matchAll(/@([\w.@-]+)/g))
          .map((m) => profiles.find((p) => (p.full_name ?? p.email ?? "").toLowerCase().includes(m[1].toLowerCase()))?.id)
          .filter(Boolean) as string[]
      : [];
    const { error } = await supabase.from("chat_messages").insert({
      channel_id: channelId,
      author_id: user.id,
      body: body || null,
      mentions,
      image_url: imageUrl,
    });
    if (error) {
      toast.error("Não foi possível enviar a mensagem", { description: error.message });
      return false;
    }
    return true;
  };

  const send = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setText("");
    const ok = await sendMessage(body, null);
    if (!ok) setText(body);
  };

  const onPickImage = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || !channelId) return;
    if (!file.type.startsWith("image/")) { toast.error("Apenas imagens são permitidas"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Imagem máxima 10MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `${user.id}/${channelId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file, { contentType: file.type });
    if (upErr) { setUploading(false); toast.error("Erro no upload", { description: upErr.message }); return; }
    const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    await sendMessage(text.trim(), pub.publicUrl);
    setText("");
    setUploading(false);
  };

  const createChannel = async () => {
    if (!newName.trim() || !user) return;
    const { data, error } = await supabase.from("chat_channels").insert({ name: newName.trim(), created_by: user.id }).select().single();
    if (error || !data) { toast.error("Erro ao criar canal", { description: error?.message }); return; }
    await supabase.from("chat_channel_members").insert({ channel_id: data.id, user_id: user.id });
    setChannels((c) => [...c, data as Channel]);
    setNewName(""); setOpen(false);
    nav(`/discuss/${data.id}`);
  };

  const profileLabel = (p: Profile) => p.full_name ?? p.email ?? "Utilizador";

  const openDm = async (otherId: string) => {
    if (!user) { toast.error("Sessão inválida"); return; }
    if (otherId === user.id) return;
    const { data: newId, error } = await supabase.rpc("discuss_open_dm", { _other: otherId });
    if (error || !newId) { toast.error("Erro ao iniciar conversa", { description: error?.message }); return; }
    const id = newId as string;
    if (!channels.find((c) => c.id === id)) {
      const { data: ch } = await supabase.from("chat_channels").select("*").eq("id", id).maybeSingle();
      if (ch) setChannels((c) => [...c, ch as Channel]);
    }
    setDmOpen(false); setDmSearch("");
    nav(`/discuss/${id}`);
  };

  const dmDisplayName = (c: Channel) => {
    if (c.kind !== "dm" || !user) return c.name;
    const ids = c.name.replace(/^dm:/, "").split("|");
    const otherId = ids.find((i) => i !== user.id);
    const p = profiles.find((x) => x.id === otherId);
    return p ? profileLabel(p) : "Mensagem direta";
  };

  const channelList = channels.filter((c) => c.kind !== "dm");
  const dmList = channels.filter((c) => c.kind === "dm");

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
                <DialogHeader><DialogTitle>Nova mensagem direta</DialogTitle><DialogDescription>Selecione um utilizador para iniciar uma conversa privada.</DialogDescription></DialogHeader>
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
                <DialogHeader><DialogTitle>Novo canal</DialogTitle><DialogDescription>Crie um canal de conversa para a equipa.</DialogDescription></DialogHeader>
                <Input placeholder="nome-do-canal" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <DialogFooter><Button onClick={createChannel}>Criar</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-2">
          <div>
            <button onClick={() => setShowChannels((s) => !s)} className="w-full flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
              {showChannels ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Canais ({channelList.length})
            </button>
            {showChannels && (
              <div className="space-y-0.5 mt-1">
                {channelList.map((c) => (
                  <Link key={c.id} to={`/discuss/${c.id}`}
                    className={cn("flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted",
                      channelId === c.id && "bg-muted font-medium")}>
                    {c.is_private ? <Lock className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
                    <span className="truncate">{c.name}</span>
                  </Link>
                ))}
                {channelList.length === 0 && <div className="text-xs text-muted-foreground px-2 py-1">Sem canais.</div>}
              </div>
            )}
          </div>
          <div>
            <button onClick={() => setShowDms((s) => !s)} className="w-full flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
              {showDms ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Mensagens diretas ({dmList.length})
            </button>
            {showDms && (
              <div className="space-y-0.5 mt-1">
                {dmList.map((c) => (
                  <Link key={c.id} to={`/discuss/${c.id}`}
                    className={cn("flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted",
                      channelId === c.id && "bg-muted font-medium")}>
                    <MessageCircle className="h-3 w-3" />
                    <span className="truncate">{dmDisplayName(c)}</span>
                  </Link>
                ))}
                {dmList.length === 0 && <div className="text-xs text-muted-foreground px-2 py-1">Sem conversas.</div>}
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        {current ? (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2">
              {current.kind === "dm" ? <MessageCircle className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
              <div>
                <div className="font-semibold">{current.kind === "dm" ? dmDisplayName(current) : current.name}</div>
                {current.description && <div className="text-xs text-muted-foreground">{current.description}</div>}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {messages.map((m) => {
                const p = profileMap[m.author_id];
                const receipts = readReceipts[m.id] ?? [];
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
                      {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}
                      {m.image_url && (
                        <a href={m.image_url} target="_blank" rel="noreferrer" className="inline-block mt-1">
                          <img src={m.image_url} alt="anexo" className="max-h-72 max-w-sm rounded border object-contain" />
                        </a>
                      )}
                      {receipts.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>Visto por</span>
                          {receipts.map((r) => {
                            const rp = profileMap[r.user_id];
                            const name = rp?.full_name ?? rp?.email ?? "Utilizador";
                            return (
                              <span
                                key={r.user_id}
                                title={`${name} • ${fmtDateTime(r.at)}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted"
                              >
                                <span className="h-4 w-4 rounded-full bg-primary/15 grid place-items-center text-[9px] font-semibold">
                                  {name[0]?.toUpperCase()}
                                </span>
                                <span className="truncate max-w-[120px]">{name}</span>
                                <span className="opacity-70">{fmtTime(r.at)}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="border-t p-3 flex gap-2 items-end">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              <Button type="button" variant="ghost" size="icon" onClick={onPickImage} disabled={uploading} title="Enviar imagem">
                <ImageIcon className="h-4 w-4" />
              </Button>
              <Textarea rows={1} placeholder={uploading ? "A enviar imagem…" : current.kind === "dm" ? `Mensagem para ${dmDisplayName(current)}` : `Mensagem em #${current.name} — use @nome para mencionar`} value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <Button onClick={send} disabled={uploading}><Send className="h-4 w-4" /></Button>
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
