import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { Truck, MapPin, Package, CheckCircle2, AlertTriangle, PlayCircle, FlagOff, Lock } from "lucide-react";

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
        .select("id,name,state,scheduled_at,origin,partners(name,zip,city)")
        .eq("route_id", id!).order("scheduled_at", { ascending: true })).data ?? [],
  });

  const { data: routeOrders = [], refetch: refetchOrders } = useQuery({
    queryKey: ["route-orders", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select(`id, sequence, status, schedule_id, failed_reason, loaded_at, delivered_at, returned_at,
                 delivery_schedules(so_id:sale_order_id, sale_orders(name, partner_id, partners(name, phone, street, city, zip)))`)
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

  const [busy, setBusy] = useState<string | null>(null);
  const [newVehicleId, setNewVehicleId] = useState<string>("");
  const [dockId, setDockId] = useState<string>("");
  const [deliverOpen, setDeliverOpen] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState<{ scheduleId: string; soName?: string } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const refreshAll = () => {
    refetchRoute(); refetchPickings(); refetchOrders(); refetchManifest(); refetchDocks();
    qc.invalidateQueries({ queryKey: ["route-capacity", id] });
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

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
    return c;
  }, [routeOrders]);

  if (!route) return <PageBody>Carregando…</PageBody>;
  const r: any = route;
  const state = r.state as string;
  const isReturnPending = state === "return_pending";

  // packages still on vehicle (per stock_packages.current_location_id)
  const stockOnVehicle = manifestRows.filter(
    (m) => m.package_status && !["delivered"].includes(m.package_status) && Number(m.qty_pending ?? 0) > 0
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

  return (
    <>
      <PageHeader
        title={`${r.delivery_zones?.name ?? "Rota"} · ${r.route_date}`}
        breadcrumb={[{ label: "Rotas", to: "/routes" }, { label: r.route_date }]}
      />
      <PageBody>
        <Card className="p-3 mb-3 bg-amber-50 border-amber-300 text-amber-900 text-xs flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5" />
          <div>
            <strong>UI-4:</strong> visão operacional. Toda a mutação passa por RPCs oficiais (sem updates directos).
          </div>
        </Card>

        {/* Header summary */}
        <div className="grid gap-3 md:grid-cols-4 mb-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Estado</div>
            <Badge className="mt-1 capitalize">{state}</Badge>
            <div className="text-[10px] text-muted-foreground mt-1">capacidade: {r.capacity_status}</div>
            {isReturnPending && <Badge variant="outline" className="mt-1 text-[10px]">return_pending</Badge>}
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" />Carrinha</div>
            <div className="mt-1 text-sm">{r.vehicles?.name ?? "—"}{r.vehicles?.license_plate ? ` · ${r.vehicles.license_plate}` : ""}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><User2 className="h-3 w-3" />Motorista</div>
            <div className="mt-1 text-sm">{r.driver_id ?? "—"}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Data / Cais</div>
            <div className="mt-1 text-sm">{r.route_date}</div>
            <div className="text-[10px] text-muted-foreground">{r.loading_docks?.name ?? "sem cais"}</div>
          </Card>
        </div>

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
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs text-center">
            <div className="rounded bg-muted/30 py-1.5"><div className="text-muted-foreground">Total</div><div className="font-semibold">{orderCounts.total}</div></div>
            <div className="rounded bg-muted/30 py-1.5"><div className="text-muted-foreground">Pendentes</div><div className="font-semibold">{orderCounts.pending}</div></div>
            <div className="rounded bg-muted/30 py-1.5"><div className="text-muted-foreground">Carregadas</div><div className="font-semibold">{orderCounts.loaded}</div></div>
            <div className="rounded bg-emerald-50 py-1.5"><div className="text-muted-foreground">Entregues</div><div className="font-semibold">{orderCounts.delivered}</div></div>
            <div className="rounded bg-amber-50 py-1.5"><div className="text-muted-foreground">Parciais/Falhas</div><div className="font-semibold">{orderCounts.partial + orderCounts.failed}</div></div>
            <div className="rounded bg-rose-50 py-1.5"><div className="text-muted-foreground">Stock na viatura</div><div className="font-semibold">{stockOnVehicle}</div></div>
          </div>
        </Card>

        <div className="grid gap-3 md:grid-cols-3 mb-3">
          <div className="md:col-span-2 space-y-3">
            {/* Action bar */}
            <Card className="p-3 space-y-3">
              <div className="font-semibold text-sm">Ações de rota (RPCs)</div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={newVehicleId} onValueChange={setNewVehicleId}>
                  <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Trocar carrinha…" /></SelectTrigger>
                  <SelectContent>
                    {(vehicles as any[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name} {v.license_plate ? `· ${v.license_plate}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!can.changeVehicle || !newVehicleId || busy !== null}
                  onClick={() => callRpc("chv", "delivery_route_change_vehicle", { _route_id: id, _vehicle_id: newVehicleId }, "Trocar carrinha")}>
                  {busy === "chv" ? "…" : "Trocar"}
                </Button>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Preparação</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={dockId} onValueChange={setDockId}>
                    <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Cais…" /></SelectTrigger>
                    <SelectContent>
                      {(docks as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" disabled={!can.pickToDock || busy !== null} title={!dockId ? "Escolha um cais" : ""}
                    onClick={() => callRpc("ptd", "delivery_pick_to_dock", { _route_id: id, _dock_id: dockId }, "Mover para cais")}>
                    {busy === "ptd" ? "…" : "1. Mover p/ cais"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!can.loadVehicle || busy !== null}
                    onClick={() => callRpc("lv", "delivery_load_vehicle", { _route_id: id }, "Carregar viatura")}>
                    {busy === "lv" ? "…" : "2. Carregar viatura"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!can.verifyLoad || busy !== null}
                    onClick={() => callRpc("vl", "delivery_verify_load", { _route_id: id, _manifest_ids: [] as string[] }, "Verificar carga")}>
                    {busy === "vl" ? "…" : "3. Verificar carga"}
                  </Button>
                  <Button size="sm" variant="default" disabled={!can.start || busy !== null}
                    onClick={() => callRpc("st", "delivery_route_start", { _route_id: id }, "Iniciar rota")}>
                    {busy === "st" ? "…" : "4. Iniciar rota"}
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Fecho</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={!can.complete || busy !== null}
                    onClick={() => callRpc("cp", "delivery_route_complete", { _route_id: id }, "Completar rota")}>
                    {busy === "cp" ? "…" : "5. Completar"}
                  </Button>
                  <Button size="sm" variant="default" disabled={!can.close || busy !== null}
                    title={!can.close ? (stockOnVehicle > 0 ? `${stockOnVehicle} package(s) ainda na viatura` : "Estado não permite fechar") : ""}
                    onClick={() => callRpc("cl", "delivery_route_close", { _route_id: id }, "Fechar rota", true)}>
                    {busy === "cl" ? "…" : "6. Fechar rota"}
                  </Button>
                </div>
                {closeError && (
                  <div className="mt-2 text-xs rounded border border-rose-300 bg-rose-50 text-rose-900 px-2 py-1.5" role="alert" data-testid="close-error">
                    Fechar bloqueado: {closeError}
                  </div>
                )}
              </div>
            </Card>
          </div>

          <RouteCapacityCard capacity={capacity} stats={stats} />
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
                const myPkgs = manifestRows.filter((m) => (manifest as any[]).find((mm) => mm.id === m.id)?.route_order_id === o.id);
                const canDeliver = ["loaded", "in_transit", "out_for_delivery", "pending", "planned", "loading"].includes(o.status);
                const canReturn = !["cancelled", "returned"].includes(o.status);
                return (
                  <tr key={o.id} className="border-t align-top">
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
                      <Badge variant="outline" className="capitalize">{o.status}</Badge>
                      {o.failed_reason && <div className="text-[10px] text-rose-700 mt-1">{o.failed_reason}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {myPkgs.reduce((a, m) => a + m.qty_loaded, 0)}/
                      {myPkgs.reduce((a, m) => a + m.qty_delivered, 0)}/
                      {myPkgs.reduce((a, m) => a + m.qty_returned, 0)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
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
                      </div>

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
