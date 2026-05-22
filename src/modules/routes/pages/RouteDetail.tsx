import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Truck, MapPin, Package, CheckCircle2, AlertTriangle, PlayCircle, FlagOff, Lock, Euro, User, Wrench, Copy } from "lucide-react";

import { callRouteRpc } from "../lib/routeRpc";
import { RouteProgress } from "../components/RouteProgress";
import { RouteCapacityCard } from "../components/RouteCapacityCard";
import { RouteManifestTable, type ManifestRow } from "../components/RouteManifestTable";
import { RouteDockSection, type DockTransferRow } from "../components/RouteDockSection";
import { DeliverOrderDialog } from "../components/DeliverOrderDialog";
import { ReturnPackageDialog } from "../components/ReturnPackageDialog";
import { CashClosureCard } from "@/modules/m5/components/CashClosureCard";
import { RescheduleDialog } from "@/modules/m5/components/RescheduleDialog";
import {
  EntityHeader,
  OperationalStatusBadge,
  SummaryCards,
  type OperationalAction,
  type SummaryCardItem,
} from "@/core/operational";
import { useEntityRefresh } from "@/core/operational/hooks/useEntityRefresh";
import { useRouteRealtime } from "@/core/realtime";

// UI-4: visão operacional da rota.
// NOTA: continua a respeitar UI-P0 — sem .update()/.delete() directos em
// delivery_routes, delivery_route_orders, dock_transfers, vehicle_route_manifest,
// stock_packages ou stock_moves. Toda a mutação passa pelas RPCs oficiais.

export default function RouteDetail() {
  const { id } = useParams();
  const qc = useQueryClient();

  const { data: route, refetch: refetchRoute } = useQuery({
    queryKey: ["route-detail", id],
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("*, delivery_zones(name,color,zip_from,zip_to), vehicles(name,license_plate,stock_location_id), loading_docks(name)")
        .eq("id", id!).maybeSingle()).data,
    enabled: !!id,
  });

  const { data: capacity } = useQuery({
    queryKey: ["route-capacity", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("delivery_route_capacity", { _route_id: id });
      return data;
    },
    refetchInterval: 15000,
  });

  const { data: pickings = [], refetch: refetchPickings } = useQuery({
    queryKey: ["route-pickings", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,origin,destination_location_id,partners(name,zip,city)")
        .eq("route_id", id!).order("scheduled_at", { ascending: true })).data ?? [],
  });

  const { data: routeOrders = [], refetch: refetchOrders } = useQuery({
    queryKey: ["route-orders", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select(`id, sequence, status, schedule_id, failed_reason, loaded_at, delivered_at, returned_at,
                 delivery_schedules(so_id:sale_order_id, sale_orders(id, name, amount_total, payment_status, fulfillment_status, partner_id, partners(name, phone, street, city, zip)))`)
        .eq("route_id", id!).order("sequence")).data ?? [],
  });

  const { data: manifest = [], refetch: refetchManifest } = useQuery<any[]>({
    queryKey: ["route-manifest", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("vehicle_route_manifest")
        .select(`id, stock_package_id, package_ref, package_sequence, package_total, product_id,
                 length_cm, width_cm, height_cm, weight_kg, fragile, stackable, requires_flat_transport,
                 qty_loaded, qty_delivered, qty_returned, qty_pending, assistance_required, damaged,
                 verification_required, verified_at, route_order_id,
                 products(name), stock_packages(status,current_location_id),
                 delivery_route_orders(sequence, schedule_id, delivery_schedules(sale_orders(name, partners(name))))`)
        .eq("route_id", id!)).data ?? [],
  });

  const { data: dockTransfers = [], refetch: refetchDocks } = useQuery<any[]>({
    queryKey: ["route-docks", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("dock_transfers")
        .select("id,status,moved_at,loaded_at, loading_docks(name), loading_dock_lanes(code), stock_pickings(name)")
        .eq("route_id", id!).order("created_at")).data ?? [],
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-route"],
    queryFn: async () => (await supabase.from("vehicles").select("id,name,license_plate").eq("active", true).order("name")).data ?? [],
  });

  const { data: docks = [] } = useQuery({
    queryKey: ["docks-list"],
    queryFn: async () => (await supabase.from("loading_docks").select("id,name").eq("active", true).order("name")).data ?? [],
  });

  const { data: people = [] } = useQuery({
    queryKey: ["profiles-route-crew"],
    queryFn: async () =>
      (await supabase.from("profiles").select("id,full_name").order("full_name")).data ?? [],
  });

  // Valores a receber: somatório dos SO da rota por estado de entrega.
  const { data: amounts } = useQuery({
    queryKey: ["route-amounts", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: orders } = await (supabase as any)
        .from("delivery_route_orders")
        .select("delivery_schedules(sale_order_id, sale_orders(amount_total))")
        .eq("route_id", id!);
      const orderIds = ((orders ?? []) as any[]).map((o) => o?.delivery_schedules?.sale_order_id).filter(Boolean);
      const { data: pays } = orderIds.length
        ? await supabase.from("customer_payments").select("order_id, amount").in("order_id", orderIds).eq("state", "posted")
        : { data: [] as any[] };
      const paidByOrder = new Map<string, number>();
      for (const p of (pays ?? []) as any[]) paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + Number(p.amount ?? 0));
      let expected = 0, collected = 0, pending = 0;
      for (const o of (orders ?? []) as any[]) {
        const tot = Number(o?.delivery_schedules?.sale_orders?.amount_total ?? 0);
        const paid = paidByOrder.get(o?.delivery_schedules?.sale_order_id) ?? 0;
        expected += tot;
        collected += paid;
        pending += Math.max(0, tot - paid);
      }
      return { expected, collected, pending };
    },
    refetchInterval: 15000,
  });

  const { data: routePayments = [] } = useQuery<any[]>({
    queryKey: ["route-payments", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: orders } = await (supabase as any)
        .from("delivery_route_orders")
        .select("delivery_schedules(sale_order_id)")
        .eq("route_id", id!);
      const orderIds = ((orders ?? []) as any[]).map((o) => o?.delivery_schedules?.sale_order_id).filter(Boolean);
      if (orderIds.length === 0) return [];
      return (await supabase
        .from("customer_payments")
        .select("id, order_id, amount, state, reference, payment_date, payment_methods(name, code)")
        .in("order_id", orderIds)
        .eq("state", "posted")
        .order("payment_date", { ascending: false })).data ?? [];
    },
  });

  const { data: routeAssistance = [] } = useQuery<any[]>({
    queryKey: ["route-assistance", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: byRoute } = await (supabase as any)
        .from("service_requests")
        .select("id, name, state, priority, description, route_id, picking_id, product_id, stock_pickings(name, origin), products(name)")
        .eq("route_id", id!)
        .neq("state", "cancelled");
      const { data: pks } = await supabase.from("stock_pickings").select("id").eq("route_id", id!);
      const pickingIds = ((pks ?? []) as any[]).map((p) => p.id);
      const { data: byPicking } = pickingIds.length
        ? await (supabase as any)
            .from("service_requests")
            .select("id, name, state, priority, description, route_id, picking_id, product_id, stock_pickings(name, origin), products(name)")
            .in("picking_id", pickingIds)
            .neq("state", "cancelled")
        : { data: [] as any[] };
      return Array.from(new Map([...(byRoute ?? []), ...(byPicking ?? [])].map((sr: any) => [sr.id, sr])).values());
    },
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [newVehicleId, setNewVehicleId] = useState<string>("");
  const [dockId, setDockId] = useState<string>("");
  const [deliverOpen, setDeliverOpen] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState<{ scheduleId: string; soName?: string } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const updateCrew = async (patch: { driver_id?: string | null; helper_id?: string | null }) => {
    if (!id) return;
    setBusy("crew");
    const { error } = await (supabase as any).from("delivery_routes").update(patch).eq("id", id);
    setBusy(null);
    if (error) toast.error(`Erro ao atualizar equipa: ${error.message}`);
    else { toast.success("Equipa atualizada"); refreshAll(); }
  };

  const { refresh, lastUpdated, isFetching } = useEntityRefresh({
    entityType: "delivery_route",
    entityId: id,
    extraKeys: [
      ["route-detail", id],
      ["route-capacity", id],
      ["route-pickings", id],
      ["route-orders", id],
      ["route-manifest", id],
      ["route-docks", id],
      ["route-payments", id],
      ["route-assistance", id],
      ["route-amounts", id],
      ["route-cash-summary", id],
      ["routes-schedule"],
    ],
  });

  const refreshAll = () => { void refresh(); };

  // F26-B realtime — invalidate route queries on related table changes.
  useRouteRealtime({ routeId: id });

  const callRpc = async (key: string, fn: string, args: Record<string, any>, label: string, closeCtx = false) => {
    setBusy(key);
    setCloseError(null);
    const res = await callRouteRpc(fn, args, label, { closeContext: closeCtx });
    setBusy(null);
    if (!res.ok && closeCtx) setCloseError(res.error ?? "Erro a fechar.");
    if (res.ok) refreshAll();
    return res;
  };

  // ---- derived state ----
  const manifestRows: ManifestRow[] = useMemo(() =>
    (manifest as any[]).map((m) => ({
      id: m.id,
      stock_package_id: m.stock_package_id,
      package_ref: m.package_ref,
      package_sequence: m.package_sequence,
      package_total: m.package_total,
      product_id: m.product_id,
      product_name: m.products?.name,
      customer_name: m.delivery_route_orders?.delivery_schedules?.sale_orders?.partners?.name,
      sale_order_name: m.delivery_route_orders?.delivery_schedules?.sale_orders?.name,
      route_order_sequence: m.delivery_route_orders?.sequence,
      length_cm: m.length_cm, width_cm: m.width_cm, height_cm: m.height_cm,
      weight_kg: m.weight_kg,
      fragile: !!m.fragile, stackable: !!m.stackable, requires_flat_transport: !!m.requires_flat_transport,
      qty_loaded: Number(m.qty_loaded ?? 0),
      qty_delivered: Number(m.qty_delivered ?? 0),
      qty_returned: Number(m.qty_returned ?? 0),
      qty_pending: m.qty_pending == null ? null : Number(m.qty_pending),
      assistance_required: !!m.assistance_required,
      damaged: !!m.damaged,
      route_order_id: m.route_order_id,
      package_status: m.stock_packages?.status,
    })), [manifest]);

  const stats = useMemo(() => {
    const f = (k: keyof ManifestRow) => manifestRows.reduce((a, r) => Math.max(a, Number(r[k] ?? 0)), 0);
    return {
      totalPackages: manifestRows.length,
      loadedCount: manifestRows.reduce((a, r) => a + r.qty_loaded, 0),
      deliveredCount: manifestRows.reduce((a, r) => a + r.qty_delivered, 0),
      returnedCount: manifestRows.reduce((a, r) => a + r.qty_returned, 0),
      maxLength: f("length_cm"),
      maxWidth: f("width_cm"),
      maxHeight: f("height_cm"),
      fragileCount: manifestRows.filter((r) => r.fragile).length,
      notStackableCount: manifestRows.filter((r) => !r.stackable).length,
      flatTransportCount: manifestRows.filter((r) => r.requires_flat_transport).length,
    };
  }, [manifestRows]);

  const verifyStats = useMemo(() => {
    const req = (manifest as any[]).filter((m) => m.verification_required).length;
    const ver = (manifest as any[]).filter((m) => m.verification_required && m.verified_at).length;
    return { req, ver };
  }, [manifest]);

  const dockRows: DockTransferRow[] = useMemo(() =>
    (dockTransfers as any[]).map((d) => ({
      id: d.id, status: d.status,
      dock_name: d.loading_docks?.name, lane_code: d.loading_dock_lanes?.code,
      picking_name: d.stock_pickings?.name, moved_at: d.moved_at, loaded_at: d.loaded_at,
    })), [dockTransfers]);

  const orderCounts = useMemo(() => {
    const c = { delivered: 0, partial: 0, failed: 0, returned: 0, loaded: 0, pending: 0, total: (routeOrders as any[]).length };
    for (const o of routeOrders as any[]) {
      if (o.status === "delivered") c.delivered++;
      else if (o.status === "partial") c.partial++;
      else if (o.status === "failed") c.failed++;
      else if (o.status === "returned") c.returned++;
      else if (o.status === "loaded" || o.status === "in_transit" || o.status === "out_for_delivery") c.loaded++;
      else c.pending++;
    }
    c.pending = Math.max(0, c.total - c.delivered - c.partial - c.failed - c.returned);
    return c;
  }, [routeOrders]);

  const orderFinancials = useMemo(() => {
    const byOrder = new Map<string, { paid: number; refs: string[]; methods: string[] }>();
    for (const p of routePayments as any[]) {
      const item = byOrder.get(p.order_id) ?? { paid: 0, refs: [], methods: [] };
      item.paid += Number(p.amount ?? 0);
      if (p.reference) item.refs.push(p.reference);
      const method = p.payment_methods?.name ?? p.payment_methods?.code;
      if (method) item.methods.push(method);
      byOrder.set(p.order_id, item);
    }
    return byOrder;
  }, [routePayments]);

  const assistanceByOrder = useMemo(() => {
    const byOrigin = new Map<string, any[]>();
    const routeLevel: any[] = [];
    for (const sr of routeAssistance as any[]) {
      const origin = sr.stock_pickings?.origin;
      if (origin) byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), sr]);
      else routeLevel.push(sr);
    }
    return { byOrigin, routeLevel };
  }, [routeAssistance]);

  if (!route) return <PageBody>Carregando…</PageBody>;
  const r: any = route;
  const state = r.state as string;
  const isReturnPending = state === "return_pending";

  // packages still on vehicle (per stock_packages.current_location_id)
  const stockOnVehicle = manifestRows.filter(
    (m) => (!m.package_status || !["delivered"].includes(m.package_status)) && Number(m.qty_pending ?? 0) > 0
  ).length;

  const can = {
    changeVehicle: ["planning", "planned"].includes(state),
    pickToDock: ["planning", "planned"].includes(state) && !!dockId,
    loadVehicle: ["planning", "planned", "loading"].includes(state),
    verifyLoad: state === "loading",
    start: ["loading", "planned"].includes(state),
    complete: ["in_progress", "in_transit"].includes(state),
    close: ["return_pending", "awaiting_cash_closure", "done", "completed"].includes(state) && stockOnVehicle === 0,
  };

  const disabledReason = (cond: boolean, reason: string) => (cond ? undefined : reason);
  const closeReasonText = !["return_pending", "awaiting_cash_closure", "done", "completed"].includes(state)
    ? "A rota ainda não está pronta para fechar."
    : stockOnVehicle > 0
      ? `${stockOnVehicle} package(s) ainda na viatura.`
      : undefined;

  const actions: OperationalAction[] = [
    {
      key: "ptd",
      label: "Mover p/ cais",
      icon: <Package className="h-4 w-4" />,
      onClick: async () => { await callRpc("ptd", "delivery_pick_to_dock", { _route_id: id, _dock_id: dockId }, "Mover para cais"); },
      loading: busy === "ptd",
      disabled: !can.pickToDock || busy !== null,
      disabledReason: !dockId ? "Selecione um cais antes de mover." : disabledReason(can.pickToDock, "Estado da rota não permite mover para cais."),
    },
    {
      key: "lv",
      label: "Carregar viatura",
      icon: <Truck className="h-4 w-4" />,
      onClick: async () => { await callRpc("lv", "delivery_load_vehicle", { _route_id: id }, "Carregar viatura"); },
      loading: busy === "lv",
      disabled: !can.loadVehicle || busy !== null,
      disabledReason: disabledReason(can.loadVehicle, "Estado da rota não permite carregar."),
    },
    {
      key: "vl",
      label: "Verificar carga",
      icon: <CheckCircle2 className="h-4 w-4" />,
      onClick: async () => { await callRpc("vl", "delivery_verify_load", { _route_id: id, _manifest_ids: [] as string[] }, "Verificar carga"); },
      loading: busy === "vl",
      disabled: !can.verifyLoad || busy !== null,
      disabledReason: disabledReason(can.verifyLoad, "A carga ainda não está em verificação."),
    },
    {
      key: "st",
      label: "Iniciar rota",
      variant: "default",
      icon: <PlayCircle className="h-4 w-4" />,
      onClick: async () => { await callRpc("st", "delivery_route_start", { _route_id: id }, "Iniciar rota"); },
      loading: busy === "st",
      disabled: !can.start || busy !== null,
      disabledReason: disabledReason(can.start, "A rota não está pronta para iniciar."),
      confirm: {
        title: "Iniciar rota?",
        description: "Confirma o início da rota com a viatura carregada.",
        confirmLabel: "Iniciar",
      },
    },
    {
      key: "cp",
      label: "Completar",
      icon: <FlagOff className="h-4 w-4" />,
      onClick: async () => { await callRpc("cp", "delivery_route_complete", { _route_id: id }, "Completar rota"); },
      loading: busy === "cp",
      disabled: !can.complete || busy !== null,
      disabledReason: disabledReason(can.complete, "A rota ainda não está em curso."),
      confirm: {
        title: "Marcar rota como completa?",
        description: "Esta ação dá a rota como terminada e prepara o fecho.",
        confirmLabel: "Completar",
      },
    },
    {
      key: "cl",
      label: "Fechar rota",
      variant: "default",
      icon: <Lock className="h-4 w-4" />,
      onClick: async () => { await callRpc("cl", "delivery_route_close", { _route_id: id }, "Fechar rota", true); },
      loading: busy === "cl",
      disabled: !can.close || busy !== null,
      disabledReason: closeReasonText,
      confirm: {
        title: "Fechar rota?",
        description: "Valida packages na viatura, pedidos abertos e verificação de carga.",
        confirmLabel: "Fechar",
      },
    },
  ];

  // Fallback to capacity RPC when manifest ainda não foi populado.
  const capDeliveries = Number((capacity as any)?.current_deliveries ?? 0) || orderCounts.total;
  const capVolUsed = Number((capacity as any)?.current_volume_m3 ?? 0);
  const capVolMax = Number((capacity as any)?.cap_volume_m3 ?? 0);
  const capWeightUsed = Number((capacity as any)?.current_weight_kg ?? 0);
  const utilPct = Number((capacity as any)?.utilization_percent ?? 0);
  const driverName = (people as any[]).find((p) => p.id === r.driver_id)?.full_name;
  const helperName = (people as any[]).find((p) => p.id === r.helper_id)?.full_name;

  const fmtEur = (n: number) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

  const summaryItems: SummaryCardItem[] = [
    {
      key: "deliveries",
      label: "Entregas",
      value: <span>{orderCounts.delivered + orderCounts.partial}<span className="text-muted-foreground text-base">/{orderCounts.total}</span></span>,
      hint: `Pendentes: ${orderCounts.pending} · Falhas: ${orderCounts.failed}`,
      tone: orderCounts.total > 0 && orderCounts.delivered + orderCounts.partial >= orderCounts.total ? "success" : "primary",
      icon: <MapPin className="h-3 w-3" />,
    },
    {
      key: "packages",
      label: "Colis",
      value: <span>{stats.loadedCount}<span className="text-muted-foreground text-base">/{stats.totalPackages || capDeliveries}</span></span>,
      hint: stats.totalPackages === 0
        ? "Manifesto ainda não populado (carregar viatura)"
        : `Entregues: ${stats.deliveredCount} · Retornados: ${stats.returnedCount}`,
      tone: stats.totalPackages > 0 && stats.loadedCount < stats.totalPackages ? "warning" : "default",
      icon: <Package className="h-3 w-3" />,
    },
    {
      key: "capacity",
      label: "Capacidade",
      value: <span className="tabular-nums">{utilPct}%</span>,
      hint: `${capVolUsed.toFixed(2)}/${capVolMax || "—"} m³ · ${capWeightUsed.toFixed(1)} kg`,
      tone: r.capacity_status === "overcapacity" ? "danger" : utilPct > 80 ? "warning" : "muted",
      icon: <Truck className="h-3 w-3" />,
    },
    {
      key: "verify",
      label: "Verificação",
      value: <span>{verifyStats.ver}<span className="text-muted-foreground text-base">/{verifyStats.req}</span></span>,
      hint: verifyStats.req === 0 ? "Não exigida" : "Manifesto verificado",
      tone: verifyStats.req > 0 && verifyStats.ver < verifyStats.req ? "warning" : "success",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    {
      key: "stock",
      label: "Stock viatura",
      value: <span>{stockOnVehicle}</span>,
      hint: `Parciais/falhas: ${orderCounts.partial + orderCounts.failed}`,
      tone: stockOnVehicle > 0 ? "danger" : orderCounts.failed > 0 ? "warning" : "success",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    {
      key: "receber",
      label: "A receber na entrega",
      value: <span className="tabular-nums">{fmtEur(Number(amounts?.pending ?? 0))}</span>,
      hint: `Previsto: ${fmtEur(Number(amounts?.expected ?? 0))} · Cobrado: ${fmtEur(Number(amounts?.collected ?? 0))}`,
      tone: (amounts?.pending ?? 0) > 0 ? "primary" : "success",
      icon: <Euro className="h-3 w-3" />,
    },
  ];

  return (
    <>
      <EntityHeader
        title={`${r.delivery_zones?.name ?? "Rota"} · ${r.route_date}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">
              {String(r.id).slice(0, 8)}
            </span>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(String(r.id)); toast.success("ID copiado"); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Copiar ID"
            >
              <Copy className="h-3 w-3" />
            </button>
            <span>·</span>
            <span>{r.vehicles?.name ?? "Sem viatura"}{r.vehicles?.license_plate ? ` · ${r.vehicles.license_plate}` : ""}</span>
            <span>· Motorista: {driverName ?? "—"}</span>
            <span>· Ajudante: {helperName ?? "—"}</span>
            {r.loading_docks?.name ? <span>· Cais: {r.loading_docks.name}</span> : null}
          </span>
        }
        breadcrumb={[{ label: "Rotas", to: "/routes" }, { label: r.route_date }]}
        statusBadges={
          <>
            <OperationalStatusBadge domain="delivery_route" status={state} />
            {isReturnPending && <Badge variant="outline" className="text-[10px]">retorno pendente</Badge>}
            {r.capacity_status === "overcapacity" && (
              <Badge variant="destructive" className="text-[10px]">Capacidade excedida</Badge>
            )}
          </>
        }
        metadata={[
          { label: "ID rota", value: String(r.id).slice(0, 8) },
          { label: "Data", value: r.route_date },
          { label: "Zona", value: r.delivery_zones?.name ?? "—" },
          { label: "Pedidos", value: `${orderCounts.delivered + orderCounts.partial}/${orderCounts.total}` },
          { label: "Cais", value: r.loading_docks?.name ?? "—" },
        ]}
        primaryActions={actions}
        onRefresh={refresh}
        isFetching={isFetching}
        lastUpdated={lastUpdated}
      />
      <PageBody>
        <SummaryCards items={summaryItems} className="mb-4" />

        {/* Equipa: motorista + ajudante */}
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1 mr-1">
            <User className="h-3 w-3" /> Motorista
          </span>
          <Select
            value={r.driver_id ?? "__none__"}
            onValueChange={(v) => updateCrew({ driver_id: v === "__none__" ? null : v })}
            disabled={busy !== null || state === "closed" || state === "done"}
          >
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Sem motorista —</SelectItem>
              {(people as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 8)}</SelectItem>)}
            </SelectContent>
          </Select>

          <span className="mx-2 h-5 w-px bg-border" aria-hidden />
          <span className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1 mr-1">
            <Wrench className="h-3 w-3" /> Ajudante de montagem
          </span>
          <Select
            value={r.helper_id ?? "__none__"}
            onValueChange={(v) => updateCrew({ helper_id: v === "__none__" ? null : v })}
            disabled={busy !== null || state === "closed" || state === "done"}
          >
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Sem ajudante —</SelectItem>
              {(people as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 8)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        {/* Vehicle swap (kept as inline control — not a primary action) */}
        {can.changeVehicle && (
          <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Trocar viatura</span>
            <Select value={newVehicleId} onValueChange={setNewVehicleId}>
              <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Selecionar viatura…" /></SelectTrigger>
              <SelectContent>
                {(vehicles as any[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name} {v.license_plate ? `· ${v.license_plate}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!newVehicleId || busy !== null}
              onClick={() => callRpc("chv", "delivery_route_change_vehicle", { _route_id: id, _vehicle_id: newVehicleId }, "Trocar carrinha")}>
              {busy === "chv" ? "…" : "Aplicar"}
            </Button>
            <span className="mx-2 h-5 w-px bg-border" aria-hidden />
            <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Cais</span>
            <Select value={dockId} onValueChange={setDockId}>
              <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Selecionar cais…" /></SelectTrigger>
              <SelectContent>
                {(docks as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Card>
        )}

        <Card className="p-3 mb-3 space-y-3">
          <RouteProgress
            routeState={state}
            hasDockTransfers={dockRows.length > 0}
            hasManifest={manifestRows.length > 0}
            manifestVerifiedCount={verifyStats.ver}
            manifestRequiringVerification={verifyStats.req}
            deliveredCount={orderCounts.delivered + orderCounts.partial}
            totalOrders={orderCounts.total}
            returnPendingCount={stockOnVehicle}
          />
          {closeError && (
            <div className="text-xs rounded border border-destructive/40 bg-destructive/5 text-destructive px-2 py-1.5" role="alert" data-testid="close-error">
              Fechar bloqueado: {closeError}
            </div>
          )}
        </Card>

        <div className="grid gap-3 md:grid-cols-3 mb-3">
          <div className="md:col-span-2">
            <RouteCapacityCard capacity={capacity} stats={stats} />
          </div>
        </div>

        <div className="mb-3">
          <RouteDockSection
            transfers={dockRows}
            orphanCount={dockRows.filter((d) => !d.dock_name).length}
            occupiedLaneAlerts={[]}
          />
        </div>

        <div className="mb-3">
          <RouteManifestTable rows={manifestRows} />
        </div>

        {/* UI M5 — Cash closure */}
        <div className="mb-3">
          <CashClosureCard routeId={id!} routeState={state} onClosed={refreshAll} />
        </div>

        <Card>
          <div className="px-3 py-2 border-b font-semibold text-sm">Pedidos da rota</div>
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-2 py-1.5 w-10">#</th>
                <th className="text-left px-2 py-1.5">Pedido / Cliente</th>
                <th className="text-left px-2 py-1.5">Morada</th>
                <th className="text-left px-2 py-1.5">Estado</th>
                <th className="text-right px-2 py-1.5">Pkgs (carr/entr/ret)</th>
                <th className="text-left px-2 py-1.5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(routeOrders as any[]).length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sem pedidos na rota</td></tr>
              ) : (routeOrders as any[]).map((o) => {
                const so = o.delivery_schedules?.sale_orders;
                const partner = so?.partners;
                const myPkgs = manifestRows.filter((m) => m.route_order_id === o.id);
                const deliveredQty = myPkgs.reduce((a, m) => a + m.qty_delivered, 0);
                const loadedQty = myPkgs.reduce((a, m) => a + m.qty_loaded, 0);
                const isDelivered = o.status === "delivered" || (loadedQty > 0 && deliveredQty >= loadedQty);
                const fin = orderFinancials.get(so?.id) ?? { paid: 0, refs: [], methods: [] };
                const orderAssist = [
                  ...(assistanceByOrder.byOrigin.get(so?.name) ?? []),
                  ...assistanceByOrder.routeLevel.filter((sr) => !sr.product_id || myPkgs.some((m) => m.product_id === sr.product_id)),
                ];
                const hasAssistance = orderAssist.length > 0 || myPkgs.some((m) => m.assistance_required);
                const canDeliver = !isDelivered && ["loaded", "in_transit", "out_for_delivery", "pending", "planned", "loading", "partial"].includes(o.status);
                const canReturn = !isDelivered && !["cancelled", "returned"].includes(o.status);
                return (
                  <tr key={o.id} className={`border-t align-top ${isDelivered ? "bg-emerald-500/5" : ""}`}>
                    <td className="px-2 py-2 tabular-nums">{o.sequence}</td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{so?.name ?? o.schedule_id}</div>
                      <div className="text-[11px] text-muted-foreground">{partner?.name ?? "—"}{partner?.phone ? ` · ${partner.phone}` : ""}</div>
                    </td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">
                      <div className="flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5" />
                        <div>{partner?.street ?? ""}<br />{partner?.zip ?? ""} {partner?.city ?? ""}</div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={isDelivered ? "default" : "outline"} className="capitalize">
                          {isDelivered ? "entregue" : o.status}
                        </Badge>
                        {hasAssistance && <Badge variant="outline" className="border-orange-400 text-orange-700">assistência</Badge>}
                        {fin.paid > 0 && <Badge variant="outline" className="border-emerald-500 text-emerald-700">recebido</Badge>}
                      </div>
                      {o.delivered_at && <div className="text-[10px] text-muted-foreground mt-1">{new Date(o.delivered_at).toLocaleString("pt-PT")}</div>}
                      {o.failed_reason && <div className="text-[10px] text-rose-700 mt-1">{o.failed_reason}</div>}
                      {hasAssistance && (
                        <div className="text-[10px] text-orange-700 mt-1">
                          {orderAssist[0]?.name ?? "Assistência sinalizada"}{orderAssist[0]?.products?.name ? ` · ${orderAssist[0].products.name}` : ""}
                        </div>
                      )}
                      {fin.paid > 0 && (
                        <div className="text-[10px] text-emerald-700 mt-1">
                          {fmtEur(fin.paid)}{fin.methods.length ? ` · ${Array.from(new Set(fin.methods)).join(", ")}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {loadedQty}/
                      {deliveredQty}/
                      {myPkgs.reduce((a, m) => a + m.qty_returned, 0)}
                    </td>
                    <td className="px-2 py-2">
                      {isDelivered ? (
                        <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Concluído pelo app entregas
                        </div>
                      ) : <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" disabled={!canDeliver || busy !== null}
                          onClick={() => setDeliverOpen(o.id)} aria-label={`entregar-${o.sequence}`}>
                          Entregar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canDeliver || busy !== null}
                          onClick={() => {
                            const reason = prompt("Motivo da falha?") || "";
                            if (!reason) return;
                            callRpc(`f-${o.id}`, "delivery_order_fail", { _route_order_id: o.id, _reason: reason }, "Falha");
                          }} aria-label={`falhar-${o.sequence}`}>
                          Falhar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canReturn || busy !== null}
                          onClick={() => setReturnOpen(o.id)} aria-label={`retornar-${o.sequence}`}>
                          Retornar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy !== null}
                          onClick={() => setRescheduleOpen({ scheduleId: o.schedule_id, soName: so?.name })}
                          aria-label={`reagendar-${o.sequence}`} data-testid={`reschedule-btn-${o.id}`}>
                          Reagendar
                        </Button>
                      </div>}

                      {deliverOpen === o.id && (
                        <DeliverOrderDialog
                          open
                          onOpenChange={(v) => !v && setDeliverOpen(null)}
                          routeOrderId={o.id}
                          customer={partner?.name}
                          saleOrderName={so?.name}
                          packages={myPkgs}
                          onDone={refreshAll}
                        />
                      )}
                      {returnOpen === o.id && (
                        <ReturnPackageDialog
                          open
                          onOpenChange={(v) => !v && setReturnOpen(null)}
                          routeOrderId={o.id}
                          saleOrderName={so?.name}
                          packages={myPkgs}
                          onDone={refreshAll}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {rescheduleOpen && (
          <RescheduleDialog
            open
            onOpenChange={(v) => !v && setRescheduleOpen(null)}
            scheduleId={rescheduleOpen.scheduleId}
            saleOrderName={rescheduleOpen.soName}
            currentDate={r.route_date}
            onDone={refreshAll}
          />
        )}

        <Card className="mt-3">
          <div className="px-3 py-2 border-b font-semibold text-sm">Transferências/pickings atribuídos</div>
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-2 py-1.5">Transferência</th>
                <th className="text-left px-2 py-1.5">Cliente</th>
                <th className="text-left px-2 py-1.5">CP / Cidade</th>
                <th className="text-left px-2 py-1.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pickings as any[]).length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sem pickings</td></tr>
              ) : (pickings as any[]).map((p) => (
                <tr key={p.id} className="border-t hover:bg-accent/30">
                  <td className="px-2 py-1.5"><Link to={`/inventory/transfers/${p.id}`} className="text-primary hover:underline">{p.name}</Link></td>
                  <td className="px-2 py-1.5">{p.partners?.name ?? "—"}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{p.partners?.zip ?? ""} {p.partners?.city ?? ""}</td>
                  <td className="px-2 py-1.5"><Badge variant="outline" className="capitalize">{p.state}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
