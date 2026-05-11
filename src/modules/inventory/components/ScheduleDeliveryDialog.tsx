import { useState, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { CalendarDays, AlertTriangle, CheckCircle2, RotateCcw, MapPin } from "lucide-react";
import { toast } from "sonner";

type Picking = {
  id: string;
  origin?: string | null;
  scheduled_at?: string | null;
  route_id?: string | null;
};

export function ScheduleDeliveryDialog({
  picking,
  trigger,
  onChanged,
  open: controlledOpen,
  onOpenChange,
  pickupMode = false,
}: {
  picking: Picking;
  trigger?: ReactNode;
  onChanged?: () => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  pickupMode?: boolean;
}) {
  const qc = useQueryClient();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;

  const [fromDate, setFromDate] = useState<string>(
    (picking.scheduled_at ? new Date(picking.scheduled_at) : new Date()).toISOString().slice(0, 10)
  );
  const [busy, setBusy] = useState(false);

  const { data: so } = useQuery({
    queryKey: ["picking-so", picking.origin],
    enabled: !!picking.origin && open,
    queryFn: async () =>
      (await supabase.from("sale_orders").select("id,name").eq("name", picking.origin!).maybeSingle()).data,
  });

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["suggest-route", so?.id, fromDate],
    enabled: !!so?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_route", { _so: so!.id, _from_date: fromDate });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: currentRoute } = useQuery({
    queryKey: ["current-route", picking.route_id],
    enabled: !!picking.route_id && open,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("id,route_date,state,delivery_zones(name,color,zip_from,zip_to)")
        .eq("id", picking.route_id!)
        .maybeSingle()).data,
  });

  const { data: allRoutes = [] } = useQuery({
    queryKey: ["all-routes-upcoming", fromDate],
    enabled: open,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("id,route_date,delivery_zones(name,zip_from,zip_to)")
        .gte("route_date", fromDate)
        .in("state", ["planned", "in_progress"])
        .order("route_date")
        .limit(30)).data ?? [],
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
    qc.invalidateQueries({ queryKey: ["sale-shipment"] });
    qc.invalidateQueries({ queryKey: ["current-route"] });
    onChanged?.();
  };

  const assign = async (routeId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("schedule_picking_to_route", { _picking: picking.id, _route: routeId });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Entrega agendada");
    refreshAll();
    setOpen(false);
  };

  const unassign = async () => {
    setBusy(true);
    const { error } = await supabase.from("stock_pickings").update({ route_id: null }).eq("id", picking.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Agendamento removido");
    refreshAll();
    setOpen(false);
  };

  const fromSuggestions = (suggestions as any[]) ?? [];
  const hasSuggestions = fromSuggestions.length > 0;

  const savePickup = async () => {
    setBusy(true);
    const iso = new Date(`${fromDate}T12:00:00`).toISOString();
    const { error } = await supabase
      .from("stock_pickings")
      .update({ scheduled_at: iso, route_id: null })
      .eq("id", picking.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Levantamento agendado");
    refreshAll();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> {pickupMode ? (picking.scheduled_at ? "Alterar agendamento de levantamento" : "Agendar levantamento") : (picking.route_id ? "Trocar rota" : "Agendar entrega")}
          </DialogTitle>
          <DialogDescription>
            {pickupMode ? "Defina a data combinada com o cliente para o levantamento. Não é necessária rota." : "Escolha a data combinada com o cliente e selecione uma rota disponível."}
          </DialogDescription>
        </DialogHeader>

        {pickupMode ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Data combinada</Label>
              <Input type="date" value={fromDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFromDate(e.target.value)} className="h-9 max-w-[220px]" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={savePickup} disabled={busy}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirmar agendamento
              </Button>
            </div>
          </div>
        ) : (

        <div className="space-y-3">
          {currentRoute && (
            <div className="rounded-md border bg-muted/30 p-2 text-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(currentRoute as any).delivery_zones?.color && (
                  <span className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: (currentRoute as any).delivery_zones.color }} />
                )}
                <Link to={`/routes/${(currentRoute as any).id}`} className="text-primary hover:underline font-medium">
                  {(currentRoute as any).delivery_zones?.name ?? "Rota"} · {(currentRoute as any).route_date}
                </Link>
                <Badge variant="outline" className="capitalize">{(currentRoute as any).state}</Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={unassign} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Remover
              </Button>
            </div>
          )}

          <div className="grid sm:grid-cols-[200px_1fr] gap-3 items-end">
            <div>
              <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Data com cliente</Label>
              <Input type="date" value={fromDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFromDate(e.target.value)} className="h-9" />
            </div>
            <p className="text-xs text-muted-foreground">
              Mostramos as próximas rotas disponíveis para o código postal do cliente a partir desta data.
            </p>
          </div>

          {!so?.id ? (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Sem encomenda associada — escolha manualmente uma rota:</div>
              <Select disabled={busy} onValueChange={(v) => assign(v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar rota…" /></SelectTrigger>
                <SelectContent>
                  {(allRoutes as any[]).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.delivery_zones?.name} · {r.route_date} · CP {r.delivery_zones?.zip_from}–{r.delivery_zones?.zip_to}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : isFetching ? (
            <div className="text-xs text-muted-foreground">A procurar rotas…</div>
          ) : !hasSuggestions ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" /> Sem rotas para o código postal do cliente
              </div>
              <p className="text-xs mt-1">Crie uma zona em <Link to="/routes/zones" className="underline">Rotas → Zonas</Link> ou gere as rotas em <Link to="/routes" className="underline">Cronograma</Link>.</p>
            </div>
          ) : (
            <div className="grid gap-2 max-h-[50vh] overflow-y-auto">
              {fromSuggestions.map((r: any) => {
                const free = Math.max(0, r.max_deliveries - r.used_deliveries);
                const minFree = Math.max(0, r.max_assembly_minutes - Number(r.used_assembly_minutes ?? 0));
                return (
                  <div key={r.route_id} className={`rounded-md border p-2 flex items-center justify-between gap-2 ${r.would_exceed ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900" : "bg-card"}`}>
                    <div className="text-sm">
                      <div className="font-medium flex items-center gap-2">
                        {r.zone_name} · {r.route_date}
                        {r.would_exceed && <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">excede capacidade</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {free}/{r.max_deliveries} entregas livres · {minFree}/{r.max_assembly_minutes} min montagem livres
                      </div>
                    </div>
                    <Button size="sm" variant={picking.route_id === r.route_id ? "secondary" : "default"} disabled={busy} onClick={() => assign(r.route_id)}>
                      {picking.route_id === r.route_id ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Atribuída</> : "Atribuir"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
