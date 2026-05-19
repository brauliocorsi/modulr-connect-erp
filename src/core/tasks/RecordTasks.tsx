import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckSquare, Play, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null;
  assigned_to: string | null;
  assigned_group: string | null;
  created_at: string;
  completed_at: string | null;
};

const statusTone: Record<string, string> = {
  open: "secondary",
  in_progress: "default",
  blocked: "destructive",
  done: "outline",
  cancelled: "outline",
};
const prioTone: Record<string, string> = {
  low: "outline",
  normal: "secondary",
  high: "default",
  urgent: "destructive",
};

export function RecordTasks({
  entityType,
  entityId,
  className = "",
}: {
  entityType: string;
  entityId: string;
  className?: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("normal");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("erp_tasks")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    setLoading(false);
    setTasks((data ?? []) as Task[]);
  }, [entityType, entityId]);

  useEffect(() => {
    if (!entityId) return;
    load();
    const ch = supabase
      .channel(`tasks-${entityType}-${entityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "erp_tasks", filter: `entity_id=eq.${entityId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entityType, entityId, load]);

  const create = async () => {
    if (!title.trim()) return toast.error("Título obrigatório");
    setBusy(true);
    const { error } = await supabase.rpc("erp_task_create" as any, {
      _payload: {
        title,
        description: desc || null,
        priority,
        due_date: due || null,
        entity_type: entityType,
        entity_id: entityId,
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setOpen(false);
    setTitle("");
    setDesc("");
    setDue("");
    setPriority("normal");
    load();
  };

  const start = async (id: string) => {
    const { error } = await supabase.rpc("erp_task_start" as any, { _task_id: id });
    if (error) toast.error(error.message);
  };
  const complete = async (id: string) => {
    const { error } = await supabase.rpc("erp_task_complete" as any, { _task_id: id, _notes: null });
    if (error) toast.error(error.message);
  };
  const cancel = async (id: string) => {
    const r = prompt("Motivo do cancelamento?");
    if (!r) return;
    const { error } = await supabase.rpc("erp_task_cancel" as any, { _task_id: id, _reason: r });
    if (error) toast.error(error.message);
  };

  const isOverdue = (t: Task) =>
    t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date();

  return (
    <div className={"border rounded-lg bg-card " + className}>
      <div className="px-4 py-2 border-b text-sm font-semibold flex items-center justify-between">
        <span className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4" /> Tarefas
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nova
        </Button>
      </div>
      <div>
        {loading && tasks.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">A carregar…</div>
        ) : tasks.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem tarefas.</div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="px-4 py-3 border-b last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{t.title}</div>
                  {t.description && <div className="text-xs text-muted-foreground line-clamp-2">{t.description}</div>}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge variant={statusTone[t.status] as any}>{t.status}</Badge>
                    <Badge variant={prioTone[t.priority] as any}>{t.priority}</Badge>
                    {t.due_date && (
                      <Badge variant={isOverdue(t) ? "destructive" : "outline"} className="text-[10px]">
                        {isOverdue(t) ? "Atrasada · " : ""}
                        {formatDistanceToNow(new Date(t.due_date), { addSuffix: true, locale: ptBR })}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {t.status === "open" && (
                    <Button size="sm" variant="ghost" onClick={() => start(t.id)} title="Iniciar">
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {(t.status === "open" || t.status === "in_progress" || t.status === "blocked") && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => complete(t.id)} title="Concluir">
                        <CheckSquare className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => cancel(t.id)} title="Cancelar">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Descrição (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
              <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={busy || !title.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
