import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock, CheckCircle2, Phone, Mail, Users, ListTodo, Plus, Calendar } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Activity = {
  id: string;
  activity_type: string;
  summary: string;
  note: string | null;
  due_date: string | null;
  assigned_to: string | null;
  state: string;
  created_by: string | null;
};

const ICONS: Record<string, any> = { todo: ListTodo, call: Phone, email: Mail, meeting: Users };

export function ActivitiesPanel({ recordType, recordId }: { recordType: string; recordId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ activity_type: "todo", summary: "", note: "", due_date: "", assigned_to: "" });

  const load = async () => {
    const { data } = await supabase
      .from("record_activities")
      .select("*")
      .eq("record_type", recordType)
      .eq("record_id", recordId)
      .order("due_date", { ascending: true });
    setItems((data ?? []) as Activity[]);
  };

  useEffect(() => {
    load();
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => setUsers(data ?? []));
    const ch = supabase
      .channel(`activities-${recordId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "record_activities", filter: `record_id=eq.${recordId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const create = async () => {
    if (!form.summary.trim() || !user) return;
    await supabase.from("record_activities").insert({
      record_type: recordType,
      record_id: recordId,
      activity_type: form.activity_type,
      summary: form.summary.trim(),
      note: form.note || null,
      due_date: form.due_date || null,
      assigned_to: form.assigned_to || user.id,
      created_by: user.id,
    });
    setForm({ activity_type: "todo", summary: "", note: "", due_date: "", assigned_to: "" });
    setOpen(false);
  };

  const markDone = async (id: string) => {
    await supabase.from("record_activities").update({ state: "done", done_at: new Date().toISOString() }).eq("id", id);
  };

  const overdue = (d: string | null) => d && new Date(d) < new Date(new Date().toDateString());

  return (
    <div className="border rounded-lg bg-card">
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center justify-between">
        <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Atividades</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost"><Plus className="h-4 w-4 mr-1" /> Agendar</Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2">
            <Select value={form.activity_type} onValueChange={(v) => setForm({ ...form, activity_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">Tarefa</SelectItem>
                <SelectItem value="call">Chamada</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Reunião</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Resumo" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <Select value={form.assigned_to || user?.id || ""} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
              <SelectTrigger><SelectValue placeholder="Atribuir a" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea placeholder="Notas" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
            <Button size="sm" className="w-full" onClick={create}>Criar</Button>
          </PopoverContent>
        </Popover>
      </div>
      <div>
        {items.filter((i) => i.state === "open").length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">Sem atividades planeadas.</div>
        ) : (
          items.filter((i) => i.state === "open").map((a) => {
            const Icon = ICONS[a.activity_type] ?? ListTodo;
            const u = users.find((x) => x.id === a.assigned_to);
            return (
              <div key={a.id} className="px-4 py-2 border-b last:border-b-0 flex items-start gap-3">
                <Icon className={cn("h-4 w-4 mt-1", overdue(a.due_date) ? "text-destructive" : "text-muted-foreground")} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.summary}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    {a.due_date && (<><Calendar className="h-3 w-3" /> <span className={overdue(a.due_date) ? "text-destructive" : ""}>{fmtDate(a.due_date)}</span></>)}
                    {u && <span>· {u.full_name ?? u.email}</span>}
                  </div>
                  {a.note && <div className="text-xs mt-1 whitespace-pre-wrap">{a.note}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => markDone(a.id)}><CheckCircle2 className="h-4 w-4" /></Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
