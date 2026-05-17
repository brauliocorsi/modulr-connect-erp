import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Play, Pause, Check, AlertTriangle, ShieldCheck, RotateCw, Cog } from "lucide-react";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/format";

type WO = any;

const STATE_LABELS: Record<string, string> = {
  pending: "Aguardando",
  ready: "Pronta",
  in_progress: "Em execução",
  paused: "Pausada",
  blocked: "Bloqueada",
  done: "Concluída",
};

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  ready: "secondary",
  in_progress: "default",
  paused: "outline",
  blocked: "destructive",
  done: "secondary",
};

export function WorkOrderStateBadge({ state }: { state: string }) {
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{STATE_LABELS[state] ?? state}</Badge>;
}

interface Props {
  moId: string;
  compact?: boolean;
}

export default function WorkOrdersSection({ moId, compact }: Props) {
  const qc = useQueryClient();
  const [startWO, setStartWO] = useState<WO | null>(null);
  const [finishWO, setFinishWO] = useState<WO | null>(null);
  const [pauseWO, setPauseWO] = useState<WO | null>(null);
  const [issueWO, setIssueWO] = useState<WO | null>(null);
  const [qcWO, setQcWO] = useState<WO | null>(null);
  const [busy, setBusy] = useState(false);

  const wosQ = useQuery({
    queryKey: ["wo-section", moId],
    enabled: !!moId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mo_operations")
        .select("*, work_center:work_centers(name,code), machine:manufacturing_machines(name,status), employee:hr_employees!mo_operations_assigned_employee_id_fkey(full_name)")
        .eq("mo_id", moId)
        .order("sequence");
      if (error) throw error;
      return data ?? [];
    },
  });

  const issuesQ = useQuery({
    queryKey: ["wo-issues", moId],
    enabled: !!moId,
    queryFn: async () =>
      (await supabase.from("mo_issues").select("*").eq("mo_id", moId).is("resolved_at", null)).data ?? [],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wo-section", moId] });
    qc.invalidateQueries({ queryKey: ["wo-issues", moId] });
    qc.invalidateQueries({ queryKey: ["mo", moId] });
    qc.invalidateQueries({ queryKey: ["sf-board-wo"] });
  };

  const materialize = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("mfg_materialize_work_orders", { _mo_id: moId });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Work orders materializadas"); refresh(); }
  };

  const resume = async (wo: WO) => {
    setBusy(true);
    const { error } = await supabase.rpc("work_order_resume", { _work_order_id: wo.id });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Retomada"); refresh(); }
  };

  const issuesByOp = (opId: string) => (issuesQ.data ?? []).filter((i: any) => i.mo_operation_id === opId);

  const wos = wosQ.data ?? [];

  if (!wos.length) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">Sem work orders materializadas para esta ordem.</div>
        <Button size="sm" disabled={busy} onClick={materialize}>
          <Cog className="h-4 w-4 mr-2" /> Materializar Work Orders
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2">#</th>
              <th>Operação</th>
              {!compact && <th>Centro</th>}
              {!compact && <th>Máquina</th>}
              {!compact && <th>Funcionário</th>}
              <th>Estado</th>
              <th>Plan/Real (min)</th>
              <th>Qtd / Refugo</th>
              <th>Issues</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {wos.map((o: any) => {
              const opIssues = issuesByOp(o.id);
              return (
                <tr key={o.id} className="border-b last:border-0 align-top">
                  <td className="py-2">{o.sequence}</td>
                  <td>
                    <div className="font-medium">{o.name}</div>
                    {o.is_qc && <Badge variant="outline" className="mt-1">QC</Badge>}
                    {o.is_rework && <Badge variant="outline" className="mt-1 ml-1">Retrabalho</Badge>}
                    {o.block_reason && <div className="text-xs text-destructive mt-1">⚠ {o.block_reason}</div>}
                  </td>
                  {!compact && <td>{o.work_center?.name ?? o.workcenter ?? "—"}</td>}
                  {!compact && <td>{o.machine?.name ?? "—"}</td>}
                  {!compact && <td>{o.employee?.full_name ?? "—"}</td>}
                  <td><WorkOrderStateBadge state={o.state} /></td>
                  <td className="text-xs">
                    {Number(o.planned_minutes)} / {o.actual_duration_minutes ? Number(o.actual_duration_minutes).toFixed(1) : "—"}
                  </td>
                  <td className="text-xs">{Number(o.qty_done)} / {Number(o.qty_scrap)}</td>
                  <td>
                    {opIssues.length ? <Badge variant="destructive">{opIssues.length}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {(o.state === "ready" || o.state === "pending") && (
                      <Button size="sm" variant="outline" onClick={() => setStartWO(o)}><Play className="h-3.5 w-3.5" /></Button>
                    )}
                    {o.state === "in_progress" && (
                      <>
                        <Button size="sm" variant="outline" className="ml-1" onClick={() => setPauseWO(o)}><Pause className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="outline" className="ml-1" onClick={() => setFinishWO(o)}><Check className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    {o.state === "paused" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => resume(o)}><RotateCw className="h-3.5 w-3.5" /></Button>
                    )}
                    {o.is_qc && o.state !== "done" && (
                      <Button size="sm" variant="outline" className="ml-1" onClick={() => setQcWO(o)}><ShieldCheck className="h-3.5 w-3.5" /></Button>
                    )}
                    {o.state !== "done" && (
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => setIssueWO(o)}><AlertTriangle className="h-3.5 w-3.5 text-destructive" /></Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <StartDialog wo={startWO} onClose={() => setStartWO(null)} onDone={refresh} />
      <FinishDialog wo={finishWO} onClose={() => setFinishWO(null)} onDone={refresh} />
      <PauseDialog wo={pauseWO} onClose={() => setPauseWO(null)} onDone={refresh} />
      <IssueDialog wo={issueWO} onClose={() => setIssueWO(null)} onDone={refresh} />
      <QualityDialog wo={qcWO} onClose={() => setQcWO(null)} onDone={refresh} />
    </div>
  );
}

function StartDialog({ wo, onClose, onDone }: { wo: WO | null; onClose: () => void; onDone: () => void }) {
  const [employee, setEmployee] = useState<string>("");
  const [machine, setMachine] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const empQ = useQuery({
    queryKey: ["wo-emp", wo?.work_center_id],
    enabled: !!wo,
    queryFn: async () => {
      let q = supabase.from("work_center_employees")
        .select("employee_id, skill_level, employee:hr_employees!inner(id, full_name, active)")
        .eq("active", true);
      if (wo?.work_center_id) q = q.eq("work_center_id", wo.work_center_id);
      const { data } = await q;
      return (data ?? []).filter((r: any) => r.employee?.active);
    },
  });
  const machQ = useQuery({
    queryKey: ["wo-mach", wo?.work_center_id],
    enabled: !!wo,
    queryFn: async () => {
      let q = supabase.from("manufacturing_machines").select("*").eq("active", true);
      if (wo?.work_center_id) q = q.eq("work_center_id", wo.work_center_id);
      return (await q).data ?? [];
    },
  });

  const submit = async () => {
    if (!wo) return;
    setBusy(true);
    const { error } = await supabase.rpc("work_order_start", {
      _work_order_id: wo.id,
      _employee_id: employee || null,
      _machine_id: machine || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Operação iniciada"); onDone(); onClose(); setEmployee(""); setMachine(""); }
  };

  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Iniciar — {wo?.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Funcionário</div>
            <Select value={employee} onValueChange={setEmployee}>
              <SelectTrigger><SelectValue placeholder="Selecionar funcionário" /></SelectTrigger>
              <SelectContent>
                {(empQ.data ?? []).map((r: any) => (
                  <SelectItem key={r.employee.id} value={r.employee.id}>
                    {r.employee.full_name} <span className="text-xs text-muted-foreground ml-1">({r.skill_level})</span>
                  </SelectItem>
                ))}
                {!empQ.data?.length && <div className="px-2 py-1 text-xs text-muted-foreground">Nenhum funcionário habilitado.</div>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1">Máquina</div>
            <Select value={machine} onValueChange={setMachine}>
              <SelectTrigger><SelectValue placeholder="Selecionar máquina (opcional)" /></SelectTrigger>
              <SelectContent>
                {(machQ.data ?? []).map((m: any) => (
                  <SelectItem key={m.id} value={m.id} disabled={m.status !== "available"}>
                    {m.name} <span className="text-xs text-muted-foreground ml-1">({m.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Iniciar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog({ wo, onClose, onDone }: { wo: WO | null; onClose: () => void; onDone: () => void }) {
  const [qtyDone, setQtyDone] = useState("");
  const [qtyScrap, setQtyScrap] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!wo) return;
    setBusy(true);
    const { error } = await supabase.rpc("work_order_finish", {
      _work_order_id: wo.id,
      _qty_done: Number(qtyDone || 0),
      _qty_scrap: Number(qtyScrap || 0),
      _notes: notes || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Operação concluída"); onDone(); onClose(); setQtyDone(""); setQtyScrap("0"); setNotes(""); }
  };

  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Concluir — {wo?.name}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Quantidade produzida</div>
          <Input type="number" value={qtyDone} onChange={(e) => setQtyDone(e.target.value)} />
          <div className="text-sm text-muted-foreground">Refugo</div>
          <Input type="number" value={qtyScrap} onChange={(e) => setQtyScrap(e.target.value)} />
          <Textarea placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PauseDialog({ wo, onClose, onDone }: { wo: WO | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!wo) return;
    setBusy(true);
    const { error } = await supabase.rpc("work_order_pause", { _work_order_id: wo.id, _reason: reason || null });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Pausada"); onDone(); onClose(); setReason(""); }
  };
  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pausar — {wo?.name}</DialogTitle></DialogHeader>
        <Textarea placeholder="Motivo da pausa" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !reason}>Pausar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ wo, onClose, onDone }: { wo: WO | null; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState("material_missing");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!wo) return;
    setBusy(true);
    const { error } = await supabase.rpc("work_order_report_issue", {
      _work_order_id: wo.id, _issue_kind: kind, _description: desc,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Problema reportado"); onDone(); onClose(); setDesc(""); }
  };
  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reportar problema — {wo?.name}</DialogTitle></DialogHeader>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="material_missing">Falta de material</SelectItem>
            <SelectItem value="damaged">Peça danificada</SelectItem>
            <SelectItem value="wrong_measure">Erro de medida</SelectItem>
            <SelectItem value="defect">Defeito de fabricação</SelectItem>
            <SelectItem value="priority_blocked">Prioridade bloqueada</SelectItem>
            <SelectItem value="other">Outro</SelectItem>
          </SelectContent>
        </Select>
        <Textarea placeholder="Descrição" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={busy || !desc}>Reportar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QualityDialog({ wo, onClose, onDone }: { wo: WO | null; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState("pass");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!wo) return;
    setBusy(true);
    const { error } = await supabase.rpc("work_order_quality_check", {
      _work_order_id: wo.id, _result: result, _notes: notes || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Qualidade registrada"); onDone(); onClose(); setNotes(""); }
  };
  return (
    <Dialog open={!!wo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Controle de qualidade — {wo?.name}</DialogTitle></DialogHeader>
        <Select value={result} onValueChange={setResult}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pass">Aprovado</SelectItem>
            <SelectItem value="fail">Reprovado</SelectItem>
            <SelectItem value="rework">Retrabalho</SelectItem>
          </SelectContent>
        </Select>
        <Textarea placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
