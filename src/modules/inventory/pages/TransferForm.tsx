import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, CheckCircle2, X, Printer, AlertTriangle, RefreshCw, PackageCheck, ShoppingBag, ShoppingCart, Truck, CalendarClock, Package } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { SmartButtons } from "@/core/orders/SmartButtons";
import { StateBadge } from "@/core/layout/StateBadge";
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
  const [incomingByProduct, setIncomingByProduct] = useState<Record<string, { qty: number; pickings: { id: string; name: string; state: string }[] }>>({});
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, any[]>>({});
  const [backorder, setBackorder] = useState<any>(null);
  const [original, setOriginal] = useState<any>(null);
  const [flowDocs, setFlowDocs] = useState<{ sale: any | null; purchases: any[]; pickings: any[] }>({ sale: null, purchases: [], pickings: [] });
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [carriers, setCarriers] = useState<any[]>([]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");

  useEffect(() => {
    (async () => {
      const [v, c] = await Promise.all([
        supabase.from("vehicles").select("id,name,license_plate").eq("active", true).order("name"),
        supabase.from("delivery_carriers").select("id,name").eq("active", true).order("name"),
      ]);
      setVehicles(v.data ?? []);
      setCarriers(c.data ?? []);
    })();
  }, []);


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
    setMoves((m ?? []).map((mv: any) => {
      const doneQty = Number(mv.quantity_done);
      return Number.isFinite(doneQty) && doneQty > 0 ? mv : { ...mv, quantity_done: Number(mv.quantity || 0) };
    }));
    let sale: any = null;
    let purchases: any[] = [];
    if (p?.origin) {
      const { data: directSale } = await supabase.from("sale_orders").select("id,name,state,fulfillment_status").eq("name", p.origin).maybeSingle();
      sale = directSale;
      if (!sale) {
        const { data: po } = await supabase.from("purchase_orders").select("id,name,state,origin,created_at").eq("name", p.origin).maybeSingle();
        if (po) purchases = [po];
        if (po?.origin) {
          const { data: poSale } = await supabase.from("sale_orders").select("id,name,state,fulfillment_status").eq("name", po.origin).maybeSingle();
          sale = poSale;
        }
      }
      if (sale?.id) {
        const { data: links } = await supabase.from("purchase_order_origins").select("po_id").eq("sale_order_id", sale.id);
        const poIds = (links ?? []).map((x: any) => x.po_id);
        const [byOrigin, byLink] = await Promise.all([
          supabase.from("purchase_orders").select("id,name,state,origin,created_at").eq("origin", sale.name),
          poIds.length ? supabase.from("purchase_orders").select("id,name,state,origin,created_at").in("id", poIds) : Promise.resolve({ data: [] as any[] }),
        ]);
        const byId = new Map<string, any>();
        [...(purchases ?? []), ...(byOrigin.data ?? []), ...(byLink.data ?? [])].forEach((po: any) => byId.set(po.id, po));
        purchases = Array.from(byId.values()).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      }
      const purchaseNames = purchases.map((po: any) => po.name);
      const [salePickings, receiptPickings] = await Promise.all([
        sale?.name
          ? supabase.from("stock_pickings").select("id,name,kind,state,step_label,origin,created_at,source:source_location_id(name),dest:destination_location_id(name)").eq("origin", sale.name)
          : Promise.resolve({ data: [] as any[] }),
        purchaseNames.length
          ? supabase.from("stock_pickings").select("id,name,kind,state,step_label,origin,created_at,source:source_location_id(name),dest:destination_location_id(name)").in("origin", purchaseNames)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const byPick = new Map<string, any>();
      [...(receiptPickings.data ?? []), ...(salePickings.data ?? [])].forEach((pk: any) => byPick.set(pk.id, pk));
      // Logical flow order: Fornecedor → Stock (incoming) → transferências internas → Stock → Cliente (outgoing)
      const kindRank: Record<string, number> = { incoming: 0, internal: 1, manufacturing: 2, outgoing: 3 };
      setFlowDocs({
        sale,
        purchases,
        pickings: Array.from(byPick.values()).sort((a, b) => {
          const ra = kindRank[a.kind] ?? 9;
          const rb = kindRank[b.kind] ?? 9;
          if (ra !== rb) return ra - rb;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }),
      });
    } else {
      setFlowDocs({ sale: null, purchases: [], pickings: [] });
    }
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
    // load incoming pipeline for outgoing pickings (PO recebimentos a chegar ao source location)
    if (p?.kind === "outgoing" && p?.source_location_id && (m ?? []).length) {
      const prodIds = Array.from(new Set((m ?? []).map((x: any) => x.product_id)));
      const { data: inMoves } = await supabase
        .from("stock_moves")
        .select("product_id, quantity, quantity_done, state, picking_id, stock_pickings!inner(id,name,state,kind,destination_location_id)")
        .in("product_id", prodIds)
        .in("state", ["draft", "waiting", "ready"])
        .eq("stock_pickings.kind", "incoming")
        .eq("stock_pickings.destination_location_id", p.source_location_id);
      const map: Record<string, { qty: number; pickings: { id: string; name: string; state: string }[] }> = {};
      (inMoves ?? []).forEach((mv: any) => {
        const remaining = Math.max(0, Number(mv.quantity || 0) - Number(mv.quantity_done || 0));
        if (remaining <= 0) return;
        const e = (map[mv.product_id] ||= { qty: 0, pickings: [] });
        e.qty += remaining;
        if (!e.pickings.find((x) => x.id === mv.stock_pickings.id)) {
          e.pickings.push({ id: mv.stock_pickings.id, name: mv.stock_pickings.name, state: mv.stock_pickings.state });
        }
      });
      setIncomingByProduct(map);
    } else {
      setIncomingByProduct({});
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
    if (!id) return;
    load();
    let timer: any;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    const channel = supabase
      .channel(`picking-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_pickings" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_moves" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_orders" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, debounced)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
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
    const zeroMoves = moves.filter((m) => {
      const qd = Number(m.quantity_done);
      return !(Number.isFinite(qd) && qd > 0);
    });
    if (zeroMoves.length === moves.length) {
      if (!confirm(`Atenção: todas as ${moves.length} linha(s) estão com quantidade movida = 0.\n\nSe continuar, será assumida a quantidade pedida em cada linha.\n\nDeseja prosseguir?`)) return;
    } else if (zeroMoves.length > 0) {
      if (!confirm(`Atenção: ${zeroMoves.length} de ${moves.length} linha(s) estão com 0.\n\nEssas linhas serão validadas com a quantidade pedida (não geram backorder).\n\nDeseja prosseguir?`)) return;
    }
    for (const m of moves) {
      const qd = Number(m.quantity_done);
      const finalQty = Number.isFinite(qd) && qd > 0 ? qd : Number(m.quantity);
      await supabase.from("stock_moves").update({ quantity_done: finalQty, lot_id: m.lot_id ?? null }).eq("id", m.id);
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

  const updateAssignment = async (patch: { vehicle_id?: string | null; carrier_id?: string | null; tracking_ref?: string | null }) => {
    const { error } = await supabase.from("stock_pickings").update(patch as any).eq("id", id!);
    if (error) return toast.error(error.message);
    setPicking((p: any) => ({ ...p, ...patch }));
  };

  const submitReschedule = async () => {
    if (!rescheduleDate) return toast.error("Indique a nova data");
    const { error } = await supabase.rpc("reschedule_picking", {
      _picking: id!,
      _new_date: new Date(rescheduleDate).toISOString(),
      _reason: rescheduleReason || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Transferência reagendada — produto devolvido ao Stock");
    setRescheduleOpen(false);
    setRescheduleReason("");
    load();
  };
  const isLocked = ["done", "cancelled"].includes(picking.state);
  const flowBlocked = flowDocs.pickings.some((pk) => pk.state === "waiting");
  const flowReady = flowDocs.pickings.some((pk) => pk.state === "ready");

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
            {!isLocked && (picking.previous_picking_id || picking.step_label) && (
              <Button size="sm" variant="outline" onClick={replanChain}>
                <RefreshCw className="h-4 w-4 mr-1" /> Replanejar cadeia
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
            {(flowDocs.sale || flowDocs.purchases.length > 0 || flowDocs.pickings.length > 1) && (
              <Card className="p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="o-section-title">Fluxo da venda ao inventário</div>
                    <div className="font-semibold">
                      {flowDocs.sale ? (
                        <a href={`/sales/orders/${flowDocs.sale.id}`} className="text-primary hover:underline">{flowDocs.sale.name}</a>
                      ) : picking.origin ? picking.origin : "Documento sem venda ligada"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {flowBlocked && <span className="inline-flex items-center gap-1 text-xs font-medium text-warning"><AlertTriangle className="h-3 w-3" /> Há etapa bloqueada</span>}
                    {flowReady && <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><PackageCheck className="h-3 w-3" /> Há etapa pronta</span>}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3 bg-muted/20">
                    <div className="flex items-center gap-2 text-sm font-medium"><ShoppingCart className="h-4 w-4 text-primary" /> Venda</div>
                    <div className="mt-2 text-sm">
                      {flowDocs.sale ? (
                        <>
                          <a href={`/sales/orders/${flowDocs.sale.id}`} className="font-medium text-primary hover:underline">{flowDocs.sale.name}</a>
                          <div className="text-xs text-muted-foreground">Estado: {stateLabel(flowDocs.sale.state)} · Preparação: {stateLabel(flowDocs.sale.fulfillment_status)}</div>
                        </>
                      ) : <span className="text-muted-foreground">Sem venda ligada</span>}
                    </div>
                  </div>
                  <div className="rounded-md border p-3 bg-muted/20">
                    <div className="flex items-center gap-2 text-sm font-medium"><ShoppingBag className="h-4 w-4 text-primary" /> Compra / Recebimento</div>
                    <div className="mt-2 space-y-1 text-sm">
                      {flowDocs.purchases.length ? flowDocs.purchases.map((po) => (
                        <div key={po.id} className="flex items-center justify-between gap-2">
                          <a href={`/purchase/orders/${po.id}`} className="font-medium text-primary hover:underline">{po.name}</a>
                          <span className="text-xs text-muted-foreground">{stateLabel(po.state)}</span>
                        </div>
                      )) : <span className="text-muted-foreground">Sem compra pendente</span>}
                    </div>
                  </div>
                  <div className="rounded-md border p-3 bg-muted/20">
                    <div className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4 text-primary" /> Armazém / Entrega</div>
                    <div className="mt-2 text-sm">
                      <div className="font-medium">{flowDocs.pickings.length} etapa(s)</div>
                      <div className="text-xs text-muted-foreground">Atual: {picking.step_label ?? kindLabel(picking.kind)}</div>
                    </div>
                  </div>
                </div>
                {flowDocs.pickings.length > 0 && (
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max items-stretch gap-2">
                      {flowDocs.pickings.map((pk, index) => (
                        <div key={pk.id} className="flex items-center gap-2">
                          <a
                            href={`/inventory/transfers/${pk.id}`}
                            className={`block w-56 rounded-md border p-3 transition-colors ${pk.id === picking.id ? "border-primary bg-accent" : pk.state === "ready" ? "border-success bg-success/10" : pk.state === "waiting" ? "border-warning bg-warning/10" : "bg-card hover:bg-muted/40"}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-muted-foreground">Passo {index + 1}</span>
                              <StateBadge value={pk.state} />
                            </div>
                            <div className="mt-1 font-medium text-sm">{pk.step_label ?? kindLabel(pk.kind)}</div>
                            <div className="text-xs text-muted-foreground mt-1">{pk.source?.name ?? "?"} → {pk.dest?.name ?? "?"}</div>
                            <div className="text-xs text-muted-foreground mt-1">{pk.name}</div>
                          </a>
                          {index < flowDocs.pickings.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
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
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"><PackageCheck className="h-3 w-3" /> Reservado</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"><PackageCheck className="h-3 w-3" /> Disponível</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"><AlertTriangle className="h-3 w-3" /> Parcial</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200"><Truck className="h-3 w-3" /> Em receção</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"><AlertTriangle className="h-3 w-3" /> Pendente</span>
                </div>
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" title="Stock reservado para esta linha">
                              <PackageCheck className="h-3 w-3" /> Reservado · {need}
                            </span>
                          ) : avail >= need ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" title="Há stock livre suficiente — clique em Verificar disponibilidade para reservar">
                              <PackageCheck className="h-3 w-3" /> Disponível · {avail}
                            </span>
                          ) : avail > 0 ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                <AlertTriangle className="h-3 w-3" /> Parcial · {avail}/{need}
                              </span>
                              {(incomingByProduct[m.product_id]?.qty ?? 0) > 0 && (
                                <span className="text-[11px] text-info">Em receção: {incomingByProduct[m.product_id].qty}</span>
                              )}
                            </div>
                          ) : (incomingByProduct[m.product_id]?.qty ?? 0) > 0 ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" title="Aguarda recebimento de compra">
                                <Truck className="h-3 w-3" /> Em receção · {incomingByProduct[m.product_id].qty}
                              </span>
                              {incomingByProduct[m.product_id].pickings.slice(0, 2).map((pk) => (
                                <a key={pk.id} href={`/inventory/transfers/${pk.id}`} className="text-[11px] text-primary hover:underline">{pk.name} ({stateLabel(pk.state)})</a>
                              ))}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" title="Sem stock e sem compra em curso">
                              <AlertTriangle className="h-3 w-3" /> Pendente · 0/{need}
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
                          value={Number(m.quantity_done) > 0 ? m.quantity_done : m.quantity}
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
