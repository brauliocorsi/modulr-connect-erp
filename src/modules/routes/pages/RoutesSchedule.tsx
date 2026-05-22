import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarPlus, MapPin, Truck, User2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { RouteCapacityMini } from "@/modules/routes/components/RouteCapacityMini";
import { toast } from "sonner";

// Local-date formatter — NEVER use toISOString here (it shifts dates by TZ).
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeekMon(d: Date) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Monday=0
  x.setDate(x.getDate() - dow);
  return x;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type ViewMode = "horizon" | "month";

export default function RoutesSchedule() {
  const qc = useQueryClient();
  const today = useMemo(() => new Date(new Date().toDateString()), []);
  const [view, setView] = useState<ViewMode>("horizon");
  const [horizonDays, setHorizonDays] = useState(15);
  const [monthAnchor, setMonthAnchor] = useState<Date>(startOfMonth(today));

  const [genOpen, setGenOpen] = useState(false);
  const [genDays, setGenDays] = useState(15);
  const [genZoneIds, setGenZoneIds] = useState<string[]>([]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<{
    zone_id: string;
    route_date: string;
    delivery_only: boolean;
    notes: string;
  }>({ zone_id: "", route_date: fmtDate(today), delivery_only: false, notes: "" });

  const visibleDates = useMemo(() => {
    if (view === "horizon") {
      return Array.from({ length: horizonDays }, (_, i) => addDays(today, i));
    }
    const first = startOfWeekMon(startOfMonth(monthAnchor));
    const last = endOfMonth(monthAnchor);
    const cells: Date[] = [];
    let cur = first;
    while (cur <= last || cells.length % 7 !== 0) {
      cells.push(cur);
      cur = addDays(cur, 1);
    }
    return cells;
  }, [view, horizonDays, today, monthAnchor]);

  const fromDate = useMemo(() => fmtDate(visibleDates[0]), [visibleDates]);
  const toDate = useMemo(() => fmtDate(visibleDates[visibleDates.length - 1]), [visibleDates]);

  const { data: zones = [] } = useQuery({
    queryKey: ["routes-zones-min"],
    queryFn: async () =>
      (await supabase
        .from("delivery_zones")
        .select("id,name,color,zip_from,zip_to,active")
        .eq("active", true)
        .order("name")).data ?? [],
  });

  const { data: routes = [] } = useQuery({
    queryKey: ["routes-schedule", fromDate, toDate],
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select(
          "id,zone_id,route_date,state,max_deliveries,max_assembly_minutes,driver_id,vehicle_id,created_by,created_at,route_type,cap_deliveries,current_deliveries,cap_volume_m3,current_volume_m3,cap_assembly_minutes,current_assembly_minutes,vehicles(name,license_plate,usable_volume_m3,volume_m3,max_stops,assembly_minutes_capacity,max_assembly_minutes),profiles!delivery_routes_created_by_fkey(full_name,email)"
        )
        .gte("route_date", fromDate)
        .lte("route_date", toDate)
        .order("route_date")).data ?? [],
  });

  const routeIds = (routes as any[]).map((r) => r.id);
  const { data: pickCounts = {} } = useQuery({
    queryKey: ["routes-pickings-count", routeIds.join(",")],
    enabled: routeIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id,route_id,state,origin")
        .in("route_id", routeIds)
        .neq("state", "cancelled");
      // Count unique deliveries per route (origin = SO/document); fallback to picking id when no origin.
      const seen: Record<string, Set<string>> = {};
      (data ?? []).forEach((p: any) => {
        const key = p.origin ?? p.id;
        if (!seen[p.route_id]) seen[p.route_id] = new Set();
        seen[p.route_id].add(key);
      });
      const map: Record<string, number> = {};
      for (const rid of Object.keys(seen)) map[rid] = seen[rid].size;
      return map;
    },
  });

  const byZoneDate: Record<string, Record<string, any>> = {};
  (routes as any[]).forEach((r) => {
    byZoneDate[r.zone_id] = byZoneDate[r.zone_id] ?? {};
    byZoneDate[r.zone_id][r.route_date] = r;
  });

  const openGen = () => {
    setGenDays(horizonDays);
    setGenZoneIds((zones as any[]).map((z) => z.id));
    setGenOpen(true);
  };

  const generate = async () => {
    if (!genZoneIds.length) return toast.error("Selecione pelo menos uma zona");
    const { data, error } = await supabase.rpc("generate_routes", {
      _horizon_days: genDays,
      _zone_ids: genZoneIds,
    });
    if (error) return toast.error(error.message);
    toast.success(`Geradas ${data ?? 0} rotas`);
    setGenOpen(false);
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

  const createManual = async () => {
    if (!manualForm.zone_id || !manualForm.route_date) {
      return toast.error("Zona e data são obrigatórias");
    }
    const { error } = await supabase.rpc("create_route_manual", {
      _zone_id: manualForm.zone_id,
      _route_date: manualForm.route_date,
      _delivery_only: manualForm.delivery_only,
      _notes: manualForm.notes || null,
    });
    if (error) {
      const map: Record<string, string> = {
        route_already_exists: "Já existe uma rota desta zona nesta data.",
        forbidden: "Sem permissão.",
        zone_not_found: "Zona não encontrada.",
      };
      return toast.error(map[error.message] ?? error.message);
    }
    toast.success("Rota criada");
    setManualOpen(false);
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

  const toggleZone = (id: string) =>
    setGenZoneIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const colCount = view === "horizon" ? horizonDays : 7;

  return (
    <TooltipProvider>
      <PageHeader
        title="Cronograma de Rotas"
        breadcrumb={[{ label: "Rotas" }]}
        actions={
          <>
            <div className="flex items-center gap-1 mr-2">
              <Button
                size="sm"
                variant={view === "horizon" ? "default" : "outline"}
                onClick={() => setView("horizon")}
              >
                Horizonte
              </Button>
              <Button
                size="sm"
                variant={view === "month" ? "default" : "outline"}
                onClick={() => setView("month")}
              >
                Mês
              </Button>
            </div>
            {view === "horizon" && (
              <Select value={String(horizonDays)} onValueChange={(v) => setHorizonDays(Number(v))}>
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[7, 15, 30, 60, 90].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} dias</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {view === "month" && (
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-sm font-medium w-[140px] text-center">
                  {MONTH_LABELS[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}
                </div>
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/routes/zones">
                <MapPin className="h-4 w-4 mr-1" /> Zonas
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setManualOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova rota
            </Button>
            <Button size="sm" onClick={openGen}>
              <CalendarPlus className="h-4 w-4 mr-1" /> Gerar rotas
            </Button>
          </>
        }
      />
      <PageBody>
        {zones.length === 0 ? (
          <EmptyState
            title="Sem zonas configuradas"
            description="Crie zonas (faixas de código postal) para começar a planear rotas."
            action={
              <Button asChild>
                <Link to="/routes/zones/new">Criar primeira zona</Link>
              </Button>
            }
          />
        ) : view === "horizon" ? (
          <Card className="overflow-auto">
            <div className="min-w-max">
              <div
                className="grid sticky top-0 bg-card border-b z-10"
                style={{ gridTemplateColumns: `220px repeat(${colCount}, 140px)` }}
              >
                <div className="p-2 text-xs font-medium text-muted-foreground">Zona</div>
                {visibleDates.map((d) => (
                  <div key={fmtDate(d)} className="p-2 text-center border-l">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {WEEKDAY_LABELS[d.getDay()]}
                    </div>
                    <div className="text-sm font-medium">
                      {d.getDate()}/{d.getMonth() + 1}
                    </div>
                  </div>
                ))}
              </div>

              {(zones as any[]).map((z) => (
                <div
                  key={z.id}
                  className="grid border-b hover:bg-muted/20"
                  style={{ gridTemplateColumns: `220px repeat(${colCount}, 140px)` }}
                >
                  <div className="p-2">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {z.color && (
                        <span
                          className="inline-block h-3 w-3 rounded-full border"
                          style={{ backgroundColor: z.color }}
                        />
                      )}
                      {z.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      CP {z.zip_from} – {z.zip_to}
                    </div>
                  </div>
                  {visibleDates.map((d) => {
                    const key = fmtDate(d);
                    const r = byZoneDate[z.id]?.[key];
                    return (
                      <div key={key} className="border-l p-1 min-h-[68px]">
                        {r ? (
                          <RouteCell route={r} count={pickCounts[r.id] ?? 0} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setManualForm({ zone_id: z.id, route_date: key, delivery_only: false, notes: "" });
                              setManualOpen(true);
                            }}
                            className="w-full h-full text-[10px] text-muted-foreground/40 hover:text-foreground hover:bg-accent/40 rounded text-center mt-3"
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="overflow-auto">
            <div className="grid grid-cols-7 border-b bg-card">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((l) => (
                <div key={l} className="p-2 text-xs font-medium text-center text-muted-foreground border-l first:border-l-0">
                  {l}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {visibleDates.map((d) => {
                const key = fmtDate(d);
                const inMonth = d.getMonth() === monthAnchor.getMonth();
                const dayRoutes = (routes as any[]).filter((r) => r.route_date === key);
                return (
                  <div
                    key={key}
                    className={`border-l border-b min-h-[110px] p-1 first:border-l-0 ${inMonth ? "" : "bg-muted/30"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className={`text-[11px] ${inMonth ? "font-medium" : "text-muted-foreground"}`}>
                        {d.getDate()}
                      </div>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setManualForm({ zone_id: "", route_date: key, delivery_only: false, notes: "" });
                          setManualOpen(true);
                        }}
                        title="Criar rota"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {dayRoutes.map((r) => {
                        const z = (zones as any[]).find((x) => x.id === r.zone_id);
                        return (
                          <Link
                            key={r.id}
                            to={`/routes/${r.id}`}
                            className="block rounded border bg-card hover:bg-accent p-1"
                          >
                            <div className="flex items-center gap-1">
                              {z?.color && (
                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: z.color }} />
                              )}
                              <span className="text-[10px] font-medium truncate">{z?.name ?? "Rota"}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground flex items-center justify-between">
                              <span>{pickCounts[r.id] ?? 0}/{r.max_deliveries}</span>
                              {r.max_assembly_minutes === 0 && <Badge variant="outline" className="text-[8px] px-1 py-0">Só entrega</Badge>}
                            </div>
                            <RouteCapacityMini route={r} compact />
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </PageBody>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar rotas</DialogTitle>
            <DialogDescription>Escolha o horizonte e as zonas a gerar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Horizonte (dias)</Label>
              <Input
                type="number"
                min={1}
                max={180}
                value={genDays}
                onChange={(e) => setGenDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                className="h-9"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Zonas</Label>
                <div className="flex gap-2">
                  <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setGenZoneIds((zones as any[]).map((z) => z.id))}>Todas</button>
                  <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setGenZoneIds([])}>Nenhuma</button>
                </div>
              </div>
              <div className="max-h-[260px] overflow-auto space-y-1 border rounded p-2">
                {(zones as any[]).map((z) => (
                  <label key={z.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-accent">
                    <Checkbox checked={genZoneIds.includes(z.id)} onCheckedChange={() => toggleZone(z.id)} />
                    {z.color && <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: z.color }} />}
                    <span className="flex-1">{z.name}</span>
                    <span className="text-[11px] text-muted-foreground">{z.zip_from}–{z.zip_to}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancelar</Button>
            <Button onClick={generate}>Gerar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual route dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova rota individual</DialogTitle>
            <DialogDescription>Crie uma rota numa data específica, opcionalmente só de entrega.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Zona</Label>
              <Select value={manualForm.zone_id || ""} onValueChange={(v) => setManualForm((f) => ({ ...f, zone_id: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Escolha uma zona" /></SelectTrigger>
                <SelectContent>
                  {(zones as any[]).map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={manualForm.route_date} onChange={(e) => setManualForm((f) => ({ ...f, route_date: e.target.value }))} className="h-9" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={manualForm.delivery_only} onCheckedChange={(v) => setManualForm((f) => ({ ...f, delivery_only: v }))} />
              Apenas entrega (sem montagem)
            </label>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={manualForm.notes} onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))} className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={createManual}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function RouteCell({ route, count }: { route: any; count: number }) {
  const creator = route.profiles?.full_name || route.profiles?.email || null;
  const deliveryOnly = route.max_assembly_minutes === 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={`/routes/${route.id}`} className="block rounded border bg-card hover:bg-accent p-1.5 h-full">
          <div className="flex items-center justify-between gap-1">
            <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">{route.state}</Badge>
            <span className="text-[11px] font-semibold">{count}/{route.max_deliveries}</span>
          </div>
          {route.vehicles && (
            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Truck className="h-2.5 w-2.5" />
              {route.vehicles.name}
            </div>
          )}
          {route.driver_id && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <User2 className="h-2.5 w-2.5" />
              Atribuído
            </div>
          )}
          {deliveryOnly && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5">Só entrega</Badge>
          )}
          <RouteCapacityMini route={route} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <div><b>Tipo:</b> {route.route_type === "manual" ? "Manual" : "Recorrente"}</div>
          {creator && <div><b>Criada por:</b> {creator}</div>}
          {route.created_at && (
            <div><b>Em:</b> {new Date(route.created_at).toLocaleString("pt-PT")}</div>
          )}
          {deliveryOnly && <div className="text-amber-500">Sem montagem</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
