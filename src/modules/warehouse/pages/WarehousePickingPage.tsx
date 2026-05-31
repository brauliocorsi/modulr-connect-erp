/**
 * F29 Bloco 5 — Separação em Armazém (D-1)
 * Rota: /warehouse/picking
 * Lista as rotas do dia seguinte, permite verificar o picking de cada paragem
 * e marcar a carga no veículo via RPC delivery_load_vehicle.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Truck, Package, ChevronDown, ChevronRight, MapPin, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { toast } from "sonner";

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const PICKING_STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-sky-100 text-sky-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-rose-100 text-rose-800",
};

export default function WarehousePickingPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(tomorrowISO());
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ["warehouse-picking-routes", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_routes")
        .select(`
          id, route_date, state,
          driver:hr_employees!delivery_routes_driver_id_fkey(full_name),
          vehicle:vehicles(name, license_plate),
          zone:delivery_zones(name, color),
          orders:delivery_route_orders(
            id, sequence, status, loaded_at,
            schedule:delivery_schedules(
              id, physical_state,
              sale_order:sale_orders(id, name, partner:partners(name))
            )
          )
        `)
        .eq("route_date", date)
        .in("state", ["planned", "in_progress"])
        .order("route_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title="Separação em Armazém (D-1)"
        breadcrumb={[{ label: "Armazém" }, { label: "Separação" }]}
        actions={
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs">Data das rotas</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-[180px]"
              />
            </div>
          </div>
        }
      />
      <PageBody>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">A carregar rotas…</div>
        ) : routes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Sem rotas planeadas para {date}.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {routes.map((r) => (
              <RouteCard
                key={r.id}
                route={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onChanged={() => qc.invalidateQueries({ queryKey: ["warehouse-picking-routes", date] })}
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

function RouteCard({
  route,
  expanded,
  onToggle,
  onChanged,
}: {
  route: any;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const orders = (route.orders ?? []) as any[];
  const total = orders.length;
  const ready = orders.filter(
    (o) => ["picked", "ready", "loaded", "in_truck"].includes(o.schedule?.physical_state ?? ""),
  ).length;
  const loaded = orders.filter((o) => !!o.loaded_at).length;
  const pct = total ? Math.round((ready / total) * 100) : 0;

  const allReady = total > 0 && ready === total;
  const allLoaded = total > 0 && loaded === total;

  const loadMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("delivery_load_vehicle", { _route_id: route.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Carga confirmada no veículo.");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao carregar veículo"),
  });

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {route.zone?.color && (
              <span
                className="inline-block h-3 w-3 rounded-full border"
                style={{ backgroundColor: route.zone.color }}
              />
            )}
            <CardTitle className="text-base">
              {route.zone?.name ?? "Rota"} · {route.route_date}
            </CardTitle>
            <Badge variant="outline" className="capitalize">{route.state}</Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Truck className="h-3.5 w-3.5" /> {route.driver?.full_name ?? "—"}
            </span>
            <span>{route.vehicle?.license_plate ?? route.vehicle?.name ?? "—"}</span>
            <span>{total} entregas</span>
          </div>
        </div>
        <div className="mt-2 grid sm:grid-cols-[1fr_auto] items-center gap-3">
          <Progress value={pct} className="h-2" />
          <div className="text-xs text-muted-foreground tabular-nums">
            {ready}/{total} separadas · {loaded}/{total} carregadas
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          {orders.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem paragens nesta rota.</div>
          ) : (
            orders
              .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
              .map((o) => <StopBlock key={o.id} order={o} onChanged={onChanged} />)
          )}
          <div className="flex items-center justify-between pt-3 border-t">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {allReady ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Todos os produtos separados.</>
              ) : (
                <><AlertCircle className="h-3.5 w-3.5 text-amber-600" /> Faltam {total - ready} paragens.</>
              )}
            </div>
            <Button
              size="sm"
              disabled={!allReady || allLoaded || loadMut.isPending}
              onClick={() => loadMut.mutate()}
            >
              <Truck className="h-4 w-4 mr-1" />
              {allLoaded ? "Carga confirmada" : loadMut.isPending ? "A carregar…" : "Confirmar Carga no Veículo"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function StopBlock({ order, onChanged }: { order: any; onChanged: () => void }) {
  const so = order.schedule?.sale_order;
  const phys = order.schedule?.physical_state ?? "pending";

  const { data: pickings = [] } = useQuery({
    queryKey: ["stop-pickings", so?.name, so?.id],
    enabled: !!so?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_pickings")
        .select(`
          id, name, state, kind, scheduled_at,
          moves:stock_moves(
            id, quantity, quantity_done, reserved_quantity, state,
            product:products(id, name, default_code),
            source_location:stock_locations!stock_moves_source_location_id_fkey(name, code)
          )
        `)
        .eq("origin", so.name)
        .eq("kind", "outgoing")
        .neq("state", "cancelled");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const validateMut = useMutation({
    mutationFn: async (pickingId: string) => {
      const { error } = await supabase.rpc("validate_picking", { _picking: pickingId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Separação validada.");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao validar separação"),
  });

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          #{order.sequence ?? "—"} · {so?.name ?? "—"}
          <span className="text-muted-foreground font-normal">{so?.partner?.name ?? ""}</span>
        </div>
        <Badge className={`capitalize ${PICKING_STATE_TONE[phys] ?? ""}`} variant="outline">
          {phys}
        </Badge>
      </div>

      {pickings.length === 0 ? (
        <div className="text-xs text-muted-foreground">Sem picking gerado para esta venda.</div>
      ) : (
        pickings.map((p: any) => {
          const moves = (p.moves ?? []) as any[];
          const allDone = moves.length > 0 && moves.every((m) => Number(m.quantity_done ?? 0) >= Number(m.quantity ?? 0));
          return (
            <div key={p.id} className="rounded border bg-card p-2 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  <Package className="h-3 w-3 inline mr-1" /> {p.name}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`capitalize ${PICKING_STATE_TONE[p.state] ?? ""}`}>
                    {p.state}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={p.state === "done" || !allDone || validateMut.isPending}
                    onClick={() => validateMut.mutate(p.id)}
                  >
                    {p.state === "done" ? "Validado" : "Validar separação"}
                  </Button>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1 w-8"></th>
                    <th className="text-left py-1">Produto</th>
                    <th className="text-left py-1">Localização</th>
                    <th className="text-right py-1">Qtd</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m: any) => (
                    <PickRow key={m.id} move={m} pickingId={p.id} onChanged={onChanged} />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}

function PickRow({ move, pickingId, onChanged }: { move: any; pickingId: string; onChanged: () => void }) {
  const qty = Number(move.quantity ?? 0);
  const done = Number(move.quantity_done ?? 0);
  const isDone = done >= qty && qty > 0;

  const toggleMut = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("stock_moves")
        .update({ quantity_done: next ? qty : 0 })
        .eq("id", move.id);
      if (error) throw error;
    },
    onSuccess: () => onChanged(),
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar separação"),
  });

  return (
    <tr className="border-t">
      <td className="py-1.5">
        <Checkbox
          checked={isDone}
          disabled={toggleMut.isPending}
          onCheckedChange={(v) => toggleMut.mutate(!!v)}
        />
      </td>
      <td className="py-1.5">
        <div className="font-medium">{move.product?.name ?? "—"}</div>
        {move.product?.default_code && (
          <div className="text-[10px] text-muted-foreground">{move.product.default_code}</div>
        )}
      </td>
      <td className="py-1.5 text-muted-foreground">
        {move.source_location?.code ?? move.source_location?.name ?? "—"}
      </td>
      <td className="py-1.5 text-right tabular-nums">
        <span className={isDone ? "text-emerald-700 font-medium" : ""}>
          {done}/{qty}
        </span>
      </td>
    </tr>
  );
}
