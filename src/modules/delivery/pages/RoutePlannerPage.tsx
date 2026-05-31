/**
 * F29 Bloco 3 — Planeamento de Rotas
 * Rota: /delivery/routes/plan
 * Mostra agendamentos por atribuir + rotas existentes com barras de capacidade.
 * Atribuição via RPC delivery_route_assign_order.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Truck, Package, ArrowRight, AlertTriangle } from "lucide-react";

type Zone = { id: string; name: string };

type Schedule = {
  id: string;
  scheduled_date: string;
  slot_start: string | null;
  slot_end: string | null;
  status: string;
  sale_order: { id: string; name: string; partner: { name: string } | null } | null;
};

type Route = {
  id: string;
  route_date: string;
  state: string;
  cap_deliveries: number | null;
  cap_volume_m3: number | null;
  cap_weight_kg: number | null;
  cap_assembly_minutes: number | null;
  current_deliveries: number;
  current_volume_m3: number;
  current_weight_kg: number;
  current_assembly_minutes: number;
  capacity_status: string;
  driver: { full_name: string } | null;
  vehicle: { name: string | null; license_plate: string | null } | null;
  orders: { id: string; sequence: number; schedule_id: string; status: string }[];
};

const STATUS_TONE: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800",
  tight: "bg-amber-100 text-amber-800",
  saturated: "bg-rose-100 text-rose-800",
};

function CapacityBar({ label, current, cap, unit = "" }: { label: string; current: number; cap: number | null; unit?: string }) {
  const c = Number(cap ?? 0);
  const pct = c > 0 ? Math.min(100, (current / c) * 100) : 0;
  const tone = pct >= 100 ? "bg-rose-500" : pct >= 90 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{current.toFixed(unit === "" ? 0 : 1)}{unit} / {c.toFixed(unit === "" ? 0 : 1)}{unit}</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RoutePlannerPage() {
  const qc = useQueryClient();
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const [date, setDate] = useState(tomorrow);
  const [zoneId, setZoneId] = useState<string>("");
  const [selectedSchedule, setSelectedSchedule] = useState<string | null>(null);

  const zonesQ = useQuery({
    queryKey: ["zones"],
    queryFn: async (): Promise<Zone[]> => {
      const { data, error } = await supabase
        .from("delivery_zones")
        .select("id,name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const schedulesQ = useQuery({
    queryKey: ["plan-schedules", date, zoneId],
    enabled: !!zoneId,
    queryFn: async (): Promise<Schedule[]> => {
      const { data, error } = await supabase
        .from("delivery_schedules")
        .select("id,scheduled_date,slot_start,slot_end,status,sale_order:sale_orders(id,name,partner:partners(name))")
        .eq("scheduled_date", date)
        .eq("zone_id", zoneId)
        .is("route_id", null)
        .in("status", ["requested", "scheduled", "confirmed", "waiting_confirmation"])
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Schedule[];
    },
  });

  const routesQ = useQuery({
    queryKey: ["plan-routes", date, zoneId],
    enabled: !!zoneId,
    queryFn: async (): Promise<Route[]> => {
      const { data, error } = await supabase
        .from("delivery_routes")
        .select("id,route_date,state,cap_deliveries,cap_volume_m3,cap_weight_kg,cap_assembly_minutes,current_deliveries,current_volume_m3,current_weight_kg,current_assembly_minutes,capacity_status,driver:hr_employees!delivery_routes_driver_id_fkey(full_name),vehicle:vehicles(name,license_plate),orders:delivery_route_orders(id,sequence,schedule_id,status)")
        .eq("route_date", date)
        .eq("zone_id", zoneId)
        .not("state", "in", "(cancelled,done)")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Route[];
    },
  });

  const assignMut = useMutation({
    mutationFn: async ({ routeId, scheduleId }: { routeId: string; scheduleId: string }) => {
      const { data, error } = await supabase.rpc("delivery_route_assign_order", {
        _route_id: routeId,
        _schedule_id: scheduleId,
      });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string };
      if (!result?.ok) throw new Error(result?.error ?? "Falha ao atribuir");
      return data;
    },
    onSuccess: () => {
      toast.success("Agendamento atribuído à rota.");
      setSelectedSchedule(null);
      qc.invalidateQueries({ queryKey: ["plan-schedules"] });
      qc.invalidateQueries({ queryKey: ["plan-routes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Planeamento de Rotas</h1>
        <p className="text-sm text-muted-foreground">Atribui agendamentos pendentes às rotas do dia.</p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Zona</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger><SelectValue placeholder="Escolher zona…" /></SelectTrigger>
              <SelectContent>
                {(zonesQ.data ?? []).map((z) => (
                  <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!zoneId ? (
        <div className="text-center text-muted-foreground py-12">Seleciona uma zona para começar.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Schedules por atribuir */}
          <div className="lg:col-span-2 space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Agendamentos por atribuir ({schedulesQ.data?.length ?? 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {schedulesQ.isLoading ? (
                  <div className="text-sm text-muted-foreground">A carregar…</div>
                ) : (schedulesQ.data?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Nenhum agendamento pendente nesta zona.
                  </div>
                ) : (
                  schedulesQ.data!.map((s) => {
                    const sel = selectedSchedule === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSchedule(sel ? null : s.id)}
                        className={`w-full text-left rounded-lg border p-3 transition-all ${
                          sel ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-sm">{s.sale_order?.name ?? "—"}</div>
                          <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{s.sale_order?.partner?.name ?? ""}</div>
                        {(s.slot_start || s.slot_end) && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {s.slot_start?.slice(0, 5)}{s.slot_end ? ` – ${s.slot_end.slice(0, 5)}` : ""}
                          </div>
                        )}
                        {sel && <div className="text-xs text-primary mt-2 font-medium">→ Escolhe a rota destino à direita</div>}
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Rotas */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Rotas do dia ({routesQ.data?.length ?? 0})
              </h2>
            </div>

            {routesQ.isLoading ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (routesQ.data?.length ?? 0) === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Sem rotas planeadas para esta zona neste dia.
                </CardContent>
              </Card>
            ) : (
              routesQ.data!.map((r) => {
                const canAssign = !!selectedSchedule;
                const status = r.capacity_status;
                return (
                  <Card key={r.id} className={canAssign ? "border-primary/40" : ""}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Truck className="h-4 w-4" />
                          {r.driver?.full_name ?? "Sem entregador"}
                          {r.vehicle && (
                            <span className="text-xs text-muted-foreground font-normal">
                              · {r.vehicle.name ?? r.vehicle.license_plate}
                            </span>
                          )}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className={STATUS_TONE[status] ?? "bg-muted"}>
                            {status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{r.state}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <CapacityBar label="Paragens" current={r.current_deliveries} cap={r.cap_deliveries} />
                        <CapacityBar label="Volume" current={Number(r.current_volume_m3)} cap={r.cap_volume_m3} unit="m³" />
                        <CapacityBar label="Peso" current={Number(r.current_weight_kg)} cap={r.cap_weight_kg} unit="kg" />
                        <CapacityBar label="Montagem" current={r.current_assembly_minutes} cap={r.cap_assembly_minutes} unit="min" />
                      </div>

                      {r.orders.length > 0 && (
                        <div className="text-xs text-muted-foreground border-t pt-2">
                          {r.orders.length} paragens atribuídas
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t">
                        <a className="text-xs text-muted-foreground hover:underline" href={`/routes/${r.id}`}>
                          Ver detalhe →
                        </a>
                        {canAssign && (
                          <Button
                            size="sm"
                            disabled={assignMut.isPending}
                            onClick={() => assignMut.mutate({ routeId: r.id, scheduleId: selectedSchedule! })}
                          >
                            <ArrowRight className="h-3 w-3 mr-1" />
                            Atribuir à esta rota
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}

            {(routesQ.data?.length ?? 0) > 0 && !selectedSchedule && (
              <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
                <AlertTriangle className="h-3 w-3" /> Seleciona um agendamento à esquerda para o atribuir a uma rota.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
