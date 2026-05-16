import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callM5Rpc } from "../lib/m5Rpc";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scheduleId: string;
  currentDate?: string;
  saleOrderName?: string;
  onDone?: () => void;
}

// UI M5 — reschedule. Apenas chama delivery_schedule_reschedule.
// Mostra avisos de stock na viatura / damaged. Backend é a fonte da verdade — apenas traduz erros.
export function RescheduleDialog(p: Props) {
  const [newDate, setNewDate] = useState<string>(p.currentDate ?? "");
  const [newRouteId, setNewRouteId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const { data: routes = [] } = useQuery({
    queryKey: ["routes-for-reschedule", newDate],
    enabled: p.open,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("id, route_date, state, delivery_zones(name)")
        .in("state", ["planning", "planned"])
        .order("route_date", { ascending: false })
        .limit(40)).data ?? [],
  });

  // Pre-check: status dos packages via vehicle_route_manifest do schedule
  const { data: precheck } = useQuery({
    queryKey: ["reschedule-precheck", p.scheduleId],
    enabled: p.open && !!p.scheduleId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("vehicle_route_manifest")
        .select("id, damaged, qty_pending, stock_packages(status, locations:current_location_id(usage,code)), delivery_route_orders!inner(schedule_id)")
        .eq("delivery_route_orders.schedule_id", p.scheduleId);
      const list = (data as any[]) ?? [];
      return {
        onVehicle: list.filter((x) => Number(x.qty_pending ?? 0) > 0 && (x.stock_packages?.locations?.usage === "vehicle" || (x.stock_packages?.locations?.code ?? "").startsWith("VEHICLE/"))).length,
        damaged: list.filter((x) => x.damaged || ["damaged", "quarantine"].includes(x.stock_packages?.status)).length,
        total: list.length,
      };
    },
  });

  async function submit() {
    setBusy(true);
    const res = await callM5Rpc(
      "delivery_schedule_reschedule",
      {
        _schedule_id: p.scheduleId,
        _new_date: newDate,
        _new_route_id: newRouteId || null,
        _reason: reason || null,
      },
      "Reagendar",
    );
    setBusy(false);
    if (res.ok) {
      p.onDone?.();
      p.onOpenChange(false);
    }
  }

  const hasBlocker = (precheck?.onVehicle ?? 0) > 0 || (precheck?.damaged ?? 0) > 0;

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reagendar entrega {p.saleOrderName ? `— ${p.saleOrderName}` : ""}</DialogTitle>
        </DialogHeader>

        {precheck && (
          <div className="text-xs space-y-1">
            <div>Packages: <strong>{precheck.total}</strong></div>
            {precheck.onVehicle > 0 && (
              <div className="text-rose-700" data-testid="alert-on-vehicle">
                ⚠ {precheck.onVehicle} package(s) ainda na viatura — retorne ao armazém antes de reagendar.
              </div>
            )}
            {precheck.damaged > 0 && (
              <div className="text-rose-700" data-testid="alert-damaged">
                ⚠ {precheck.damaged} package(s) damaged/quarantine — bloqueia reagendamento.
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div>
            <Label>Nova data</Label>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="new-date" />
          </div>
          <div>
            <Label>Nova rota (opcional)</Label>
            <Select value={newRouteId} onValueChange={setNewRouteId}>
              <SelectTrigger><SelectValue placeholder="(criar/atribuir depois)" /></SelectTrigger>
              <SelectContent>
                {(routes as any[]).map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.route_date} · {r.delivery_zones?.name ?? r.id.slice(0, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Motivo</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !newDate || hasBlocker} data-testid="reschedule-submit">
            {busy ? "…" : "Reagendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
