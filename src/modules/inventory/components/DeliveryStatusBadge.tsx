import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarPlus, CalendarCheck2, CircleDashed, Truck, PackageCheck, X } from "lucide-react";
import { toast } from "sonner";
import { ScheduleDeliveryDialog } from "./ScheduleDeliveryDialog";

type Picking = {
  id: string;
  origin?: string | null;
  scheduled_at?: string | null;
  route_id?: string | null;
  state?: string | null;
};

export function DeliveryStatusBadge({
  picking,
  onChanged,
  showActions = true,
  compact = false,
}: {
  picking: Picking;
  onChanged?: () => void;
  showActions?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const isDone = picking.state === "done";
  const hasRoute = !!picking.route_id;

  const cancelPickup = async () => {
    const { error } = await supabase
      .from("stock_pickings")
      .update({ scheduled_at: null, route_id: null })
      .eq("id", picking.id);
    if (error) return toast.error(error.message);
    toast.success("Agendamento cancelado");
    qc.invalidateQueries({ queryKey: ["sale-shipment"] });
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
    onChanged?.();
  };

  const { data: so } = useQuery({
    queryKey: ["delivery-status-so", picking.origin],
    enabled: !!picking.origin,
    queryFn: async () =>
      (await supabase.from("sale_orders").select("id,name,include_delivery").eq("name", picking.origin!).maybeSingle()).data,
  });
  const isPickup = !!so && !so.include_delivery;

  const { data: route } = useQuery({
    queryKey: ["delivery-status-route", picking.route_id],
    enabled: hasRoute && !isPickup,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("id,route_date,state,delivery_zones(name,color)")
        .eq("id", picking.route_id!)
        .maybeSingle()).data,
  });

  const zone = (route as any)?.delivery_zones;
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-PT") : "");

  // ---- PICKUP (Levantamento) ----
  if (isPickup) {
    if (compact) {
      if (isDone) return <Badge variant="outline" className="gap-1"><PackageCheck className="h-3 w-3" /> Levantado</Badge>;
      if (!picking.scheduled_at) return <Badge variant="outline" className="gap-1 text-muted-foreground"><CircleDashed className="h-3 w-3" /> Sem agendamento</Badge>;
      return (
        <Badge variant="outline" className="gap-1 border-violet-500/40 text-violet-700 dark:text-violet-300">
          <CalendarCheck2 className="h-3 w-3" /> Confirmado agendamento · {fmtDate(picking.scheduled_at)}
        </Badge>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {isDone ? (
          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
            <PackageCheck className="h-3 w-3" /> Levantado
          </Badge>
        ) : !picking.scheduled_at ? (
          <>
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <CircleDashed className="h-3 w-3" /> Levantamento sem agendamento
            </Badge>
            {showActions && (
              <ScheduleDeliveryDialog
                picking={picking}
                onChanged={onChanged}
                pickupMode
                trigger={
                  <Button size="sm" variant="default" className="h-8">
                    <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Agendar levantamento
                  </Button>
                }
              />
            )}
          </>
        ) : (
          <>
            <Badge variant="outline" className="gap-1 border-violet-500/40 text-violet-700 dark:text-violet-300">
              <CalendarCheck2 className="h-3 w-3" /> Confirmado agendamento · {fmtDate(picking.scheduled_at)}
            </Badge>
            {showActions && (
              <>
                <ScheduleDeliveryDialog
                  picking={picking}
                  onChanged={onChanged}
                  pickupMode
                  trigger={
                    <Button size="sm" variant="outline" className="h-8">
                      Alterar data
                    </Button>
                  }
                />
                <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={cancelPickup}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancelar agendamento
                </Button>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ---- DELIVERY (Entrega com rota) ----
  if (compact) {
    if (isDone) return <Badge variant="outline" className="gap-1"><Truck className="h-3 w-3" /> Entregue</Badge>;
    if (!hasRoute) return <Badge variant="outline" className="gap-1 text-muted-foreground"><CircleDashed className="h-3 w-3" /> Não agendada</Badge>;
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
        {zone?.color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: zone.color }} />}
        <CalendarCheck2 className="h-3 w-3" /> Agendada
        {(route as any)?.route_date && <span className="ml-1">· {(route as any).route_date}</span>}
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {isDone ? (
        <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
          <Truck className="h-3 w-3" /> Entregue
        </Badge>
      ) : !hasRoute ? (
        <>
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <CircleDashed className="h-3 w-3" /> Entrega não agendada
          </Badge>
          {showActions && (
            <ScheduleDeliveryDialog
              picking={picking}
              onChanged={onChanged}
              trigger={
                <Button size="sm" variant="default" className="h-8">
                  <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Agendar entrega
                </Button>
              }
            />
          )}
        </>
      ) : (
        <>
          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
            <CalendarCheck2 className="h-3 w-3" /> Entrega agendada
          </Badge>
          {route && (
            <Link to={`/routes/${(route as any).id}`} className="flex items-center gap-1 text-sm hover:underline">
              {zone?.color && <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: zone.color }} />}
              <span className="font-medium">{zone?.name ?? "Rota"}</span>
              <span className="text-muted-foreground">· {(route as any).route_date}</span>
            </Link>
          )}
          {showActions && (
            <ScheduleDeliveryDialog
              picking={picking}
              onChanged={onChanged}
              trigger={
                <Button size="sm" variant="outline" className="h-8">
                  Trocar rota
                </Button>
              }
            />
          )}
        </>
      )}
    </div>
  );
}
