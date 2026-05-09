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
import { CheckCircle2, X, Printer, AlertTriangle, RefreshCw, PackageCheck } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { SmartButtons } from "@/core/orders/SmartButtons";
import { printPickingList } from "@/modules/inventory/printPickingList";
import { toast } from "sonner";

import { stateLabel, kindLabel } from "@/lib/picking";

const TONE: Record<string, any> = { draft: "default", waiting: "warning", ready: "info", done: "success", cancelled: "destructive" };

export default function TransferForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [picking, setPicking] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [availByProduct, setAvailByProduct] = useState<Record<string, number>>({});
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, any[]>>({});
  const [backorder, setBackorder] = useState<any>(null);
  const [original, setOriginal] = useState<any>(null);

  const load = async () => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path)")
      .eq("id", id!)
      .maybeSingle();
    setPicking(p);
    if (p?.backorder_id) {
      const { data: orig } = await supabase.from("stock_pickings").select("id,name").eq("id", p.backorder_id).maybeSingle();
      setOriginal(orig);
    } else setOriginal(null);
    const { data: bo } = await supabase.from("stock_pickings").select("id,name,state").eq("backorder_id", id!).maybeSingle();
    setBackorder(bo);
    const { data: m } = await supabase
      .from("stock_moves")
      .select("*, products(name,tracking,uom_id, product_uom!products_uom_id_fkey(category))")
      .eq("picking_id", id!);
    setMoves(m ?? []);
    // load available stock at source location for each move's product
    if (p?.source_location_id && (m ?? []).length) {
      const prodIds = Array.from(new Set((m ?? []).map((x: any) => x.product_id)));
      const { data: qs } = await supabase
        .from("stock_quants")
        .select("product_id, quantity, reserved_quantity")
        .eq("location_id", p.source_location_id)
        .in("product_id", prodIds);
      const map: Record<string, number> = {};
      (qs ?? []).forEach((q: any) => {
        map[q.product_id] = (map[q.product_id] ?? 0) + (Number(q.quantity || 0) - Number(q.reserved_quantity || 0));
      });
      setAvailByProduct(map);
    } else {
      setAvailByProduct({});
    }
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
    // detect chain SO ← PO ← this incoming
    if (picking?.kind === "incoming" && picking?.origin) {
      const { data: po } = await supabase.from("purchase_orders").select("origin").eq("name", picking.origin).maybeSingle();
      if (po?.origin) {
        toast.success(`Recebido e reservado para ${po.origin}`);
      } else {
        toast.success("Transferência validada");
      }
    } else {
      toast.success("Transferência validada");
    }
    load();
  };

  const cancel = async () => {
    if (!confirm("Cancelar transferência e todas as etapas seguintes da cadeia? As reservas serão libertadas.")) return;
    const { error } = await supabase.rpc("cancel_picking", { _picking: id!, _cascade: true });
    if (error) return toast.error(error.message);
    toast.success("Transferência cancelada (cadeia + reservas libertadas)");
    load();
  };

  const tryReserve = async () => {
    const { error } = await supabase.rpc("try_reserve_picking", { _picking: id! });
    if (error) return toast.error(error.message);
    toast.success("Disponibilidade verificada");
    load();
  };

  const replanChain = async () => {
    const { data, error } = await supabase.rpc("replan_picking_chain", { _picking: id! });
    if (error) return toast.error(error.message);
    const r = (data as any) ?? {};
    if ((r.shortage ?? 0) > 0) {
      toast.warning(`Cadeia replaneada: ${r.reserved ?? 0} reservadas, ${r.shortage} em falta`);
    } else {
      toast.success(`Cadeia replaneada (${r.steps ?? 0} etapas, tudo reservado)`);
    }
    load();
  };

  if (!picking) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const isLocked = ["done", "cancelled"].includes(picking.state);

  // Compute availability summary for outgoing pickings
  const isOutgoing = picking.kind === "outgoing";
  const availSummary = (() => {
    if (!isOutgoing || !moves.length) return null;
    let needed = 0, available = 0, fullyAvailable = 0;
    moves.forEach((m) => {
      const need = Number(m.quantity || 0);
      const got = Math.min(need, Number(availByProduct[m.product_id] ?? 0));
      needed += need;
      available += got;
      if (got >= need) fullyAvailable += 1;
    });
    const readyMoves = moves.filter((m) => m.state === "ready").length;
    const pct = needed > 0 ? Math.round((available / needed) * 100) : 0;
    return { needed, available, fullyAvailable, readyMoves, pct, total: moves.length };
  })();
  const isPartial = !!availSummary && availSummary.readyMoves > 0 && availSummary.readyMoves < availSummary.total;
  const isFullyShort = !!availSummary && availSummary.readyMoves === 0 && availSummary.available < availSummary.needed && !isLocked;

  return (
    <>
      <FormHeader
        title={picking.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências", to: "/inventory/transfers" }, { label: picking.name }]}
        backTo="/inventory/transfers"
        state={{
          label: isPartial ? "Parcialmente disponível" : stateLabel(picking.state),
          tone: isPartial ? "warning" : (TONE[picking.state] ?? "default"),
        }}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => printPickingList(id!)}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir picking
            </Button>
            {isOutgoing && !isLocked && (
              <Button size="sm" variant="outline" onClick={tryReserve}>
                <RefreshCw className="h-4 w-4 mr-1" /> Verificar disponibilidade
              </Button>
            )}
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
            {(picking.step_label || picking.batch_id || picking.previous_picking_id) && (
              <Card className="p-3 text-sm flex flex-wrap items-center gap-3 bg-sky-50 border-sky-200 dark:bg-sky-950/20 dark:border-sky-900">
                {picking.step_label && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100 font-medium text-xs">
                    Etapa: {picking.step_label}
                  </span>
                )}
                {picking.previous_picking_id && (
                  <span>← Etapa anterior: <a href={`/inventory/transfers/${picking.previous_picking_id}`} className="text-primary hover:underline">ver</a></span>
                )}
                {picking.batch_id && (
                  <span>Lote: <a href={`/inventory/batches/${picking.batch_id}`} className="text-primary hover:underline">abrir</a></span>
                )}
              </Card>
            )}
            {(original || backorder) && (
              <Card className="p-3 text-sm flex flex-wrap items-center gap-3 bg-amber-50 border-amber-200">
                {original && (
                  <div>↩ Backorder de <a href={`/inventory/transfers/${original.id}`} className="text-primary hover:underline font-medium">{original.name}</a></div>
                )}
                {backorder && (
                  <div>→ Backorder gerada: <a href={`/inventory/transfers/${backorder.id}`} className="text-primary hover:underline font-medium">{backorder.name}</a> ({stateLabel(backorder.state)})</div>
                )}
              </Card>
            )}
            <Card className="p-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div><div className="o-section-title">Tipo</div>{kindLabel(picking.kind)}</div>
              <div><div className="o-section-title">Origem</div>{picking.source?.full_path ?? picking.source?.name}</div>
              <div><div className="o-section-title">Destino</div>{picking.dest?.full_path ?? picking.dest?.name}</div>
              <div><div className="o-section-title">Parceiro</div>{picking.partners?.name ?? "—"}</div>
              <div><div className="o-section-title">Origem doc.</div>{picking.origin ?? "—"}</div>
              <div><div className="o-section-title">Programado</div>{picking.scheduled_at ? new Date(picking.scheduled_at).toLocaleString("pt-PT") : "—"}</div>
            </Card>

            {availSummary && !isLocked && (
              <Card className={`p-3 border ${
                isFullyShort
                  ? "bg-rose-50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900"
                  : isPartial
                    ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900"
                    : "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900"
              }`}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {isFullyShort ? (
                      <><AlertTriangle className="h-4 w-4 text-rose-600" /> Sem stock disponível para entrega</>
                    ) : isPartial ? (
                      <><AlertTriangle className="h-4 w-4 text-amber-600" /> Disponibilidade parcial — apenas parte dos produtos pode ser entregue agora</>
                    ) : (
                      <><PackageCheck className="h-4 w-4 text-emerald-600" /> Stock totalmente disponível e reservado</>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {availSummary.fullyAvailable}/{availSummary.total} linhas · {availSummary.available}/{availSummary.needed} unid.
                  </div>
                </div>
                <Progress value={availSummary.pct} className="h-2" />
              </Card>
            )}

            <Card>
              <div className="px-4 py-3 border-b font-semibold">Movimentos</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Produto</th>
                    <th className="text-left px-3 py-2 w-32">Demanda</th>
                    {isOutgoing && <th className="text-left px-3 py-2 w-36">Disponível</th>}
                    <th className="text-left px-3 py-2 w-32">Feito</th>
                    <th className="text-left px-3 py-2 w-48">Lote/Série</th>
                    <th className="text-left px-3 py-2 w-32">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m, i) => {
                    const tracking = m.products?.tracking ?? "none";
                    const cat = m.products?.product_uom?.category;
                    const isInt = !cat || cat === "unit";
                    const lots = lotsByProduct[m.product_id] ?? [];
                    const need = Number(m.quantity || 0);
                    const avail = Number(availByProduct[m.product_id] ?? 0);
                    const reserved = m.state === "ready" || m.state === "done";
                    const shortage = Math.max(0, need - avail);
                    return (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2">{m.products?.name}</td>
                      <td className="px-3 py-2">{m.quantity}</td>
                      {isOutgoing && (
                        <td className="px-3 py-2">
                          {reserved ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                              <PackageCheck className="h-3 w-3" /> Reservado
                            </span>
                          ) : avail >= need ? (
                            <span className="text-emerald-700 dark:text-emerald-300 text-xs">{avail} disponível</span>
                          ) : avail > 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 text-xs font-medium">
                              <AlertTriangle className="h-3 w-3" /> {avail}/{need} (faltam {shortage})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 text-xs font-medium">
                              <AlertTriangle className="h-3 w-3" /> Sem stock
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <Input
                          className="h-8"
                          type="number"
                          step={isInt ? 1 : 0.01}
                          min={0}
                          max={m.quantity}
                          value={m.quantity_done ?? m.quantity}
                          disabled={isLocked}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setMoveDone(i, isInt ? Math.max(0, Math.floor(v)) : v);
                          }}
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
                      <td className="px-3 py-2">{stateLabel(m.state)}</td>
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
