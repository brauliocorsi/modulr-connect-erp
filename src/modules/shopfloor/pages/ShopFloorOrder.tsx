import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MOStateBadge, MOPriorityBadge, ComponentStockChip } from "@/modules/manufacturing/components/MOBadges";
import { PhotoUploader, type Attachment } from "@/modules/manufacturing/components/PhotoUploader";
import { Play, Check, Pause, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";

export default function ShopFloorOrder() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueKind, setIssueKind] = useState("material_missing");
  const [issueDesc, setIssueDesc] = useState("");
  const [issuePhotos, setIssuePhotos] = useState<Attachment[]>([]);
  const [finishOp, setFinishOp] = useState<any>(null);
  const [qtyDone, setQtyDone] = useState("");
  const [qtyScrap, setQtyScrap] = useState("0");
  const [notes, setNotes] = useState("");
  const [finishPhotos, setFinishPhotos] = useState<Attachment[]>([]);

  const moQ = useQuery({
    queryKey: ["sf-mo", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("manufacturing_orders").select("*, product:products(name), partner:partners(name)").eq("id", id!).maybeSingle()).data,
  });
  const opsQ = useQuery({
    queryKey: ["sf-ops", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_operations").select("*").eq("mo_id", id!).order("sequence")).data ?? [],
  });
  const compsQ = useQuery({
    queryKey: ["sf-comps", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_components").select("*, product:products(name)").eq("mo_id", id!).order("sequence")).data ?? [],
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["sf-mo", id] }); qc.invalidateQueries({ queryKey: ["sf-ops", id] }); };

  const start = async (opId: string) => {
    const { error } = await supabase.rpc("mfg_start_operation", { _op: opId });
    if (error) toast.error(error.message); else { toast.success("Etapa iniciada"); refresh(); }
  };
  const doFinish = async () => {
    if (!finishOp) return;
    const { error } = await supabase.rpc("mfg_finish_operation", {
      _op: finishOp.id,
      _qty_done: qtyDone ? Number(qtyDone) : null,
      _qty_scrap: qtyScrap ? Number(qtyScrap) : null,
      _notes: notes || null,
      _attachments: finishPhotos as any,
    });
    if (error) toast.error(error.message);
    else { toast.success("Etapa concluída"); setFinishOp(null); setQtyDone(""); setNotes(""); setFinishPhotos([]); refresh(); }
  };
  const pause = async (opId: string) => {
    const reason = prompt("Motivo da pausa?") ?? "";
    const { error } = await supabase.rpc("mfg_pause_operation", { _op: opId, _reason: reason });
    if (error) toast.error(error.message); else { toast.success("Pausado"); refresh(); }
  };
  const reportIssue = async () => {
    const { error } = await supabase.rpc("mfg_report_issue", {
      _mo: id, _op: null, _kind: issueKind as any, _description: issueDesc || null,
      _attachments: issuePhotos as any,
    });
    if (error) toast.error(error.message);
    else { toast.success("Problema reportado"); setIssueOpen(false); setIssueDesc(""); setIssuePhotos([]); refresh(); }
  };

  const mo = moQ.data;
  if (!mo) return <PageBody><div className="text-sm text-muted-foreground">Carregando…</div></PageBody>;

  const currentOp = (opsQ.data ?? []).find((o: any) => o.state === "in_progress")
    ?? (opsQ.data ?? []).find((o: any) => o.state !== "done" && !o.is_qc);

  return (
    <>
      <PageHeader
        title={`${mo.code} — ${mo.product?.name}`}
        breadcrumb={[{ label: "Chão de Fábrica", to: "/shop-floor" }, { label: mo.code }]}
        actions={<div className="flex gap-2 items-center"><MOPriorityBadge priority={mo.priority} /><MOStateBadge state={mo.state} /></div>}
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 space-y-2 text-sm lg:col-span-1">
            <div><span className="text-muted-foreground">Cliente:</span> {mo.partner?.name ?? "—"}</div>
            <div><span className="text-muted-foreground">Quantidade:</span> <span className="text-2xl font-bold">{Number(mo.qty)}</span></div>
            <div><span className="text-muted-foreground">Prazo:</span> {fmtDate(mo.due_date)}</div>
            {mo.blocked_reason && <div className="text-destructive">⚠ {mo.blocked_reason}</div>}
            {mo.notes && <div className="whitespace-pre-wrap">{mo.notes}</div>}

            <div className="pt-3 grid grid-cols-2 gap-2">
              {currentOp && currentOp.state !== "in_progress" && (
                <Button size="lg" className="h-14 col-span-2" onClick={() => start(currentOp.id)}>
                  <Play className="h-5 w-5 mr-2" /> Iniciar etapa
                </Button>
              )}
              {currentOp && currentOp.state === "in_progress" && (
                <>
                  <Button size="lg" className="h-14" onClick={() => { setFinishOp(currentOp); setQtyDone(String(mo.qty)); }}>
                    <Check className="h-5 w-5 mr-2" /> Concluir
                  </Button>
                  <Button size="lg" variant="outline" className="h-14" onClick={() => pause(currentOp.id)}>
                    <Pause className="h-5 w-5 mr-2" /> Pausar
                  </Button>
                </>
              )}
              <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="lg" className="h-14 col-span-2">
                    <AlertTriangle className="h-5 w-5 mr-2" /> Reportar problema
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Reportar problema</DialogTitle></DialogHeader>
                  <Select value={issueKind} onValueChange={setIssueKind}>
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
                  <Textarea placeholder="Descrição" value={issueDesc} onChange={(e) => setIssueDesc(e.target.value)} />
                  <PhotoUploader value={issuePhotos} onChange={setIssuePhotos} prefix={`issues/${id}`} />
                  <DialogFooter><Button onClick={reportIssue}>Reportar</Button></DialogFooter>
                </DialogContent>
              </Dialog>
              <Link to={`/manufacturing/orders/${mo.id}`} className="text-xs text-muted-foreground underline col-span-2 text-center pt-2">
                Ver ordem completa
              </Link>
            </div>
          </Card>

          <Card className="p-4 lg:col-span-2">
            <div className="font-semibold mb-2">Etapas</div>
            <div className="space-y-2">
              {opsQ.data?.map((o: any) => (
                <div key={o.id} className={`border rounded p-3 flex items-center justify-between ${o.state === "in_progress" ? "border-primary bg-primary/5" : ""}`}>
                  <div>
                    <div className="font-medium">{o.sequence}. {o.name}{o.is_qc && " (QC)"}</div>
                    <div className="text-xs text-muted-foreground">{o.workcenter ?? "—"} • {Number(o.planned_minutes)}min</div>
                  </div>
                  <div className="text-sm">{o.state}</div>
                </div>
              ))}
            </div>
            <div className="font-semibold mt-4 mb-2">Componentes</div>
            <table className="w-full text-sm">
              <tbody>
                {compsQ.data?.map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2">{c.product?.name}</td>
                    <td>{Number(c.qty_required)} req. / {Number(c.qty_available)} disp.</td>
                    <td><ComponentStockChip status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Dialog open={!!finishOp} onOpenChange={(o) => !o && setFinishOp(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Concluir etapa</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div className="text-sm"><span className="text-muted-foreground">Quantidade produzida</span></div>
              <Input type="number" value={qtyDone} onChange={(e) => setQtyDone(e.target.value)} />
              <div className="text-sm"><span className="text-muted-foreground">Defeitos</span></div>
              <Input type="number" value={qtyScrap} onChange={(e) => setQtyScrap(e.target.value)} />
              <Textarea placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <PhotoUploader value={finishPhotos} onChange={setFinishPhotos} prefix={`steps/${id}`} />
            </div>
            <DialogFooter><Button onClick={doFinish}>Confirmar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
