import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

import { MessageCircle, Hash, X, Minus, ChevronLeft, Eye, EyeOff, Loader2, AtSign, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { inferEntityContextFromPath } from "./inferEntityContext";

type DockState = "closed" | "minimized" | "open";
const STORAGE_KEY = "erp.globalChatDock.state";
const POLL_MS = 20000;

type UnifiedThread = {
  id: string;
  thread_type: "dm" | "channel" | "entity" | "support";
  title: string;
  entity_type: string | null;
  entity_id: string | null;
  channel_id: string | null;
  visibility: "internal" | "customer_visible" | "mixed";
  status: string;
  last_activity: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  last_read_at: string | null;
  pinned: boolean;
  muted: boolean;
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

type TabKey = "all" | "dm" | "channel" | "entity" | "page";

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

function threadIcon(t: UnifiedThread) {
  if (t.thread_type === "channel") return <Hash className="h-3 w-3" />;
  if (t.thread_type === "dm") return <AtSign className="h-3 w-3" />;
  return <Inbox className="h-3 w-3" />;
}

export default function GlobalChatDock() {
  const { user } = useAuth();
  const loc = useLocation();
  const hidden = loc.pathname.startsWith("/portal/") || loc.pathname.startsWith("/login");

  const pageCtx = useMemo(() => inferEntityContextFromPath(loc.pathname), [loc.pathname]);

  const initial = useMemo(readPersisted, []);
  const [dockState, setDockState] = useState<DockState>(initial.state);
  const [activeThread, setActiveThread] = useState<string | null>(initial.threadId);
  const [threads, setThreads] = useState<UnifiedThread[] | null>(null);
  const [messages, setMessages] = useState<MsgRow[] | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persist(dockState, activeThread);
  }, [dockState, activeThread]);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    setLoadingThreads(true);
    setError(null);
    try {
      const { data, error: rErr } = await supabase.rpc("conversation_unified_list" as any, { _limit: 50 });
      if (rErr) throw rErr;
      const arr = (Array.isArray(data) ? data : []) as UnifiedThread[];
      setThreads(arr);
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
      const { data, error: mErr } = await supabase.rpc("conversation_get_messages" as any, {
        _thread_id: tid,
        _limit: 100,
      });
      if (mErr) throw mErr;
      setMessages((Array.isArray(data) ? data : []) as MsgRow[]);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar mensagens");
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const markRead = useCallback(
    async (tid: string) => {
      try {
        await supabase.rpc("conversation_mark_read" as any, { _thread_id: tid });
        setThreads((prev) => prev?.map((t) => (t.id === tid ? { ...t, unread_count: 0 } : t)) ?? prev);
      } catch {
        /* silent */
      }
    },
    [],
  );

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

  // Realtime: refresh threads on any new message; refresh active thread messages if it matches
  useEffect(() => {
    if (!user || hidden) return;
    if (typeof (supabase as any).channel !== "function") return;
    const channel = (supabase as any)
      .channel(`global-chat-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages" },
        (payload: any) => {
          const tid = payload?.new?.thread_id;
          fetchThreads();
          if (tid && tid === activeThread && dockState === "open") {
            fetchMessages(activeThread);
            markRead(activeThread);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => {
          fetchThreads();
          if (activeThread && dockState === "open") fetchMessages(activeThread);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `user_id=eq.${user.id}` },
        () => { fetchThreads(); },
      )
      .subscribe();
    return () => {
      try { (supabase as any).removeChannel?.(channel); } catch { /* noop */ }
    };
  }, [user, hidden, activeThread, dockState, fetchThreads, fetchMessages, markRead]);

  // Load messages + mark read when thread opens
  useEffect(() => {
    if (!activeThread || dockState !== "open") return;
    fetchMessages(activeThread);
    markRead(activeThread);
  }, [activeThread, dockState, fetchMessages, markRead]);

  // Auto-scroll
  useEffect(() => {
    if (dockState === "open" && messages?.length) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [messages, dockState]);

  const unreadTotal = useMemo(
    () => (threads ?? []).reduce((acc, t) => acc + (t.unread_count || 0), 0),
    [threads],
  );

  const filtered = useMemo(() => {
    const list = threads ?? [];
    if (tab === "all") return list;
    if (tab === "dm") return list.filter((t) => t.thread_type === "dm");
    if (tab === "channel") return list.filter((t) => t.thread_type === "channel");
    if (tab === "entity") return list.filter((t) => t.thread_type === "entity" || t.thread_type === "support");
    if (tab === "page") {
      if (!pageCtx) return [];
      return list.filter((t) => t.entity_type === pageCtx.entityType && t.entity_id === pageCtx.entityId);
    }
    return list;
  }, [threads, tab, pageCtx]);

  const send = async () => {
    if (!activeThread || !text.trim()) return;
    setSending(true);
    try {
      const { error: sErr } = await supabase.rpc("conversation_send_message" as any, {
        _thread_id: activeThread,
        _body: text.trim(),
        _visibility: "internal",
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

  // Closed / minimized → floating launcher
  if (dockState === "closed" || dockState === "minimized") {
    return (
      <button
        type="button"
        aria-label="Abrir chat"
        data-testid="global-chat-launcher"
        onClick={() => setDockState("open")}
        className={cn(
          "fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg grid place-items-center text-primary-foreground transition-all hover:scale-105 bg-primary",
          unreadTotal > 0 && "animate-pulse",
        )}
      >
        <MessageCircle className="h-5 w-5" />
        {unreadTotal > 0 && (
          <span
            data-testid="global-chat-unread-badge"
            className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center"
          >
            {unreadTotal > 9 ? "9+" : unreadTotal}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      data-testid="global-chat-panel"
      className="fixed bottom-4 right-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-2rem)] rounded-xl border bg-card shadow-2xl flex flex-col overflow-hidden"
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
        <div className="flex-1 overflow-hidden flex flex-col">
          <div role="tablist" className="mx-2 mt-2 grid grid-cols-5 gap-1 p-1 rounded-md bg-muted">
            {([
              { k: "all", label: "Todas" },
              { k: "dm", label: "DMs" },
              { k: "channel", label: "Canais" },
              { k: "entity", label: "Entidades" },
              { k: "page", label: "Página" },
            ] as Array<{ k: TabKey; label: string }>).map((t) => {
              const isActive = tab === t.k;
              const isDisabled = t.k === "page" && !pageCtx;
              return (
                <button
                  key={t.k}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`global-chat-tabpanel-${t.k}`}
                  data-state={isActive ? "active" : "inactive"}
                  disabled={isDisabled}
                  onClick={() => setTab(t.k)}
                  title={t.k === "page" && pageCtx ? pageCtx.label : undefined}
                  className={cn(
                    "text-[11px] px-1 py-1 rounded-sm font-medium transition-colors",
                    isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    isDisabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`global-chat-tabpanel-${tab}`}
            className="flex-1 overflow-y-auto mt-2"
          >
            {loadingThreads && !threads ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
              </div>
            ) : error ? (
              <div className="p-6 text-center text-sm text-destructive" data-testid="global-chat-error">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {tab === "page" && !pageCtx ? "Sem contexto de página" : "Nenhuma conversa"}
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((t) => {
                  const isUnread = (t.unread_count || 0) > 0;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setActiveThread(t.id)}
                        data-testid={`global-chat-thread-${t.id}`}
                        className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground shrink-0">{threadIcon(t)}</span>
                          <span className={cn("text-sm truncate flex-1", isUnread && "font-semibold")}>
                            {t.title}
                          </span>
                          {isUnread && (
                            <span className="shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                              {t.unread_count > 9 ? "9+" : t.unread_count}
                            </span>
                          )}
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
                        <div className="flex items-center gap-2 mt-0.5 pl-5">
                          <span className="text-xs text-muted-foreground truncate flex-1">
                            {t.last_message ?? "Sem mensagens"}
                          </span>
                          {t.last_activity && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(t.last_activity), { addSuffix: false, locale: ptBR })}
                            </span>
                          )}
                        </div>
                        {t.entity_type && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 pl-5">{t.entity_type}</div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
                      <div className="text-[10px] mt-0.5 opacity-70 flex items-center gap-1">
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
            <Button size="sm" onClick={send} disabled={sending || !text.trim()} data-testid="global-chat-send">
              Enviar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
