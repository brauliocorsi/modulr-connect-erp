import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { History } from "lucide-react";

type LogRow = {
  id: string;
  body: string | null;
  payload: any;
  created_at: string;
  author_id: string | null;
  author?: { full_name?: string | null; email?: string | null } | null;
};

export function CashSessionAuditLog({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("record_messages")
        .select("id, body, payload, created_at, author_id")
        .eq("record_type", "cash_session")
        .eq("record_id", sessionId)
        .eq("kind", "log")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as LogRow[];
      const ids = Array.from(new Set(list.map((r) => r.author_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, email").in("id", ids);
        const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
        for (const r of list) r.author = r.author_id ? map.get(r.author_id) : null;
      }
      if (alive) { setRows(list); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  return (
    <Card className="p-4 mb-4">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2">
        <History className="h-4 w-4" /> Histórico / Auditoria
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground">A carregar…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">Sem eventos registados.</div>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="border-l-2 border-muted pl-3 py-1">
              <div className="text-sm">{r.body ?? "—"}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <span>{new Date(r.created_at).toLocaleString("pt-PT")}</span>
                <span>·</span>
                <span>{r.author?.full_name || r.author?.email || "sistema"}</span>
              </div>
              {r.payload && Object.keys(r.payload).length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs text-muted-foreground cursor-pointer">payload</summary>
                  <pre className="text-[11px] bg-muted/40 rounded p-2 mt-1 overflow-x-auto">
{JSON.stringify(r.payload, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
