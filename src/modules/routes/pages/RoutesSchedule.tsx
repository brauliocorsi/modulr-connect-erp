import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, MapPin, Truck, User2 } from "lucide-react";
import { toast } from "sonner";

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function RoutesSchedule() {
  const qc = useQueryClient();
  const [days] = useState(15);
  const today = useMemo(() => new Date(new Date().toDateString()), []);
  const horizonDates = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(today, i)),
    [today, days]
  );
  const fromDate = fmtDate(today);
  const toDate = fmtDate(addDays(today, days - 1));

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
          "id,zone_id,route_date,state,max_deliveries,max_assembly_minutes,driver_id,vehicle_id,vehicles(name,license_plate)"
        )
        .gte("route_date", fromDate)
        .lte("route_date", toDate)
        .order("route_date")).data ?? [],
  });

  // count pickings per route
  const routeIds = (routes as any[]).map((r) => r.id);
  const { data: pickCounts = {} } = useQuery({
    queryKey: ["routes-pickings-count", routeIds.join(",")],
    enabled: routeIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id,route_id,state")
        .in("route_id", routeIds)
        .neq("state", "cancelled");
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        map[p.route_id] = (map[p.route_id] ?? 0) + 1;
      });
      return map;
    },
  });

  const byZoneDate: Record<string, Record<string, any>> = {};
  (routes as any[]).forEach((r) => {
    byZoneDate[r.zone_id] = byZoneDate[r.zone_id] ?? {};
    byZoneDate[r.zone_id][r.route_date] = r;
  });

  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_routes", { _horizon_days: days });
    if (error) return toast.error(error.message);
    toast.success(`Geradas ${data ?? 0} rotas`);
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

  return (
    <>
      <PageHeader
        title="Cronograma de Rotas"
        breadcrumb={[{ label: "Rotas" }]}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link to="/routes/zones">
                <MapPin className="h-4 w-4 mr-1" /> Zonas
              </Link>
            </Button>
            <Button size="sm" onClick={generate}>
              <CalendarPlus className="h-4 w-4 mr-1" /> Gerar próximos {days} dias
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
        ) : (
          <Card className="overflow-auto">
            <div className="min-w-max">
              <div
                className="grid sticky top-0 bg-card border-b z-10"
                style={{ gridTemplateColumns: `220px repeat(${days}, 140px)` }}
              >
                <div className="p-2 text-xs font-medium text-muted-foreground">Zona</div>
                {horizonDates.map((d) => (
                  <div key={d.toISOString()} className="p-2 text-center border-l">
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
                  style={{ gridTemplateColumns: `220px repeat(${days}, 140px)` }}
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
                  {horizonDates.map((d) => {
                    const key = fmtDate(d);
                    const r = byZoneDate[z.id]?.[key];
                    return (
                      <div key={key} className="border-l p-1 min-h-[68px]">
                        {r ? (
                          <Link
                            to={`/routes/${r.id}`}
                            className="block rounded border bg-card hover:bg-accent p-1.5 h-full"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 capitalize"
                              >
                                {r.state}
                              </Badge>
                              <span className="text-[11px] font-semibold">
                                {pickCounts[r.id] ?? 0}/{r.max_deliveries}
                              </span>
                            </div>
                            {r.vehicles && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Truck className="h-2.5 w-2.5" />
                                {r.vehicles.name}
                              </div>
                            )}
                            {r.driver_id && (
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <User2 className="h-2.5 w-2.5" />
                                Atribuído
                              </div>
                            )}
                          </Link>
                        ) : (
                          <div className="text-[10px] text-muted-foreground/40 text-center mt-3">
                            —
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
