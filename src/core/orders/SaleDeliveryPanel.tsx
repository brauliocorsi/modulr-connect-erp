import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, MapPin, PackageCheck, CalendarClock, ExternalLink, CircleDashed } from "lucide-react";
import { useRealtimeInvalidate } from "@/core/realtime";
import { LastUpdated } from "@/core/operational/LastUpdated";

type Shipment = {
  id: string;
  name: string;
  state: string | null;
  scheduled_at: string | null;
  done_at: string | null;
  tracking_ref: string | null;
  route_id: string | null;
  origin: string | null;
  vehicles: { id: string; name: string; license_plate: string | null } | null;
  delivery_carriers: { id: string; name: string } | null;
  delivery_routes:
    | { id: string; route_date: string | null; state: string | null; delivery_zones: { name: string; color: string | null } | null }
    | null;
};

const PICK_STATE_TONE: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  waiting: { label: "Sem stock", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  partially_available: { label: "Parcial", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  ready: { label: "Reservado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  done: { label: "Concluído", cls: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300" },
  cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground line-through" },
};

export function SaleDeliveryPanel({ saleOrderName, saleOrderId, commitmentDate }: {
  saleOrderName: string;
  saleOrderId: string;
  commitmentDate?: string | null;
}) {
  const qc = useQueryClient();

  const { data, dataUpdatedAt, isLoading } = useQuery({
    enabled: !!saleOrderName && saleOrderName !== "Rascunho",
    queryKey: ["sale-delivery-panel", saleOrderName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_pickings")
        .select(`
          id, name, state, scheduled_at, done_at, tracking_ref, route_id, origin,
          vehicles(id, name, license_plate),
          delivery_carriers(id, name),
          delivery_routes(id, route_date, state, delivery_zones(name, color))
        `)
        .eq("kind", "outgoing")
        .eq("origin", saleOrderName)
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as unknown as Shipment[];
      const pending = list.find((p) => !["done", "cancelled"].includes(p.state ?? ""));
      return pending ?? list[0] ?? null;
    },
  });

  useRealtimeInvalidate({
    channel: `sale-delivery-${saleOrderId}`,
    filters: [
      { event: "*", schema: "public", table: "stock_pickings", filter: `origin=eq.${saleOrderName}` },
      { event: "*", schema: "public", table: "delivery_routes" },
    ],
    queryKeys: [["sale-delivery-panel", saleOrderName]],
    debounceMs: 300,
    enabled: !!saleOrderName && saleOrderName !== "Rascunho",
  });

  if (isLoading) {
    return (
      <Card className="p-3 text-xs text-muted-foreground">Carregando informação de entrega…</Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-3 flex flex-wrap items-center gap-2 text-sm">
        <CircleDashed className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Sem transferência de saída ainda. Será criada ao confirmar a venda.</span>
      </Card>
    );
  }

  const tone = PICK_STATE_TONE[data.state ?? ""] ?? PICK_STATE_TONE.draft;
  const zone = data.delivery_routes?.delivery_zones;
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-PT") : "—");
  const fmtDt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-PT") : "—");

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
        <Truck className="h-4 w-4 text-primary" />
        <span className="font-medium text-sm">Entrega</span>
        <Badge variant="outline" className={`text-[10px] ${tone.cls}`}>{tone.label}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <LastUpdated value={dataUpdatedAt ? new Date(dataUpdatedAt) : null} />
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to={`/inventory/transfers/${data.id}`}>
              <ExternalLink className="h-3 w-3 mr-1" /> Abrir transferência
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-sm">
        {/* Data */}
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <CalendarClock className="h-3 w-3" /> Prevista
          </div>
          <div className="font-medium">
            {data.scheduled_at ? fmtDate(data.scheduled_at) : commitmentDate ? fmtDate(commitmentDate) : "—"}
          </div>
          {data.done_at && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">Concluída {fmtDt(data.done_at)}</div>
          )}
        </div>

        {/* Rota */}
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Rota
          </div>
          {data.route_id ? (
            <Link to={`/routes/${data.route_id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
              {zone?.color && (
                <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: zone.color }} />
              )}
              <span className="truncate">{zone?.name ?? "Rota"}</span>
              {data.delivery_routes?.route_date && (
                <span className="text-xs text-muted-foreground">· {fmtDate(data.delivery_routes.route_date)}</span>
              )}
            </Link>
          ) : (
            <span className="text-muted-foreground">Não atribuída</span>
          )}
        </div>

        {/* Carrinha */}
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Truck className="h-3 w-3" /> Carrinha
          </div>
          {data.vehicles ? (
            <div className="font-medium truncate">
              {data.vehicles.name}
              {data.vehicles.license_plate && (
                <span className="ml-1 text-xs text-muted-foreground">· {data.vehicles.license_plate}</span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">Não atribuída</span>
          )}
        </div>

        {/* Carrier / tracking */}
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <PackageCheck className="h-3 w-3" /> Transportadora
          </div>
          {data.delivery_carriers ? (
            <div className="font-medium truncate">{data.delivery_carriers.name}</div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {data.tracking_ref && (
            <div className="text-[11px] text-muted-foreground truncate">Tracking: {data.tracking_ref}</div>
          )}
        </div>
      </div>
    </Card>
  );
}
