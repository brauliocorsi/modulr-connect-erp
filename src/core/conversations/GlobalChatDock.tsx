import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, X, Minus, ChevronLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type DockState = "closed" | "minimized" | "open";
const STORAGE_KEY = "erp.globalChatDock.state";
const SEEN_KEY = "erp.globalChatDock.seen";
const POLL_MS = 20000;

type ThreadRow = {
  id: string;
  title: string;
  status: string;
  visibility: "internal" | "customer_visible" | "mixed";
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message: string | null;
};
type MsgRow = {
  id: string;
  thread_id: string;
  sender_user_id: string | null;
  sender_type: string;
  message: string;
  visibility: string;
  created_at: string;
};

function readPersisted(): { state: DockState; threadId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: "closed", threadId: null };
    const v = JSON.parse(raw);
    return {
      state: ["closed", "minimized", "open"].includes(v.state) ? v.state : "closed",
      threadId: typeof v.threadId === "string" ? v.threadId : null,
    };
  } catch {
    return { state: "closed", threadId: null };
  }
}
function persist(state: DockState, threadId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, threadId }));
  } catch {
    /* noop */
  }
}
function readSeen(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeSeen(map: Record<string, string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

export default function GlobalChatDock() {
  const { user } = useAuth();
  const loc = useLocation();

  // Hide on portal/login/delivery shell (not under AppShell anyway, but be defensive)
  const hidden = loc.pathname.startsWith("/portal/") || loc.pathname.startsWith("/login");

  const initial = useMemo(readPersisted, []);
  const [dockState, setDockState] = useState<DockState>(initial.state);
  const [activeThread, setActiveThread] = useState<string | null>(initial.threadId);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [seen, setSeen] = useState<Record<string, string>>(readSeen);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persist(dockState, activeThread);
  }, [dockState, activeThread]);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    setLoadingThreads(true);
    setError(null);
    try {
      const { data: parts, error: pErr } = await supabase
        .from("conversation_participants")
        .select("thread_id, left_at")
        .eq("user_id", user.id)
        .is("left_at", null);
      if (pErr) throw pErr;
      const ids = Array.from(new Set((parts ?? []).map((p: any) => p.thread_id)));
      if (ids.length === 0) {
        setThreads([]);
        return;
      }
      const { data: ths, error: tErr } = await supabase
        .from("conversation_threads")
        .select("id, title, status, visibility, entity_type, entity_id, created_at")
        .in("id", ids)
        .order("created_at", { ascending: false })
        .limit(50);
      if (tErr) throw tErr;
      // last message per thread (single query, then reduce)
      const { data: lastMsgs } = await supabase
        .from("conversation_messages")
        .select("thread_id, message, created_at")
        .in("thread_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
      const lastMap = new Map<string, { message: string; created_at: string }>();
      for (const m of (lastMsgs ?? []) as any[]) {
        if (!lastMap.has(m.thread_id)) lastMap.set(m.thread_id, { message: m.message, created_at: m.created_at });
      }
      const merged: ThreadRow[] = (ths ?? []).map((t: any) => ({
        ...t,
        last_message: lastMap.get(t.id)?.message ?? null,
        last_message_at: lastMap.get(t.id)?.created_at ?? null,
      }));
      merged.sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
      setThreads(merged);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar conversas");
      setThreads([]);
    } finally {
      setLoadingThreads(false);
    }
  }, [user]);

  const fetchMessages = useCallback(async (tid: string) => {
    setLoadingMessages(true);
    try {
      const { data, error: mErr } = await supabase
        .from("conversation_messages")
        .select("id, thread_id, sender_user_id, sender_type, message, visibility, created_at")
        .eq("thread_id", tid)
        .order("created_at", { ascending: true })
        .limit(200);
      if (mErr) throw mErr;
      setMessages((data ?? []) as MsgRow[]);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar mensagens");
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Initial + polling
  useEffect(() => {
    if (!user || hidden) return;
    fetchThreads();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      fetchThreads();
      if (activeThread && dockState === "open") fetchMessages(activeThread);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [user, hidden, fetchThreads, fetchMessages, activeThread, dockState]);

  // Load messages when thread changes & dock is open
  useEffect(() => {
    if (!activeThread || dockState !== "open") return;
    fetchMessages(activeThread);
  }, [activeThread, dockState, fetchMessages]);

  // Auto-scroll
  useEffect(() => {
    if (dockState === "open" && messages?.length) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [messages, dockState]);

  // Mark seen when viewing thread
  useEffect(() => {
    if (dockState === "open" && activeThread && messages && messages.length > 0) {
      const last = messages[messages.length - 1].created_at;
      setSeen((prev) => {
        if (prev[activeThread] === last) return prev;
        const next = { ...prev, [activeThread]: last };
        writeSeen(next);
        return next;
      });
    }
  }, [dockState, activeThread, messages]);

  const unreadCount = useMemo(() => {
    if (!threads) return 0;
    return threads.filter((t) => t.last_message_at && (seen[t.id] ?? "") < t.last_message_at).length;
  }, [threads, seen]);

  const send = async () => {
    if (!activeThread || !text.trim()) return;
    setSending(true);
    try {
      const { error: sErr } = await supabase.rpc("conversation_add_message" as any, {
        _thread_id: activeThread,
        _message: text.trim(),
        _visibility: "internal",
        _metadata: {},
      });
      if (sErr) throw sErr;
      setText("");
      await Promise.all([fetchMessages(activeThread), fetchThreads()]);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  if (!user || hidden) return null;

  const activeThreadObj = activeThread ? threads?.find((t) => t.id === activeThread) ?? null : null;

  // Closed → floating launcher only
  if (dockState === "closed" || dockState === "minimized") {
    return (
      <button
        type="button"
        aria-label="Abrir chat"
        data-testid="global-chat-launcher"
        onClick={() => setDockState("open")}
        className={cn(
          "fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg grid place-items-center text-primary-foreground transition-all hover:scale-105",
          unreadCount > 0 ? "bg-primary animate-pulse" : "bg-primary",
        )}
      >
        <MessageCircle className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            data-testid="global-chat-unread-badge"
            className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    );
  }

  // Open
  return (
    <div
      data-testid="global-chat-panel"
      className="fixed bottom-4 right-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-2rem)] rounded-xl border bg-card shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="h-11 px-3 flex items-center gap-2 border-b bg-muted/50">
        {activeThread && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setActiveThread(null)}
            aria-label="Voltar"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <MessageCircle className="h-4 w-4 text-primary" />
        <div className="font-semibold text-sm flex-1 truncate">
          {activeThreadObj ? activeThreadObj.title : "Conversas"}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setDockState("minimized")}
          aria-label="Minimizar"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setDockState("closed")}
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      {!activeThread ? (
        <div className="flex-1 overflow-y-auto">
          {loadingThreads && !threads ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-destructive" data-testid="global-chat-error">
              {error}
            </div>
          ) : !threads || threads.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa ativa</div>
          ) : (
            <ul className="divide-y">
              {threads.map((t) => {
                const isUnread = t.last_message_at && (seen[t.id] ?? "") < t.last_message_at;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setActiveThread(t.id)}
                      data-testid={`global-chat-thread-${t.id}`}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("text-sm truncate flex-1", isUnread && "font-semibold")}>{t.title}</span>
                        <Badge
                          variant={t.visibility === "customer_visible" ? "secondary" : "outline"}
                          className="h-4 text-[10px] px-1.5 shrink-0"
                        >
                          {t.visibility === "customer_visible" ? (
                            <Eye className="h-2.5 w-2.5" />
                          ) : t.visibility === "mixed" ? (
                            "mixed"
                          ) : (
                            <EyeOff className="h-2.5 w-2.5" />
                          )}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate flex-1">
                          {t.last_message ?? "Sem mensagens"}
                        </span>
                        {t.last_message_at && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(t.last_message_at), { addSuffix: false, locale: ptBR })}
                          </span>
                        )}
                      </div>
                      {t.entity_type && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{t.entity_type}</div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loadingMessages && !messages ? (
              <div className="text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
              </div>
            ) : !messages || messages.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground">Sem mensagens.</div>
            ) : (
              messages.map((m) => {
                const mine = m.sender_user_id === user.id;
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.message}</div>
                      <div className={cn("text-[10px] mt-0.5 opacity-70 flex items-center gap-1")}>
                        {m.visibility === "customer_visible" && <Eye className="h-2.5 w-2.5" />}
                        <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t p-2 flex gap-2 items-end">
            <Textarea
              data-testid="global-chat-input"
              rows={1}
              placeholder="Mensagem…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="min-h-[36px] resize-none"
            />
            <Button
              size="sm"
              onClick={send}
              disabled={sending || !text.trim()}
              data-testid="global-chat-send"
            >
              Enviar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
