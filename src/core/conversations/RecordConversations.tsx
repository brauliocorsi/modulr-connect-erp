import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Plus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Thread = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  created_at: string;
};
type Msg = {
  id: string;
  thread_id: string;
  author_id: string | null;
  body: string;
  visibility: "internal" | "customer_visible" | string;
  created_at: string;
};

export function RecordConversations({
  entityType,
  entityId,
  /** when true, internal-only messages are hidden (e.g. customer-facing view) */
  customerView = false,
  className = "",
}: {
  entityType: string;
  entityId: string;
  customerView?: boolean;
  className?: string;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "customer_visible">("internal");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.rpc("conversation_list_for_entity" as any, {
      _entity_type: entityType,
      _entity_id: entityId,
    });
    const arr = (Array.isArray(data) ? (data as Thread[]) : []).filter(
      (t) => !customerView || t.visibility === "customer_visible",
    );
    setThreads(arr);
    if (!active && arr.length) setActive(arr[0].id);
  }, [entityType, entityId, customerView, active]);

  const loadMessages = useCallback(
    async (tid: string) => {
      const { data } = await supabase.rpc("conversation_messages" as any, {
        _thread_id: tid,
        _visibility_filter: customerView ? "customer_visible" : null,
      });
      setMessages(Array.isArray(data) ? (data as Msg[]) : []);
    },
    [customerView],
  );

  useEffect(() => {
    if (!entityId) return;
    loadThreads();
  }, [entityId, loadThreads]);

  useEffect(() => {
    if (!active) return;
    loadMessages(active);
    const ch = supabase
      .channel(`conv-${active}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `thread_id=eq.${active}` },
        () => loadMessages(active),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [active, loadMessages]);

  const createThread = async () => {
    if (!newTitle.trim()) return toast.error("Título obrigatório");
    setCreating(true);
    const { data, error } = await supabase.rpc("conversation_create" as any, {
      _payload: {
        entity_type: entityType,
        entity_id: entityId,
        title: newTitle,
        visibility: customerView ? "customer_visible" : "internal",
      },
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    setNewTitle("");
    await loadThreads();
    if (data) setActive(data as string);
  };

  const send = async () => {
    if (!active || !text.trim()) return;
    const { error } = await supabase.rpc("conversation_add_message" as any, {
      _thread_id: active,
      _message: text,
      _visibility: customerView ? "customer_visible" : visibility,
      _metadata: {},
    });
    if (error) return toast.error(error.message);
    setText("");
  };

  return (
    <div className={"border rounded-lg bg-card " + className}>
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center gap-2">
        <MessageCircle className="h-4 w-4" /> Conversas
      </div>

      <div className="p-3 border-b flex gap-2">
        <Input
          placeholder="Nova conversa…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="h-8"
        />
        <Button size="sm" onClick={createThread} disabled={creating || !newTitle.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {threads.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">Sem conversas.</div>
      ) : (
        <>
          <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={
                  "text-xs px-2 py-1 rounded whitespace-nowrap " +
                  (active === t.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80")
                }
              >
                {t.title}
                {t.visibility === "customer_visible" ? (
                  <Eye className="inline h-3 w-3 ml-1" />
                ) : (
                  <EyeOff className="inline h-3 w-3 ml-1" />
                )}
              </button>
            ))}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Sem mensagens.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="px-4 py-2 border-b last:border-b-0">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant={m.visibility === "customer_visible" ? "secondary" : "outline"} className="h-4 text-[10px]">
                      {m.visibility === "customer_visible" ? "público" : "interno"}
                    </Badge>
                    <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap mt-0.5">{m.body}</div>
                </div>
              ))
            )}
          </div>

          {active && (
            <div className="p-3 border-t space-y-2">
              <Textarea
                rows={2}
                placeholder="Escreva uma mensagem…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center justify-between">
                {!customerView && (
                  <div className="flex gap-1 text-xs">
                    <button
                      className={"px-2 py-0.5 rounded " + (visibility === "internal" ? "bg-muted" : "")}
                      onClick={() => setVisibility("internal")}
                    >
                      Interno
                    </button>
                    <button
                      className={"px-2 py-0.5 rounded " + (visibility === "customer_visible" ? "bg-muted" : "")}
                      onClick={() => setVisibility("customer_visible")}
                    >
                      Visível ao cliente
                    </button>
                  </div>
                )}
                <Button size="sm" onClick={send} disabled={!text.trim()}>
                  Enviar
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
