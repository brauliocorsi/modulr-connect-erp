import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, X } from "lucide-react";
import { SmartButtons } from "@/core/orders/SmartButtons";
import { toast } from "sonner";

const TONE: Record<string, any> = { draft: "default", waiting: "warning", ready: "info", done: "success", cancelled: "destructive" };

export default function TransferForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [picking, setPicking] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, any[]>>({});

  const load = async () => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path)")
      .eq("id", id!)
      .maybeSingle();
    setPicking(p);
    const { data: m } = await supabase
      .from("stock_moves")
      .select("*, products(name,tracking)")
      .eq("picking_id", id!);
    setMoves(m ?? []);
    const trackedIds = (m ?? []).filter((x: any) => x.products?.tracking && x.products.tracking !== "none").map((x: any) => x.product_id);
    if (trackedIds.length) {
      const { data: lots } = await supabase.from("stock_lots").select("id,name,product_id").in("product_id", trackedIds);
      const map: Record<string, any[]> = {};
      (lots ?? []).forEach((l: any) => { (map[l.product_id] ||= []).push(l); });
      setLotsByProduct(map);
    }
  };
  useEffect(() => {
    if (id) load();
  }, [id]);

  const setMoveDone = (idx: number, v: number) => {
    setMoves((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], quantity_done: v };
      return n;
    });
  };

  const setMoveLot = (idx: number, lot_id: string | null) => {
    setMoves((p) => { const n = [...p]; n[idx] = { ...n[idx], lot_id }; return n; });
  };

  const createLot = async (idx: number, name: string) => {
    const m = moves[idx];
    const { data, error } = await supabase.from("stock_lots").insert({ product_id: m.product_id, name }).select("id,name,product_id").single();
    if (error) return toast.error(error.message);
    setLotsByProduct((prev) => ({ ...prev, [m.product_id]: [...(prev[m.product_id] ?? []), data] }));
    setMoveLot(idx, (data as any).id);
  };

  const validate = async () => {
    for (const m of moves) {
      await supabase.from("stock_moves").update({ quantity_done: m.quantity_done ?? m.quantity, lot_id: m.lot_id ?? null }).eq("id", m.id);
    }
    const { error } = await supabase.rpc("validate_picking", { _picking: id! });
    if (error) return toast.error(error.message);
    toast.success("Transferência validada");
    load();
  };

  const cancel = async () => {
    await supabase.from("stock_pickings").update({ state: "cancelled" }).eq("id", id!);
    toast.success("Cancelado");
    load();
  };

  if (!picking) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const isLocked = ["done", "cancelled"].includes(picking.state);

  return (
    <>
      <FormHeader
        title={picking.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências", to: "/inventory/transfers" }, { label: picking.name }]}
        backTo="/inventory/transfers"
        state={{ label: picking.state, tone: TONE[picking.state] ?? "default" }}
        actions={
          <div className="flex gap-2">
            {!isLocked && (
              <Button size="sm" onClick={validate}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Validar
              </Button>
            )}
            {!isLocked && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            {picking.name && <SmartButtons kind="picking" orderName={picking.name} />}
            <Card className="p-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div><div className="o-section-title">Tipo</div>{picking.kind}</div>
              <div><div className="o-section-title">Origem</div>{picking.source?.full_path ?? picking.source?.name}</div>
              <div><div className="o-section-title">Destino</div>{picking.dest?.full_path ?? picking.dest?.name}</div>
              <div><div className="o-section-title">Parceiro</div>{picking.partners?.name ?? "—"}</div>
              <div><div className="o-section-title">Origem doc.</div>{picking.origin ?? "—"}</div>
              <div><div className="o-section-title">Programado</div>{picking.scheduled_at ? new Date(picking.scheduled_at).toLocaleString("pt-PT") : "—"}</div>
            </Card>

            <Card>
              <div className="px-4 py-3 border-b font-semibold">Movimentos</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Produto</th>
                    <th className="text-left px-3 py-2 w-32">Demanda</th>
                    <th className="text-left px-3 py-2 w-32">Feito</th>
                    <th className="text-left px-3 py-2 w-48">Lote/Série</th>
                    <th className="text-left px-3 py-2 w-32">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m, i) => {
                    const tracking = m.products?.tracking ?? "none";
                    const lots = lotsByProduct[m.product_id] ?? [];
                    return (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2">{m.products?.name}</td>
                      <td className="px-3 py-2">{m.quantity}</td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-8"
                          type="number"
                          step="0.01"
                          value={m.quantity_done ?? m.quantity}
                          disabled={isLocked}
                          onChange={(e) => setMoveDone(i, Number(e.target.value))}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {tracking === "none" ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <div className="flex gap-1">
                            <Select
                              value={m.lot_id ?? ""}
                              onValueChange={(v) => setMoveLot(i, v)}
                              disabled={isLocked}
                            >
                              <SelectTrigger className="h-8"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                              <SelectContent>
                                {lots.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {!isLocked && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                onClick={() => {
                                  const name = prompt(`Novo ${tracking === "serial" ? "número de série" : "lote"}:`);
                                  if (name) createLot(i, name);
                                }}
                              >+</Button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{m.state}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </Card>
            <RecordSidebar recordType="stock_picking" recordId={id!} />
          </div>
          <aside />
        </div>
      </PageBody>
    </>
  );
}
