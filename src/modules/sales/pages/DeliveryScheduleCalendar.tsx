import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Sparkles, Truck, Wrench, Boxes, ExternalLink, CalendarPlus } from "lucide-react";
import { useRealtimeInvalidate } from "@/core/realtime";
import {
  calculateDayCapacity,
  suggestDeliveryDays,
  type RouteRow,
  type ScheduleRow,
  type SaturationStatus,
} from "@/modules/sales/lib/deliverySchedule";
import { ScheduleSaleOrderDeliveryDialog } from "@/modules/sales/components/ScheduleSaleOrderDeliveryDialog";

const fmt = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: digits });

const satClass: Record<SaturationStatus, string> = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  red: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  unknown: "bg-muted text-muted-foreground",
};
const satLabel: Record<SaturationStatus, string> = {
  green: "Disponível",
  yellow: "Quase cheio",
  red: "Saturado",
  unknown: "—",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function DeliveryScheduleCalendar() {
  const [params] = useSearchParams();
  const focusSoId = params.get("sale_order_id");
  const focusPostal = params.get("postal_code");
  const focusPreferred = params.get("preferred_date");

  const [anchor, setAnchor] = useState<Date>(() => focusPreferred ? new Date(focusPreferred + "T00:00:00") : new Date());
  const [view, setView] = useState<"week" | "month">("month");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [modeFilter, setModeFilter] = useState<string>("all");

  const range = useMemo(() => {
    if (view === "month") {
      const start = startOfMonth(anchor);
      const end = endOfMonth(anchor);
      return { start: isoDate(start), end: isoDate(end), days: Array.from({ length: end.getDate() }, (_, i) => isoDate(addDays(start, i))) };
    }
    const start = startOfWeek(anchor);
    return { start: isoDate(start), end: isoDate(addDays(start, 6)), days: Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i))) };
  }, [anchor, view]);

  const { data: zones = [] } = useQuery({
    queryKey: ["delivery-zones-list"],
    queryFn: async () => (await supabase.from("delivery_zones").select("id,name,color,zip_from,zip_to").order("name")).data ?? [],
  });

  const { data: routes = [] } = useQuery<RouteRow[]>({
    queryKey: ["delivery-schedule-routes", range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_routes")
        .select(`
          id, route_date, state, zone_id, vehicle_id,
          cap_deliveries, cap_volume_m3, cap_assembly_minutes,
          current_deliveries, current_volume_m3, current_assembly_minutes,
          delivery_zones(id, name, color, zip_from, zip_to),
          vehicles(id, name, license_plate, usable_volume_m3, volume_m3, assembly_minutes_capacity, max_stops, max_assembly_minutes)
        `)
        .gte("route_date", range.start)
        .lte("route_date", range.end);
      if (error) throw error;
      return (data ?? []) as unknown as RouteRow[];
    },
  });

  const { data: schedules = [] } = useQuery<(ScheduleRow & { sale_orders?: any; partners?: any })[]>({
    queryKey: ["delivery-schedule-schedules", range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_schedules")
        .select(`
          id, sale_order_id, route_id, scheduled_date, slot_start, slot_end, status, fulfillment_type, partner_id,
          sale_orders(id, name, commitment_date, include_assembly, delivery_mode),
          partners(name, zip)
        `)
        .gte("scheduled_date", range.start)
        .lte("scheduled_date", range.end);
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  useRealtimeInvalidate({
    channel: `delivery-schedule-${range.start}-${range.end}`,
    filters: [
      { table: "delivery_routes" },
      { table: "delivery_schedules" },
      { table: "sale_orders" },
    ],
    queryKeys: [
      ["delivery-schedule-routes", range.start, range.end],
      ["delivery-schedule-schedules", range.start, range.end],
    ],
    debounceMs: 500,
  });

  // Optional focus SO postal code (loaded if not provided in query string)
  const { data: focusSo } = useQuery({
    enabled: !!focusSoId,
    queryKey: ["focus-so", focusSoId],
    queryFn: async () => (await supabase.from("sale_orders").select("id,name,commitment_date,partners(zip)").eq("id", focusSoId!).maybeSingle()).data,
  });
  const postalCode = focusPostal ?? (focusSo as any)?.partners?.zip ?? null;
  const preferredDate = focusPreferred ?? (focusSo as any)?.commitment_date ?? isoDate(new Date());

  const filteredRoutes = useMemo(() => routes.filter((r) => zoneFilter === "all" || r.zone_id === zoneFilter), [routes, zoneFilter]);
  const filteredSchedules = useMemo(() => schedules.filter((s) => {
    if (modeFilter !== "all") {
      const mode = (s as any).fulfillment_type ?? (s as any).sale_orders?.delivery_mode;
      if (mode !== modeFilter) return false;
    }
    if (zoneFilter !== "all") {
      const r = routes.find((rr) => rr.id === s.route_id);
      if (!r || r.zone_id !== zoneFilter) return false;
    }
    return true;
  }), [schedules, modeFilter, zoneFilter, routes]);

  const byDate = useMemo(() => {
    const rMap = new Map<string, RouteRow[]>();
    const sMap = new Map<string, any[]>();
    for (const r of filteredRoutes) {
      if (!r.route_date) continue;
      (rMap.get(r.route_date) ?? rMap.set(r.route_date, []).get(r.route_date)!).push(r);
    }
    for (const s of filteredSchedules) {
      const d = s.scheduled_date;
      if (!d) continue;
      (sMap.get(d) ?? sMap.set(d, []).get(d)!).push(s);
    }
    return { rMap, sMap };
  }, [filteredRoutes, filteredSchedules]);

  const dayCapacities = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calculateDayCapacity>>();
    for (const d of range.days) {
      m.set(d, calculateDayCapacity(d, byDate.rMap.get(d) ?? [], byDate.sMap.get(d) ?? []));
    }
    return m;
  }, [range.days, byDate]);

  const suggestions = useMemo(() => {
    if (!postalCode && !focusSoId) return [];
    const satMap = new Map<string, SaturationStatus>();
    dayCapacities.forEach((c, d) => satMap.set(d, c.saturation_status));
    return suggestDeliveryDays({
      postalCode,
      fromDate: preferredDate,
      routes: filteredRoutes,
      daySaturation: satMap,
      limit: 8,
    });
  }, [postalCode, preferredDate, filteredRoutes, dayCapacities, focusSoId]);

  const suggestedDates = useMemo(() => new Set(suggestions.map((s) => s.date)), [suggestions]);
  const suggestionByDate = useMemo(() => {
    const m = new Map<string, typeof suggestions[number]>();
    for (const s of suggestions) if (!m.has(s.date)) m.set(s.date, s);
    return m;
  }, [suggestions]);

  const [drawerDate, setDrawerDate] = useState<string | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<{ saleOrderId: string; date?: string | null } | null>(null);

  const monthLabel = anchor.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cronograma de Entregas"
        breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Cronograma" }]}
      />

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium capitalize min-w-[160px] text-center">{monthLabel}</div>
          <Button size="icon" variant="ghost" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="ml-2" onClick={() => setAnchor(new Date())}>Hoje</Button>
        </div>

        <div className="ml-auto flex flex-wrap gap-2 items-center">
          <Select value={view} onValueChange={(v) => setView(v as any)}>
            <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Mês</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
            </SelectContent>
          </Select>
          <Select value={zoneFilter} onValueChange={setZoneFilter}>
            <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Zona" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as zonas</SelectItem>
              {(zones as any[]).map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Modo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os modos</SelectItem>
              <SelectItem value="delivery">Entrega</SelectItem>
              <SelectItem value="pickup">Levantamento</SelectItem>
              <SelectItem value="direct">Direto</SelectItem>
            </SelectContent>
          </Select>
          {postalCode && (
            <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" /> CP {postalCode}</Badge>
          )}
        </div>
      </Card>

      {focusSoId && (
        <Card className="p-3 flex flex-wrap items-center gap-2 text-sm border-primary/40">
          <CalendarPlus className="h-4 w-4 text-primary" />
          <span>
            Em foco: <b>{(focusSo as any)?.name ?? "venda"}</b>
            {postalCode ? ` · CP ${postalCode}` : ""}
          </span>
          <Button size="sm" className="ml-auto h-7 text-xs"
            onClick={() => setScheduleDialog({ saleOrderId: focusSoId, date: preferredDate })}>
            <CalendarPlus className="h-3 w-3 mr-1" /> Agendar/Reagendar entrega
          </Button>
        </Card>
      )}

      {suggestions.length > 0 && (
        <Card className="p-3 border-emerald-200/60 dark:border-emerald-900/40">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Dias sugeridos {postalCode ? `para CP ${postalCode}` : ""}
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={`${s.date}-${s.route_id}`} onClick={() => setDrawerDate(s.date)}
                className="px-2.5 py-1.5 rounded-md border text-xs hover:bg-accent text-left">
                <div className="font-medium">{new Date(s.date).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" })}</div>
                <div className="text-muted-foreground">{s.zone_name} · {s.capacity_remaining_m3 != null ? `${fmt(s.capacity_remaining_m3)} m³ livres` : "capacidade ?"}</div>
              </button>
            ))}
          </div>
        </Card>
      )}


      <TooltipProvider delayDuration={150}>
        <div className={view === "month" ? "grid grid-cols-7 gap-2" : "grid grid-cols-7 gap-2"}>
          {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((d) => (
            <div key={d} className="text-[10px] uppercase tracking-wide text-muted-foreground px-1">{d}</div>
          ))}
          {view === "month" && Array.from({ length: (startOfMonth(anchor).getDay() + 6) % 7 }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {range.days.map((d) => {
            const cap = dayCapacities.get(d)!;
            const isSuggested = suggestedDates.has(d);
            const sug = suggestionByDate.get(d);
            const cell = (
              <button
                onClick={() => setDrawerDate(d)}
                className={`group h-[110px] rounded-md border p-2 text-left flex flex-col hover:bg-accent transition relative ${isSuggested ? "ring-2 ring-emerald-400/60 shadow-sm" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{new Date(d).getDate()}</span>
                  <Badge variant="outline" className={`text-[9px] ${satClass[cap.saturation_status]}`}>{satLabel[cap.saturation_status]}</Badge>
                </div>
                <div className="mt-auto space-y-0.5 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1"><Boxes className="h-3 w-3" /> {cap.slots_used}/{cap.slots_capacity ?? "—"} entregas</div>
                  <div className="flex items-center gap-1"><Truck className="h-3 w-3" /> {fmt(cap.volume_used_m3)}/{fmt(cap.volume_capacity_m3)} m³</div>
                  <div className="flex items-center gap-1"><Wrench className="h-3 w-3" /> {fmt(cap.assembly_minutes_total, 0)}/{fmt(cap.assembly_minutes_capacity, 0)} min</div>
                </div>
                {isSuggested && (
                  <Badge className="absolute top-1.5 right-1.5 text-[9px] bg-emerald-600 hover:bg-emerald-600">Recomendado</Badge>
                )}
              </button>
            );
            return isSuggested && sug ? (
              <Tooltip key={d}>
                <TooltipTrigger asChild>{cell}</TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{sug.reason}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={d}>{cell}</div>
            );
          })}
        </div>
      </TooltipProvider>

      <Sheet open={!!drawerDate} onOpenChange={(o) => !o && setDrawerDate(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {drawerDate && new Date(drawerDate).toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </SheetTitle>
            {drawerDate && suggestionByDate.get(drawerDate) && (
              <SheetDescription className="flex items-start gap-1 text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span><b>Motivo da sugestão:</b> {suggestionByDate.get(drawerDate)!.reason}</span>
              </SheetDescription>
            )}
          </SheetHeader>

          {drawerDate && (() => {
            const cap = dayCapacities.get(drawerDate)!;
            const ds = byDate.sMap.get(drawerDate) ?? [];
            const drs = byDate.rMap.get(drawerDate) ?? [];
            return (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Entregas</div>
                    <div className="font-semibold">{cap.slots_used}/{cap.slots_capacity ?? "—"}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Volume (m³)</div>
                    <div className="font-semibold">{fmt(cap.volume_used_m3)}/{fmt(cap.volume_capacity_m3)}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Montagem (min)</div>
                    <div className="font-semibold">{fmt(cap.assembly_minutes_total, 0)}/{fmt(cap.assembly_minutes_capacity, 0)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Rotas</div>
                  {drs.length === 0 ? <div className="text-xs text-muted-foreground">Sem rotas planeadas.</div> : (
                    <div className="space-y-1">
                      {drs.map((r) => (
                        <Link key={r.id} to={`/routes/${r.id}`} className="flex items-center justify-between text-xs rounded-md border px-2 py-1.5 hover:bg-accent">
                          <span className="flex items-center gap-1.5">
                            {r.delivery_zones?.color && <span className="inline-block h-2 w-2 rounded-full border" style={{ backgroundColor: r.delivery_zones.color }} />}
                            {r.delivery_zones?.name ?? "Rota"} · {r.vehicles?.name ?? "—"}
                          </span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Entregas do dia</div>
                  {ds.length === 0 ? <div className="text-xs text-muted-foreground">Sem entregas agendadas.</div> : (
                    <div className="space-y-1">
                      {ds.map((s: any) => {
                        const isFocus = focusSoId && s.sale_order_id === focusSoId;
                        return (
                          <div key={s.id} className={`rounded-md border px-2 py-1.5 text-xs flex items-center justify-between gap-2 ${isFocus ? "ring-1 ring-primary/50 bg-primary/5" : ""}`}>
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1">
                                {s.sale_orders?.name ?? "—"}
                                {s.status === "confirmed" ? <Badge variant="outline" className="text-[9px]">Confirmado</Badge> : s.status === "cancelled" ? <Badge variant="outline" className="text-[9px] line-through">Cancelado</Badge> : <Badge variant="outline" className="text-[9px]">Pendente</Badge>}
                              </div>
                              <div className="text-muted-foreground truncate">
                                {s.partners?.name ?? "—"}
                                {s.slot_start && s.slot_end && ` · ${String(s.slot_start).slice(0,5)}–${String(s.slot_end).slice(0,5)}`}
                                {s.partners?.zip && ` · ${s.partners.zip}`}
                              </div>
                            </div>
                            {s.sale_order_id && (
                              <Button asChild size="sm" variant="ghost" className="h-7">
                                <Link to={`/sales/orders/${s.sale_order_id}`}>Abrir</Link>
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
