import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarPlus, CalendarCheck2, CircleDashed, Truck } from "lucide-react";
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
  const isDone = picking.state === "done";
  const hasRoute = !!picking.route_id;

  const { data: route } = useQuery({
    queryKey: ["delivery-status-route", picking.route_id],
    enabled: hasRoute,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("id,route_date,state,delivery_zones(name,color)")
        .eq("id", picking.route_id!)
        .maybeSingle()).data,
  });

  const zone = (route as any)?.delivery_zones;

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
