import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { Truck, User2, Calendar, AlertTriangle, Lock } from "lucide-react";

// NOTE (UI-P0): updates e deletes diretos a `delivery_routes` foram removidos.
// Lifecycle e mudanças críticas passam pelas RPCs oficiais (delivery_route_*).
// Edição de metadata livre (driver, notas, capacidade) fica desativada nesta fase
// até existir RPC dedicada.

export default function RouteDetail() {
  const { id } = useParams();
  const qc = useQueryClient();

  const { data: route, refetch: refetchRoute } = useQuery({
    queryKey: ["route-detail", id],
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("*, delivery_zones(name,color,zip_from,zip_to), vehicles(name,license_plate)")
        .eq("id", id!).maybeSingle()).data,
    enabled: !!id,
  });

  const { data: pickings = [], refetch: refetchPickings } = useQuery({
    queryKey: ["route-pickings", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,origin,partners(name,zip,city)")
        .eq("route_id", id!)
        .order("scheduled_at", { ascending: true })).data ?? [],
  });

  const { data: routeOrders = [], refetch: refetchOrders } = useQuery({
    queryKey: ["route-orders", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select("id, sequence, status, schedule_id, delivery_schedules(so_id, sale_orders(name))")
        .eq("route_id", id!)
        .order("sequence")).data ?? [],
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

  const refreshAll = () => {
    refetchRoute();
    refetchPickings();
    refetchOrders();
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

  const callRpc = async (key: string, fn: string, args: Record<string, any>, label: string) => {
    setBusy(key);
    const { data, error } = await (supabase as any).rpc(fn, args);
    setBusy(null);
    if (error) return toast.error(`${label}: ${error.message}`);
    if (data?.error) return toast.error(`${label}: ${data.error}`);
    toast.success(`${label} OK`);
    refreshAll();
    return data;
  };

  if (!route) return <PageBody>Carregando…</PageBody>;
  const r: any = route;
  const state = r.state as string;

  const can = {
    changeVehicle: ["planning", "planned"].includes(state),
    pickToDock: ["planning", "planned"].includes(state) && !!dockId,
    loadVehicle: ["planning", "planned", "loading"].includes(state),
    verifyLoad: state === "loading",
    start: ["loading", "planned"].includes(state),
    complete: ["in_progress", "in_transit"].includes(state),
    close: ["return_pending", "awaiting_cash_closure", "done", "completed"].includes(state),
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
            <strong>UI-P0:</strong> a edição livre de campos da rota foi desativada. Use as ações abaixo
            (RPCs oficiais) para alterar carrinha e progredir o ciclo de vida da rota.
          </div>
        </Card>

        <div className="grid gap-3 md:grid-cols-3 mb-4">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Estado</div>
            <Badge className="mt-1 capitalize">{state}</Badge>
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
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Data</div>
            <div className="mt-1 text-sm">{r.route_date}</div>
          </Card>
          <Card className="p-3 md:col-span-2">
            <div className="text-xs text-muted-foreground">Zona</div>
            <div className="mt-1 text-sm">{r.delivery_zones?.name} · CP {r.delivery_zones?.zip_from}–{r.delivery_zones?.zip_to}</div>
          </Card>
        </div>

        <Card className="p-3 mb-4 space-y-3">
          <div className="font-semibold text-sm">Ações de rota</div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={newVehicleId} onValueChange={setNewVehicleId}>
              <SelectTrigger className="h-8 w-64"><SelectValue placeholder="Trocar carrinha…" /></SelectTrigger>
              <SelectContent>
                {(vehicles as any[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name} {v.license_plate ? `· ${v.license_plate}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!can.changeVehicle || !newVehicleId || busy !== null}
              onClick={() => callRpc("chv", "delivery_route_change_vehicle", { _route_id: id, _vehicle_id: newVehicleId }, "Trocar carrinha")}>
              {busy === "chv" ? "..." : "Trocar"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={dockId} onValueChange={setDockId}>
              <SelectTrigger className="h-8 w-64"><SelectValue placeholder="Cais…" /></SelectTrigger>
              <SelectContent>
                {(docks as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!can.pickToDock || busy !== null}
              onClick={() => callRpc("ptd", "delivery_pick_to_dock", { _route_id: id, _dock_id: dockId }, "Pick to dock")}>
              {busy === "ptd" ? "..." : "1. Mover para cais"}
            </Button>
            <Button size="sm" variant="outline" disabled={!can.loadVehicle || busy !== null}
              onClick={() => callRpc("lv", "delivery_load_vehicle", { _route_id: id }, "Carregar viatura")}>
              {busy === "lv" ? "..." : "2. Carregar viatura"}
            </Button>
            <Button size="sm" variant="outline" disabled={!can.verifyLoad || busy !== null}
              onClick={() => callRpc("vl", "delivery_verify_load", { _route_id: id, _manifest_ids: [] as string[] }, "Verificar carga")}>
              {busy === "vl" ? "..." : "3. Verificar carga"}
            </Button>
            <Button size="sm" variant="outline" disabled={!can.start || busy !== null}
              onClick={() => callRpc("st", "delivery_route_start", { _route_id: id }, "Iniciar rota")}>
              {busy === "st" ? "..." : "4. Iniciar rota"}
            </Button>
            <Button size="sm" variant="outline" disabled={!can.complete || busy !== null}
              onClick={() => callRpc("cp", "delivery_route_complete", { _route_id: id }, "Completar rota")}>
              {busy === "cp" ? "..." : "5. Completar"}
            </Button>
            <Button size="sm" variant="default" disabled={!can.close || busy !== null}
              onClick={() => callRpc("cl", "delivery_route_close", { _route_id: id }, "Fechar rota")}>
              {busy === "cl" ? "..." : "6. Fechar rota"}
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5" />
            Os botões só ficam activos quando o estado da rota o permite. Os erros das RPCs são apresentados no toast.
          </div>
        </Card>

        <Card>
          <div className="px-3 py-2 border-b font-semibold text-sm">Entregas (route orders)</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2 w-12">#</th>
                <th className="text-left px-3 py-2">Encomenda</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2 w-96">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(routeOrders as any[]).length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sem orders na rota</td></tr>
              ) : (routeOrders as any[]).map((o) => {
                const canDeliver = ["loaded", "in_transit", "out_for_delivery", "pending"].includes(o.status);
                return (
                  <tr key={o.id} className="border-t">
                    <td className="px-3 py-2">{o.sequence}</td>
                    <td className="px-3 py-2">{o.delivery_schedules?.sale_orders?.name ?? o.schedule_id}</td>
                    <td className="px-3 py-2"><Badge variant="outline">{o.status}</Badge></td>
                    <td className="px-3 py-2 flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" disabled={!canDeliver || busy !== null}
                        onClick={() => callRpc(`d-${o.id}`, "delivery_order_deliver", { _route_order_id: o.id, _lines: [] }, "Entregar")}>
                        Entregar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!canDeliver || busy !== null}
                        onClick={() => {
                          const reason = prompt("Motivo da falha?") || "";
                          if (!reason) return;
                          callRpc(`f-${o.id}`, "delivery_order_fail", { _route_order_id: o.id, _reason: reason }, "Falha");
                        }}>
                        Falhar
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null}
                        onClick={() => callRpc(`r-${o.id}`, "delivery_return_to_warehouse", { _route_order_id: o.id, _lines: [] }, "Retornar ao armazém")}>
                        Retornar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="mt-3">
          <div className="px-3 py-2 border-b font-semibold text-sm">Transferências/pickings atribuídos</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2">Transferência</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">CP / Cidade</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pickings as any[]).length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sem pickings</td></tr>
              ) : (pickings as any[]).map((p) => (
                <tr key={p.id} className="border-t hover:bg-accent/30">
                  <td className="px-3 py-2"><Link to={`/inventory/transfers/${p.id}`} className="text-primary hover:underline">{p.name}</Link></td>
                  <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.partners?.zip ?? ""} {p.partners?.city ?? ""}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{p.state}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
