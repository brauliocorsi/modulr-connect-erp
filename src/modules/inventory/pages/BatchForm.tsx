import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Truck, CheckCircle2, Play, X, Printer } from "lucide-react";
import { stateLabel, kindLabel } from "@/lib/picking";
import { printBatchBarcodes } from "@/modules/inventory/printBatchBarcodes";
import { toast } from "sonner";

export default function BatchForm() {
  const { id } = useParams();
  const [batch, setBatch] = useState<any>(null);
  const [pickings, setPickings] = useState<any[]>([]);
  const [aggMoves, setAggMoves] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [driverId, setDriverId] = useState<string>("");
  const [delivDate, setDelivDate] = useState<string>("");

  const load = async () => {
    const { data: b } = await supabase.from("stock_picking_batches").select("*").eq("id", id!).maybeSingle();
    setBatch(b);
    const { data: ps } = await supabase
      .from("stock_pickings")
      .select("id,name,kind,state,step_label,partners(name)")
      .eq("batch_id", id!);
    setPickings(ps ?? []);
    const ids = (ps ?? []).map((p: any) => p.id);
    if (ids.length) {
      const { data: ms } = await supabase
        .from("stock_moves")
        .select("product_id,quantity,quantity_done,products(name)")
        .in("picking_id", ids);
      const agg: Record<string, any> = {};
      (ms ?? []).forEach((m: any) => {
        const k = m.product_id;
        if (!agg[k]) agg[k] = { name: m.products?.name, qty: 0, done: 0 };
        agg[k].qty += Number(m.quantity || 0);
        agg[k].done += Number(m.quantity_done || 0);
      });
      setAggMoves(Object.values(agg));
    } else setAggMoves([]);
  };
  useEffect(() => { if (id) load(); }, [id]);

  const start = async () => {
    await supabase.from("stock_picking_batches").update({ state: "in_progress" }).eq("id", id!);
    toast.success("Lote em separação");
    load();
  };
  const validate = async () => {
    const { data, error } = await supabase.rpc("validate_batch", { _batch: id! });
    if (error) return toast.error(error.message);
    const r = (data as any) ?? {};
    if ((r.failed ?? 0) > 0) {
      toast.error(`${r.validated ?? 0} validadas, ${r.failed} com erro`, {
        description: (r.errors ?? []).map((e: any) => `${e.picking}: ${e.error}`).join(" • ").slice(0, 300),
      });
    } else {
      toast.success(`Lote validado (${r.validated ?? 0} transferências)`);
    }
    load();
  };
  const cancel = async () => {
    if (!confirm("Cancelar o lote e libertar todas as reservas das transferências não concluídas?")) return;
    const { error } = await supabase.rpc("cancel_batch", { _batch: id! });
    if (error) return toast.error(error.message);
    toast.success("Lote cancelado e reservas libertadas");
    load();
  };

  if (!batch) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const done = pickings.filter((p) => p.state === "done").length;
  const pct = pickings.length ? Math.round((done / pickings.length) * 100) : 0;
  const locked = ["done", "cancelled"].includes(batch.state);

  return (
    <>
      <FormHeader
        title={batch.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Lotes", to: "/inventory/batches" }, { label: batch.name }]}
        backTo="/inventory/batches"
        state={{ label: stateLabel(batch.state), tone: batch.state === "done" ? "success" : batch.state === "cancelled" ? "destructive" : "default" }}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => printBatchBarcodes(id!)}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir códigos
            </Button>
            {!locked && batch.state === "draft" && (
              <Button size="sm" variant="outline" onClick={start}><Play className="h-4 w-4 mr-1" /> Iniciar separação</Button>
            )}
            {!locked && (
              <Button size="sm" onClick={validate}><CheckCircle2 className="h-4 w-4 mr-1" /> Validar tudo</Button>
            )}
            {!locked && (
              <Button size="sm" variant="ghost" onClick={cancel}><X className="h-4 w-4 mr-1" /> Cancelar</Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Progresso</div>
              <div className="text-xs text-muted-foreground">{done}/{pickings.length} transferências concluídas</div>
            </div>
            <Progress value={pct} className="h-2" />
          </Card>

          <Card>
            <div className="px-4 py-3 border-b font-semibold">Agregado por produto (a separar)</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2 w-32">Total</th><th className="text-left px-3 py-2 w-32">Feito</th></tr>
              </thead>
              <tbody>
                {aggMoves.map((m, i) => (
                  <tr key={i} className="border-t"><td className="px-3 py-2">{m.name}</td><td className="px-3 py-2 font-medium">{m.qty}</td><td className="px-3 py-2">{m.done}</td></tr>
                ))}
                {aggMoves.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="px-4 py-3 border-b font-semibold">Transferências do lote</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr><th className="text-left px-3 py-2">Referência</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Etapa</th><th className="text-left px-3 py-2">Parceiro</th><th className="text-left px-3 py-2">Estado</th></tr>
              </thead>
              <tbody>
                {pickings.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-accent/30">
                    <td className="px-3 py-2"><Link to={`/inventory/transfers/${p.id}`} className="text-primary hover:underline">{p.name}</Link></td>
                    <td className="px-3 py-2">{kindLabel(p.kind)}</td>
                    <td className="px-3 py-2">{p.step_label ?? "—"}</td>
                    <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                    <td className="px-3 py-2"><span className="o-state-badge">{stateLabel(p.state)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
