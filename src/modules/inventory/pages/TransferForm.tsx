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
import { ArrowRight, CheckCircle2, X, Printer, AlertTriangle, RefreshCw, PackageCheck, ShoppingBag, ShoppingCart, Truck, CalendarClock, Send, Route as RouteIcon, Car } from "lucide-react";
import { TransferReservationDialog } from "@/modules/inventory/components/TransferReservationDialog";
import { DeliveryStatusBadge } from "@/modules/inventory/components/DeliveryStatusBadge";
import { Progress } from "@/components/ui/progress";
import { SmartButtons } from "@/core/orders/SmartButtons";
import { StateBadge } from "@/core/layout/StateBadge";
import { printPickingList } from "@/modules/inventory/printPickingList";
import { printReceiptLabels } from "@/modules/barcode/printBarcodes";
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
  const [sourceSoByProduct, setSourceSoByProduct] = useState<Record<string, { id: string; name: string }[]>>({});
  const [packagesByProduct, setPackagesByProduct] = useState<Record<string, any[]>>({});
  const [backorder, setBackorder] = useState<any>(null);
  const [original, setOriginal] = useState<any>(null);
  const [flowDocs, setFlowDocs] = useState<{ sale: any | null; purchases: any[]; pickings: any[] }>({ sale: null, purchases: [], pickings: [] });
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [carriers, setCarriers] = useState<any[]>([]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);

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
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path), vehicles(id,name,license_plate), delivery_carriers(id,name), delivery_routes(id,route_date,state,delivery_zones(name,color))")
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
      .select("*, products(name,tracking,uom_id, product_uom!products_uom_id_fkey(category)), product_variants(sku, product_variant_values(product_attribute_values(name)))")
      .eq("picking_id", id!);
    // Load colis (packages) per product for WMS hint
    const productIds = Array.from(new Set((m ?? []).map((mv: any) => mv.product_id)));
    if (productIds.length) {
      const { data: pkgs } = await supabase
        .from("product_packages").select("id,product_id,sequence,label,barcode")
        .in("product_id", productIds).order("sequence");
      const byProd: Record<string, any[]> = {};
      (pkgs ?? []).forEach((p: any) => { (byProd[p.product_id] ||= []).push(p); });
      setPackagesByProduct(byProd);
    } else setPackagesByProduct({});
    const isEditable = (st: string) => st !== "done" && st !== "cancel";
    const hydrated = (m ?? []).map((mv: any) => {
      // For non-finalized moves, always default "Feito" to the demanded quantity.
      if (isEditable(mv.state)) return { ...mv, quantity_done: Number(mv.quantity || 0) };
      return mv;
    });
    setMoves(hydrated);
    // Persist auto-filled "done" quantity so it's real, not just visual.
    const toPersist = (m ?? []).filter((mv: any) =>
      isEditable(mv.state) && Number(mv.quantity_done || 0) !== Number(mv.quantity || 0)
    );
    if (toPersist.length > 0) {
      await Promise.all(toPersist.map((mv: any) =>
        supabase.rpc("scan_set_move_done", { _move: mv.id, _qty: Number(mv.quantity || 0), _lot: null })
      ));
    }
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
          ? supabase.from("stock_pickings").select("id,name,kind,state,step_label,origin,created_at,previous_picking_id,source:source_location_id(name),dest:destination_location_id(name)").eq("origin", sale.name)
          : Promise.resolve({ data: [] as any[] }),
        purchaseNames.length
          ? supabase.from("stock_pickings").select("id,name,kind,state,step_label,origin,created_at,previous_picking_id,source:source_location_id(name),dest:destination_location_id(name)").in("origin", purchaseNames)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const byPick = new Map<string, any>();
      [...(receiptPickings.data ?? []), ...(salePickings.data ?? [])].forEach((pk: any) => byPick.set(pk.id, pk));
      // Logical flow order: Fornecedor → Stock (incoming) → transferências internas → Stock → Cliente (outgoing)
      const kindRank: Record<string, number> = { incoming: 0, internal: 1, manufacturing: 2, outgoing: 3 };
      // Within each kind, order outgoing pickings by chain (previous_picking_id) so that
      // step 1 (no previous) comes first, then its child, etc.
      const orderByChain = (group: any[]) => {
        const ids = new Set(group.map((g) => g.id));
        const roots = group.filter((g) => !g.previous_picking_id || !ids.has(g.previous_picking_id));
        const childOf: Record<string, any[]> = {};
        group.forEach((g) => {
          if (g.previous_picking_id && ids.has(g.previous_picking_id)) {
            (childOf[g.previous_picking_id] ??= []).push(g);
          }
        });
        const out: any[] = [];
        const walk = (n: any) => {
          out.push(n);
          (childOf[n.id] || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach(walk);
        };
        roots.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach(walk);
        // Append any leftovers (cycles, etc.)
        group.forEach((g) => { if (!out.includes(g)) out.push(g); });
        return out;
      };
      const all = Array.from(byPick.values());
      const grouped: Record<string, any[]> = {};
      all.forEach((p) => { (grouped[p.kind] ??= []).push(p); });
      const ordered: any[] = [];
      Object.keys(grouped)
        .sort((a, b) => (kindRank[a] ?? 9) - (kindRank[b] ?? 9))
        .forEach((k) => ordered.push(...orderByChain(grouped[k])));
      setFlowDocs({
        sale,
        purchases,
        pickings: ordered,
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
    // Resolve source sale order per product line for incoming pickings (via PO lines)
    if (p?.kind === "incoming" && p?.origin && (m ?? []).length) {
      const { data: po } = await supabase.from("purchase_orders").select("id").eq("name", p.origin).maybeSingle();
      if (po?.id) {
        const { data: pol } = await supabase
          .from("purchase_order_lines")
          .select("product_id, source_sale_order_id, sale_orders:source_sale_order_id(id,name)")
          .eq("order_id", po.id);
        const map: Record<string, { id: string; name: string }[]> = {};
        (pol ?? []).forEach((l: any) => {
          if (!l.sale_orders) return;
          const arr = (map[l.product_id] ||= []);
          if (!arr.find((s) => s.id === l.sale_orders.id)) arr.push(l.sale_orders);
        });
        setSourceSoByProduct(map);
      } else {
        setSourceSoByProduct({});
      }
    } else {
      setSourceSoByProduct({});
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
    // Internal chain step (Stock→Cais, Cais→Em Entrega): skip quantity prompt and validate full quantity automatically.
    const chainNames = new Set(["Cais de Carga", "Em Entrega"]);
    const srcName = picking?.source?.name ?? "";
    const dstName = picking?.dest?.name ?? "";
    const isInternalChainStep =
      picking?.kind === "outgoing" && (chainNames.has(srcName) || chainNames.has(dstName));
    const isFinalToCustomer =
      picking?.kind === "outgoing" && chainNames.has(srcName) && !chainNames.has(dstName);

    // Block delivery to customer when there is an outstanding balance on the sale order.
    if (isFinalToCustomer && picking?.origin) {
      const { data: so } = await supabase.from("sale_orders").select("id, amount_total").eq("name", picking.origin).maybeSingle();
      if (so?.id) {
        const { data: pays } = await supabase.from("customer_payments").select("amount").eq("order_id", so.id).eq("state", "posted");
        const paid = (pays ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
        const balance = Number(so.amount_total ?? 0) - paid;
        if (balance > 0.01) {
          toast.error("Não é possível concluir a entrega: saldo em aberto", {
            description: `Existem ${balance.toFixed(2)} € por liquidar nesta venda. Registe o pagamento antes de entregar ao cliente.`,
          });
          return;
        }
      }
    }

    if (isInternalChainStep) {
      // Auto-fill full quantities, no confirmation needed.
      for (const m of moves) {
        await supabase.rpc("scan_set_move_done", { _move: m.id, _qty: Number(m.quantity), _lot: m.lot_id ?? null });
      }
    } else {
      const partialMoves = moves.filter((m) => Number(m.quantity_done) < Number(m.quantity));
      const zeroMoves = moves.filter((m) => Number(m.quantity_done) === 0);
      if (zeroMoves.length === moves.length) {
        if (!confirm(`Atenção: nenhuma quantidade foi recebida.\n\nA transferência ficará vazia e será criada uma nova transferência (backorder) com todos os itens em falta.\n\nDeseja prosseguir?`)) return;
      } else if (partialMoves.length > 0) {
        if (!confirm(`Será criada uma transferência de backorder com as quantidades em falta de ${partialMoves.length} linha(s).\n\nDeseja prosseguir?`)) return;
      }
      for (const m of moves) {
        const qd = Number(m.quantity_done);
        const finalQty = Number.isFinite(qd) ? Math.max(0, qd) : Number(m.quantity);
        await supabase.rpc("scan_set_move_done", { _move: m.id, _qty: finalQty, _lot: m.lot_id ?? null });
      }
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

  if (!picking) return <div className="p-6 text-muted-foreground">Carregando…</div>;
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

  // Receipt summary (after validation)
  const receiptSummary = (() => {
    if (!moves.length) return null;
    const doneCount = moves.filter((m) => m.state === "done").length;
    const cancelledCount = moves.filter((m) => m.state === "cancelled").length;
    const totalQty = moves.reduce((s, m) => s + Number(m.quantity || 0), 0);
    const doneQty = moves.reduce((s, m) => s + (m.state === "done" ? Number(m.quantity_done || 0) : 0), 0);
    return { doneCount, cancelledCount, total: moves.length, totalQty, doneQty };
  })();
  const isDone = picking.state === "done";
  const isPartialReceipt = isDone && (!!backorder || (receiptSummary && receiptSummary.doneQty < receiptSummary.totalQty));
  const headerLabel = isPartialReceipt
    ? "Recebido parcialmente"
    : isDone
      ? "Recebido completo"
      : isPartial
        ? "Parcialmente disponível"
        : stateLabel(picking.state);
  const headerTone: any = isPartialReceipt
    ? "warning"
    : isDone
      ? "success"
      : isPartial
        ? "warning"
        : (TONE[picking.state] ?? "default");

  return (
    <>
      <FormHeader
        title={picking.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências", to: "/inventory/transfers" }, { label: picking.name }]}
        backTo="/inventory/transfers"
        state={{ label: headerLabel, tone: headerTone }}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => printPickingList(id!)}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir picking
            </Button>
            <Button size="sm" variant="outline" onClick={() => printReceiptLabels(id!)} title="Etiquetas dos colis/produtos desta transferência">
              <Printer className="h-4 w-4 mr-1" /> Etiquetas
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
            {isOutgoing && !isLocked && picking.source_location_id && picking.source?.name !== "Stock" && (
              <Button size="sm" variant="outline" onClick={() => { setRescheduleDate(""); setRescheduleReason(""); setRescheduleOpen(true); }}>
                <CalendarClock className="h-4 w-4 mr-1" /> Reagendar
              </Button>
            )}
            {isOutgoing && !isLocked && moves.some((m) => Number(m.reserved_quantity || 0) > 0) && (
              <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}>
                <Send className="h-4 w-4 mr-1" /> Transferir reserva
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
          <div className="space-y-3">
            {picking.name && <SmartButtons kind="picking" orderName={picking.name} />}

            {/* Odoo-style slim flow stepper */}
            {(flowDocs.sale || flowDocs.purchases.length > 0 || flowDocs.pickings.length > 1) && (
              <Card className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wider font-medium">Fluxo</span>
                    {flowDocs.sale ? (
                      <>
                        <span>·</span>
                        <a href={`/sales/orders/${flowDocs.sale.id}`} className="text-primary hover:underline font-medium">{flowDocs.sale.name}</a>
                      </>
                    ) : picking.origin ? (
                      <><span>·</span><span className="font-medium text-foreground">{picking.origin}</span></>
                    ) : null}
                    {flowDocs.purchases.length > 0 && (
                      <>
                        <span>·</span>
                        {flowDocs.purchases.map((po, idx) => (
                          <span key={po.id}>
                            {idx > 0 && ", "}
                            <a href={`/purchase/orders/${po.id}`} className="text-primary hover:underline">{po.name}</a>
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {flowBlocked && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" /> Bloqueado</span>}
                    {flowReady && <span className="inline-flex items-center gap-1 text-success"><PackageCheck className="h-3 w-3" /> Pronto</span>}
                  </div>
                </div>
                {flowDocs.pickings.length > 0 && (
                  <div className="overflow-x-auto -mx-1 pb-1">
                    <div className="flex items-stretch gap-0 px-1 min-w-max">
                      {flowDocs.pickings.map((pk, index) => {
                        const isCurrent = pk.id === picking.id;
                        const dotTone =
                          pk.state === "done" ? "bg-success border-success" :
                          pk.state === "cancelled" ? "bg-muted border-muted-foreground/40" :
                          pk.state === "ready" ? "bg-success/20 border-success" :
                          pk.state === "waiting" ? "bg-warning/20 border-warning" :
                          "bg-background border-muted-foreground/40";
                        return (
                          <div key={pk.id} className="flex items-center">
                            <a
                              href={`/inventory/transfers/${pk.id}`}
                              className={`group flex flex-col items-center gap-1 px-3 py-1 rounded transition-colors ${isCurrent ? "bg-accent" : "hover:bg-muted/50"}`}
                              title={`${pk.name} · ${stateLabel(pk.state)}`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center justify-center h-4 w-4 rounded-full border-2 ${dotTone} ${isCurrent ? "ring-2 ring-primary/40" : ""}`}>
                                  {pk.state === "done" && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                                </span>
                                <span className={`text-xs ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                                  {pk.step_label ?? kindLabel(pk.kind)}
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono">{pk.name}</span>
                            </a>
                            {index < flowDocs.pickings.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground/50 mx-0.5" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Inline notes (etapa anterior, batch, reschedule, backorder) */}
            {(picking.step_label || picking.previous_picking_id || picking.batch_id || picking.reschedule_count > 0 || original || backorder || (isDone && receiptSummary)) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground px-1">
                {picking.previous_picking_id && (
                  <span>← Etapa anterior: <a href={`/inventory/transfers/${picking.previous_picking_id}`} className="text-primary hover:underline">ver</a></span>
                )}
                {picking.batch_id && (
                  <span>Lote: <a href={`/inventory/batches/${picking.batch_id}`} className="text-primary hover:underline">abrir</a></span>
                )}
                {picking.reschedule_count > 0 && (
                  <span className="text-warning">🔄 Reagendado {picking.reschedule_count}× {picking.reschedule_reason ? `· ${picking.reschedule_reason}` : ""}</span>
                )}
                {original && (
                  <span>↩ Backorder de <a href={`/inventory/transfers/${original.id}`} className="text-primary hover:underline">{original.name}</a></span>
                )}
                {backorder && (
                  <span>→ Em falta: <a href={`/inventory/transfers/${backorder.id}`} className="text-primary hover:underline">{backorder.name}</a> ({stateLabel(backorder.state)})</span>
                )}
                {isDone && receiptSummary && (
                  <span className={isPartialReceipt ? "text-warning" : "text-success"}>
                    {isPartialReceipt
                      ? `Parcial: ${receiptSummary.doneQty}/${receiptSummary.totalQty} un.`
                      : `Completo: ${receiptSummary.doneQty}/${receiptSummary.totalQty} un.`}
                  </span>
                )}
              </div>
            )}

            {isOutgoing && (
              <Card className="px-4 py-2">
                <DeliveryStatusBadge picking={picking} onChanged={load} showActions={!isLocked} />
              </Card>
            )}

            {/* Compact info grid - Odoo style */}
            <Card className="divide-y">
              <div className="grid sm:grid-cols-3 gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div><div className="o-section-title">Tipo</div><div>{kindLabel(picking.kind)}</div></div>
                <div><div className="o-section-title">Origem</div><div className="truncate" title={picking.source?.full_path ?? picking.source?.name}>{picking.source?.full_path ?? picking.source?.name ?? "—"}</div></div>
                <div><div className="o-section-title">Destino</div><div className="truncate" title={picking.dest?.full_path ?? picking.dest?.name}>{picking.dest?.full_path ?? picking.dest?.name ?? "—"}</div></div>
                <div><div className="o-section-title">Parceiro</div><div>{picking.partners?.name ?? "—"}</div></div>
                <div><div className="o-section-title">Doc. origem</div><div>{picking.origin ?? "—"}</div></div>
                <div><div className="o-section-title">Programado</div><div>{picking.scheduled_at ? new Date(picking.scheduled_at).toLocaleString("pt-PT") : "—"}</div></div>
              </div>
              {/* Route / Vehicle / Carrier row */}
              {(picking.delivery_routes || picking.vehicles || picking.delivery_carriers || picking.tracking_ref) && (
                <div className="grid sm:grid-cols-3 gap-x-4 gap-y-2 px-4 py-3 text-sm bg-muted/20">
                  <div>
                    <div className="o-section-title flex items-center gap-1"><RouteIcon className="h-3 w-3" /> Rota</div>
                    {picking.delivery_routes ? (
                      <a href={`/routes/${picking.delivery_routes.id}`} className="text-primary hover:underline inline-flex items-center gap-1.5">
                        {picking.delivery_routes.delivery_zones?.color && (
                          <span className="h-2 w-2 rounded-full" style={{ background: picking.delivery_routes.delivery_zones.color }} />
                        )}
                        <span>{picking.delivery_routes.delivery_zones?.name ?? "Rota"}</span>
                        {picking.delivery_routes.route_date && (
                          <span className="text-xs text-muted-foreground">· {new Date(picking.delivery_routes.route_date).toLocaleDateString("pt-PT")}</span>
                        )}
                      </a>
                    ) : <span className="text-muted-foreground">— sem rota atribuída</span>}
                  </div>
                  <div>
                    <div className="o-section-title flex items-center gap-1"><Car className="h-3 w-3" /> Carrinha</div>
                    {picking.vehicles ? (
                      <span>{picking.vehicles.name} {picking.vehicles.license_plate && <span className="text-xs text-muted-foreground font-mono ml-1">{picking.vehicles.license_plate}</span>}</span>
                    ) : <span className="text-muted-foreground">— sem carrinha</span>}
                  </div>
                  <div>
                    <div className="o-section-title flex items-center gap-1"><Truck className="h-3 w-3" /> Transportadora</div>
                    {picking.delivery_carriers ? (
                      <span>{picking.delivery_carriers.name}{picking.tracking_ref && <span className="text-xs text-muted-foreground ml-1">· {picking.tracking_ref}</span>}</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
              )}
            </Card>



            <Card>
              <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3">
                <div className="font-semibold text-sm">Movimentos</div>
                {availSummary && !isLocked && (
                  <div className="flex items-center gap-2">
                    {isFullyShort ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Sem stock</span>
                    ) : isPartial ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Parcial · {availSummary.fullyAvailable}/{availSummary.total}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-success font-medium"><PackageCheck className="h-3.5 w-3.5" /> Reservado · {availSummary.available}/{availSummary.needed} un.</span>
                    )}
                  </div>
                )}
              </div>
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
                       <td className="px-3 py-2">
                         <div className="font-medium">{m.products?.name}</div>
                         {(() => {
                           const vals = (m.product_variants?.product_variant_values || [])
                             .map((x: any) => x.product_attribute_values?.name)
                             .filter(Boolean)
                             .join(" / ");
                           const sku = m.product_variants?.sku;
                           if (!vals && !sku) return null;
                           return (
                             <div className="text-xs text-muted-foreground">
                               {vals}{vals && sku ? " · " : ""}{sku ? <span className="font-mono">{sku}</span> : null}
                             </div>
                           );
                         })()}
                         {(sourceSoByProduct[m.product_id] ?? []).map((so) => (
                           <a
                             key={so.id}
                             href={`/sales/orders/${so.id}`}
                             className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 mr-1"
                             title="Venda de origem deste produto"
                           >
                             <ShoppingCart className="h-3 w-3" /> Venda: {so.name}
                           </a>
                          ))}
                          {(packagesByProduct[m.product_id] ?? []).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {packagesByProduct[m.product_id].map((pk: any) => (
                                <span key={pk.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" title={`Colis · scan ${pk.barcode ?? "—"}`}>
                                  📦 {pk.label} × {Number(m.quantity_done ?? m.quantity ?? 0)}
                                  {pk.barcode && <span className="font-mono opacity-70">{pk.barcode}</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
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
                          value={Number.isFinite(Number(m.quantity_done)) ? Number(m.quantity_done) : Number(m.quantity)}
                          disabled={isLocked}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") { setMoveDone(i, 0); return; }
                            const v = Number(raw);
                            if (!Number.isFinite(v)) return;
                            setMoveDone(i, isInt ? Math.max(0, Math.floor(v)) : Math.max(0, v));
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
                      <td className="px-3 py-2">
                        {m.state === "done" ? (
                          Number(m.quantity_done) >= Number(m.quantity) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                              <CheckCircle2 className="h-3 w-3" /> Recebido · {m.quantity_done}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                              <AlertTriangle className="h-3 w-3" /> Parcial · {m.quantity_done}/{m.quantity}
                            </span>
                          )
                        ) : m.state === "cancelled" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200">
                            <X className="h-3 w-3" /> Não recebido · 0/{m.quantity}
                          </span>
                        ) : (() => {
                          const qd = Number(m.quantity_done || 0);
                          const need = Number(m.quantity || 0);
                          if (qd === 0) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" title="Ao validar, esta linha será marcada como não recebida e gerará backorder">
                                <X className="h-3 w-3" /> Não recebido · 0/{need}
                              </span>
                            );
                          }
                          if (qd >= need) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" title="Pronto para validar como recebido completo">
                                <CheckCircle2 className="h-3 w-3" /> A receber · {qd}/{need}
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" title="Recebimento parcial — o restante irá para backorder">
                              <AlertTriangle className="h-3 w-3" /> Parcial · {qd}/{need}
                            </span>
                          );
                        })()}
                      </td>
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
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reagendar transferência</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">O produto será devolvido fisicamente ao Stock, mas continuará reservado para esta venda. Será notificada uma nova data ao vendedor.</p>
            <div>
              <Label className="text-xs">Nova data programada</Label>
              <Input type="datetime-local" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Motivo</Label>
              <Textarea rows={3} value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} placeholder="Ex.: cliente não compareceu no cais; ausente na entrega…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRescheduleOpen(false)}>Cancelar</Button>
            <Button onClick={submitReschedule}><CalendarClock className="h-4 w-4 mr-1" /> Reagendar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TransferReservationDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        moves={moves as any}
        warehouseId={picking?.warehouse_id ?? null}
        onDone={load}
      />
    </>
  );
}
