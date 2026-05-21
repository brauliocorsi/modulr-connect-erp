import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, AlertTriangle, CheckCircle2, MapPin, Sparkles, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  resolveRouteCapacityStatus,
  suggestDeliveryDays,
  type RouteCapacityStatus,
  type RouteRow,
} from "@/modules/sales/lib/deliverySchedule";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  saleOrderId: string;
  /** preferred date (yyyy-mm-dd) used as anchor for suggestions */
  preferredDate?: string | null;
  onScheduled?: (scheduleId: string) => void;
};

const STATUS_TONE: Record<RouteCapacityStatus, string> = {
  available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  tight: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  saturated: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  unknown: "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<RouteCapacityStatus, string> = {
  available: "Livre",
  tight: "Atenção",
  saturated: "Saturado",
  unknown: "—",
};

export function ScheduleSaleOrderDeliveryDialog({ open, onOpenChange, saleOrderId, preferredDate, onScheduled }: Props) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(preferredDate ?? today);
  const [routeId, setRouteId] = useState<string>("");
  const [slotStart, setSlotStart] = useState<string>("");
  const [slotEnd, setSlotEnd] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmSaturated, setConfirmSaturated] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(preferredDate ?? today);
      setRouteId("");
      setSlotStart("");
      setSlotEnd("");
      setNotes("");
      setConfirmSaturated(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleOrderId]);

  const { data: so } = useQuery({
    enabled: open && !!saleOrderId,
    queryKey: ["schedule-dialog-so", saleOrderId],
    queryFn: async () => (await supabase
      .from("sale_orders")
      .select("id,name,state,delivery_mode,include_delivery,commitment_date,delivery_zone_label,partner_id,partners(name,zip)")
      .eq("id", saleOrderId)
      .maybeSingle()).data,
  });

  const { data: existingSchedule } = useQuery({
    enabled: open && !!saleOrderId,
    queryKey: ["schedule-dialog-existing", saleOrderId],
    queryFn: async () => (await supabase
      .from("delivery_schedules")
      .select("id,scheduled_date,slot_start,slot_end,route_id,status")
      .eq("sale_order_id", saleOrderId)
      .not("status", "in", "(cancelled,delivered,rescheduled)")
      .maybeSingle()).data,
  });

  useEffect(() => {
    if (existingSchedule && open) {
      setDate(String(existingSchedule.scheduled_date).slice(0, 10));
      setRouteId(existingSchedule.route_id ?? "");
      setSlotStart(existingSchedule.slot_start ? String(existingSchedule.slot_start).slice(0, 5) : "");
      setSlotEnd(existingSchedule.slot_end ? String(existingSchedule.slot_end).slice(0, 5) : "");
    }
  }, [existingSchedule, open]);

  const fromDate = useMemo(() => {
    const d = new Date(date + "T00:00:00");
    const start = new Date(d);
    start.setDate(start.getDate() - 3);
    const end = new Date(d);
    end.setDate(end.getDate() + 21);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }, [date]);

  const { data: routes = [] } = useQuery<RouteRow[]>({
    enabled: open,
    queryKey: ["schedule-dialog-routes", fromDate.start, fromDate.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_routes")
        .select(`
          id, route_date, state, zone_id,
          cap_deliveries, cap_volume_m3, cap_assembly_minutes,
          current_deliveries, current_volume_m3, current_assembly_minutes,
          delivery_zones(id, name, color, zip_from, zip_to),
          vehicles(id, name, license_plate, usable_volume_m3, volume_m3, assembly_minutes_capacity, max_stops)
        `)
        .gte("route_date", fromDate.start)
        .lte("route_date", fromDate.end)
        .in("state", ["draft", "planned", "in_progress"]);
      if (error) throw error;
      return (data ?? []) as unknown as RouteRow[];
    },
  });

  const postalCode = (so as any)?.partners?.zip ?? null;

  const suggestions = useMemo(
    () => suggestDeliveryDays({ postalCode, fromDate: date, routes, limit: 6 }),
    [postalCode, date, routes]
  );

  const routesOnDate = useMemo(() => routes.filter((r) => r.route_date === date), [routes, date]);
  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === routeId) ?? null,
    [routes, routeId]
  );
  const capacity = useMemo(() => resolveRouteCapacityStatus(selectedRoute as any), [selectedRoute]);

  const pickup = (so as any)?.delivery_mode === "pickup";
  const noDelivery = (so as any)?.include_delivery === false;
  const locked = (so as any)?.state === "cancelled" || (so as any)?.state === "done";
  const isReschedule = !!existingSchedule;

  const submit = async () => {
    if (!date) return toast.error("Escolha uma data.");
    if (slotStart && slotEnd && slotEnd <= slotStart) return toast.error("Janela horária inválida.");
    if (capacity.status === "saturated" && !confirmSaturated) {
      return toast.error("A rota está saturada. Marque a confirmação para prosseguir.");
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("sale_order_schedule_delivery", {
      _sale_order_id: saleOrderId,
      _scheduled_date: date,
      _slot_start: slotStart || null,
      _slot_end: slotEnd || null,
      _route_id: routeId || null,
      _notes: notes || null,
    });
    setBusy(false);
    if (error) {
      const map: Record<string, string> = {
        pickup_cannot_schedule_delivery: "Esta venda está em modo Levantamento.",
        delivery_not_included: "A venda não inclui entrega.",
        sale_order_cancelled: "Venda cancelada.",
        sale_order_done: "Venda já concluída.",
        invalid_slot_window: "Janela horária inválida.",
        route_date_mismatch: "A rota selecionada é de outra data.",
        route_not_open: "A rota selecionada não está aberta.",
        route_not_found: "Rota não encontrada.",
        forbidden: "Sem permissão para agendar.",
      };
      return toast.error(map[error.message] ?? error.message);
    }
    const payload = (data as any) ?? {};
    if (payload.warnings && Array.isArray(payload.warnings) && payload.warnings.length) {
      toast.warning(`Agendado com avisos: ${payload.warnings.join(", ")}`);
    } else {
      toast.success(isReschedule ? "Entrega reagendada" : "Entrega agendada");
    }
    qc.invalidateQueries({ queryKey: ["delivery-schedule-schedules"] });
    qc.invalidateQueries({ queryKey: ["delivery-schedule-routes"] });
    qc.invalidateQueries({ queryKey: ["sale-delivery-panel"] });
    qc.invalidateQueries({ queryKey: ["schedule-dialog-existing", saleOrderId] });
    onScheduled?.(payload.schedule_id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {isReschedule ? "Reagendar entrega" : "Agendar entrega"}
          </DialogTitle>
          <DialogDescription>
            {so ? (
              <span className="text-xs">
                {(so as any).name} · {(so as any).partners?.name ?? "Cliente"}
                {postalCode ? ` · CP ${postalCode}` : ""}
                {(so as any).delivery_zone_label ? ` · ${(so as any).delivery_zone_label}` : ""}
              </span>
            ) : (
              "A carregar…"
            )}
          </DialogDescription>
        </DialogHeader>

        {pickup ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700" />
            <div>Esta venda está como <b>Levantamento</b>. Para agendar entrega, altere o modo para Entrega no pedido.</div>
          </div>
        ) : noDelivery ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700" />
            <div>A venda <b>não inclui entrega</b>. Active o serviço de entrega no pedido.</div>
          </div>
        ) : locked ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-rose-700" />
            <div>A venda está {(so as any)?.state === "cancelled" ? "cancelada" : "concluída"} e não pode ser agendada.</div>
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.length > 0 && (
              <div className="rounded-md border border-emerald-200/60 dark:border-emerald-900/40 p-2">
                <div className="text-xs font-medium flex items-center gap-1 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600" /> Sugestões para o CP do cliente
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.date}-${s.route_id}`}
                      type="button"
                      className={`text-[11px] rounded border px-2 py-1 hover:bg-accent text-left ${date === s.date && routeId === s.route_id ? "ring-1 ring-primary" : ""}`}
                      onClick={() => { setDate(s.date); setRouteId(s.route_id); }}
                    >
                      <div className="font-medium">{new Date(s.date).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" })}</div>
                      <div className="text-muted-foreground">{s.zone_name}{s.capacity_remaining_m3 != null ? ` · ${s.capacity_remaining_m3.toFixed(1)} m³ livres` : ""}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 items-end">
              <div>
                <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Data</Label>
                <Input type="date" value={date} min={today} onChange={(e) => { setDate(e.target.value); setRouteId(""); }} className="h-9" />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Rota</Label>
                <Select value={routeId || "none"} onValueChange={(v) => setRouteId(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Sem rota (opcional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem rota</SelectItem>
                    {routesOnDate.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.delivery_zones?.name ?? "Rota"} · {r.vehicles?.name ?? "—"}
                      </SelectItem>
                    ))}
                    {routesOnDate.length === 0 && <SelectItem value="__empty__" disabled>Sem rotas neste dia</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Janela início</Label>
                <Input type="time" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Janela fim</Label>
                <Input type="time" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} className="h-9" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Indicações para o motorista…" className="h-9" />
            </div>

            <div className="rounded-md border bg-muted/30 p-2 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Capacidade da rota</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STATUS_TONE[capacity.status]}>{STATUS_LABEL[capacity.status]}</Badge>
                <span className="text-muted-foreground">{capacity.reason}</span>
              </div>
            </div>

            {capacity.status === "saturated" && (
              <label className="flex items-start gap-2 text-xs rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-900 p-2 cursor-pointer">
                <input type="checkbox" checked={confirmSaturated} onChange={(e) => setConfirmSaturated(e.target.checked)} className="mt-0.5" />
                <span><b>Forçar agendamento</b> mesmo com a rota saturada. Será registrado como aviso.</span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || pickup || noDelivery || locked}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {isReschedule ? "Reagendar" : "Confirmar agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
