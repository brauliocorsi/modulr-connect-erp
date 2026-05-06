import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, FileText } from "lucide-react";

type Msg = {
  id: string;
  body: string | null;
  kind: string;
  author_id: string | null;
  created_at: string;
};

export function Chatter({ recordType, recordId }: { recordType: string; recordId: string }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [text, setText] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("record_messages")
      .select("*")
      .eq("record_type", recordType)
      .eq("record_id", recordId)
      .order("created_at", { ascending: false })
      .limit(50);
    setMsgs((data ?? []) as Msg[]);
    const ids = Array.from(new Set((data ?? []).map((m: any) => m.author_id).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => (map[p.id] = p.full_name ?? p.email ?? "Usuário"));
      setAuthors(map);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`chatter-${recordId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "record_messages", filter: `record_id=eq.${recordId}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const send = async () => {
    if (!text.trim() || !user) return;
    await supabase.from("record_messages").insert({
      record_type: recordType,
      record_id: recordId,
      author_id: user.id,
      kind: "comment",
      body: text.trim(),
    });
    setText("");
  };

  return (
    <div className="border rounded-lg bg-card">
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center gap-2">
        <MessageCircle className="h-4 w-4" /> Comunicação
      </div>
      <div className="p-4 space-y-3">
        <Textarea placeholder="Escreva um comentário…" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
        <div className="flex justify-end">
          <Button size="sm" onClick={send} disabled={!text.trim()}>
            Enviar
          </Button>
        </div>
      </div>
      <div className="border-t">
        {msgs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem mensagens ainda.</div>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className="px-4 py-3 border-b last:border-b-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {m.kind === "log" ? <FileText className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                <span className="font-medium text-foreground">{authors[m.author_id ?? ""] ?? "Sistema"}</span>
                <span>·</span>
                <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ptBR })}</span>
              </div>
              {m.body && <div className="text-sm mt-1 whitespace-pre-wrap">{m.body}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
