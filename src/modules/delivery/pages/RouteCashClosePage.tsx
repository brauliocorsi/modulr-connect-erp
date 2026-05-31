/**
 * F29 Bloco 2 — Fecho de Caixa do Entregador
 * Rota: /delivery/routes/:routeId/cash-close
 * Duas fases: Resumo da rota → Form com cálculo de variância em tempo real.
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { ArrowLeft, Printer, AlertTriangle, CheckCircle2 } from "lucide-react";

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

type RouteData = {
  id: string; route_date: string; state: string; notes: string | null;
  driver_id: string | null; helper_id: string | null; vehicle_id: string | null;
  driver: { full_name: string } | null;
  vehicle: { name: string | null; license_plate: string | null } | null;
  zone: { name: string } | null;
};

type Closure = {
  id: string; route_id: string;
  expected_cash: number; actual_cash: number;
  expected_mbway: number; actual_mbway: number;
  expected_transfer: number; actual_transfer: number;
  expected_other: number; actual_other: number;
  variance: number; notes: string | null;
  closed_at: string | null; reconciled_at: string | null;
};

type RouteOrder = {
  id: string; sequence: number; status: string;
  schedule: {
    id: string;
    sale_order: { id: string; name: string; partner: { name: string } | null } | null;
  } | null;
};

export default function RouteCashClosePage() {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<1 | 2>(1);
  const [actuals, setActuals] = useState({ cash: 0, mbway: 0, transfer: 0, other: 0 });
  const [notes, setNotes] = useState("");

  const routeQ = useQuery({
    queryKey: ["route-cc-route", routeId],
    enabled: !!routeId,
    queryFn: async (): Promise<RouteData | null> => {
      const { data, error } = await supabase
        .from("delivery_routes")
        .select("id,route_date,state,notes,driver_id,helper_id,vehicle_id,driver:hr_employees!delivery_routes_driver_id_fkey(full_name),vehicle:vehicles(name,license_plate),zone:delivery_zones(name)")
        .eq("id", routeId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as RouteData | null;
    },
  });

  const ordersQ = useQuery({
    queryKey: ["route-cc-orders", routeId],
    enabled: !!routeId,
    queryFn: async (): Promise<RouteOrder[]> => {
      const { data, error } = await supabase
        .from("delivery_route_orders")
        .select("id,sequence,status,schedule:delivery_schedules(id,sale_order:sale_orders(id,name,partner:partners(name)))")
        .eq("route_id", routeId!)
        .order("sequence", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RouteOrder[];
    },
  });

  const closureQ = useQuery({
    queryKey: ["route-cc-closure", routeId],
    enabled: !!routeId,
    queryFn: async (): Promise<Closure | null> => {
      const { data, error } = await supabase
        .from("delivery_route_cash_closure")
        .select("*")
        .eq("route_id", routeId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Closure | null;
    },
  });

  const expected = useMemo(() => ({
    cash: Number(closureQ.data?.expected_cash ?? 0),
    mbway: Number(closureQ.data?.expected_mbway ?? 0),
    transfer: Number(closureQ.data?.expected_transfer ?? 0),
    other: Number(closureQ.data?.expected_other ?? 0),
  }), [closureQ.data]);

  const expectedTotal = expected.cash + expected.mbway + expected.transfer + expected.other;
  const actualTotal = actuals.cash + actuals.mbway + actuals.transfer + actuals.other;
  const variance = actualTotal - expectedTotal;
  const hasVariance = Math.abs(variance) > 0.001;

  const closeMut = useMutation({
    mutationFn: async () => {
      if (hasVariance && !notes.trim()) {
        throw new Error("Notas obrigatórias quando há variância.");
      }
      const { data, error } = await supabase.rpc("delivery_route_cash_close", {
        _route_id: routeId!,
        _actuals: {
          actual_cash: actuals.cash,
          actual_mbway: actuals.mbway,
          actual_transfer: actuals.transfer,
          actual_other: actuals.other,
        },
        _notes: notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Fecho confirmado.");
      qc.invalidateQueries({ queryKey: ["route-cc-closure", routeId] });
      qc.invalidateQueries({ queryKey: ["fd-closures-pending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closed = !!closureQ.data?.closed_at;

  if (routeQ.isLoading || closureQ.isLoading) {
    return <div className="p-6 text-muted-foreground">A carregar…</div>;
  }
  if (!routeQ.data) {
    return <div className="p-6">Rota não encontrada.</div>;
  }

  const r = routeQ.data;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Fecho de caixa da rota</h1>
        {closed && <Badge className="bg-emerald-600">Fechada</Badge>}
      </div>

      {/* Cabeçalho */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumo da rota</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-muted-foreground text-xs">Data</div><div className="font-medium">{new Date(r.route_date).toLocaleDateString("pt-PT")}</div></div>
          <div><div className="text-muted-foreground text-xs">Zona</div><div className="font-medium">{r.zone?.name ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Entregador</div><div className="font-medium">{r.driver?.full_name ?? "—"}</div></div>
          <div><div className="text-muted-foreground text-xs">Veículo</div><div className="font-medium">{r.vehicle?.name ?? r.vehicle?.license_plate ?? "—"}</div></div>
        </CardContent>
      </Card>

      {/* Entregas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entregas ({ordersQ.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(ordersQ.data ?? []).map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm border-b pb-1.5 last:border-0">
              <div>
                <span className="font-mono text-xs mr-2 text-muted-foreground">#{o.sequence}</span>
                <span className="font-medium">{o.schedule?.sale_order?.name ?? "—"}</span>
                <span className="text-muted-foreground ml-2">{o.schedule?.sale_order?.partner?.name ?? ""}</span>
              </div>
              <Badge variant="outline">{o.status}</Badge>
            </div>
          ))}
          {(ordersQ.data?.length ?? 0) === 0 && (
            <div className="text-sm text-muted-foreground">Sem entregas associadas.</div>
          )}
        </CardContent>
      </Card>

      {/* Totais esperados */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Valores esperados por método</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: "cash", label: "💵 Dinheiro", v: expected.cash },
            { k: "mbway", label: "📱 MB Way", v: expected.mbway },
            { k: "transfer", label: "🏧 Multibanco / Transferência", v: expected.transfer },
            { k: "other", label: "📋 Outros", v: expected.other },
          ].map((e) => (
            <div key={e.k} className="rounded-lg border p-3 bg-muted/30">
              <div className="text-xs text-muted-foreground">{e.label}</div>
              <div className="font-semibold tabular-nums">{fmtEUR(e.v)}</div>
            </div>
          ))}
          <div className="md:col-span-4 text-right pt-2 border-t">
            <span className="text-sm text-muted-foreground mr-2">Total esperado:</span>
            <span className="text-lg font-bold tabular-nums">{fmtEUR(expectedTotal)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Fase 1 → botão para fase 2 */}
      {phase === 1 && !closed && (
        <div className="flex justify-end">
          <Button size="lg" onClick={() => setPhase(2)}>Iniciar Fecho</Button>
        </div>
      )}

      {/* Fase 2 — form */}
      {(phase === 2 || closed) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{closed ? "Fecho confirmado" : "Contagem real"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { k: "cash", label: "💵 Dinheiro contado", exp: expected.cash },
                { k: "mbway", label: "📱 MB Way recebido", exp: expected.mbway },
                { k: "transfer", label: "🏧 Multibanco / Transferência", exp: expected.transfer },
                { k: "other", label: "📋 Outros", exp: expected.other },
              ].map((f) => {
                const realVal = closed
                  ? Number((closureQ.data as Closure)[`actual_${f.k}` as keyof Closure] ?? 0)
                  : actuals[f.k as keyof typeof actuals];
                const diff = realVal - f.exp;
                return (
                  <div key={f.k}>
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      disabled={closed}
                      value={realVal}
                      onChange={(e) => setActuals((a) => ({ ...a, [f.k]: Number(e.target.value) || 0 }))}
                      className="font-mono tabular-nums"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Esperado: <span className="tabular-nums">{fmtEUR(f.exp)}</span>
                      {realVal !== 0 && (
                        <span className={`ml-2 ${diff === 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-amber-600"}`}>
                          Δ {fmtEUR(diff)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Resumo */}
            <div className="rounded-lg border p-4 bg-muted/30 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Variância total</div>
                <div className={`text-2xl font-bold tabular-nums ${variance === 0 ? "text-emerald-600" : variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                  {fmtEUR(closed ? closureQ.data!.variance : variance)}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="text-muted-foreground">Esperado: <span className="tabular-nums">{fmtEUR(expectedTotal)}</span></div>
                <div>Real: <span className="tabular-nums font-medium">{fmtEUR(closed ? (closureQ.data!.actual_cash + closureQ.data!.actual_mbway + closureQ.data!.actual_transfer + closureQ.data!.actual_other) : actualTotal)}</span></div>
              </div>
            </div>

            {hasVariance && !closed && (
              <Alert variant={variance < 0 ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{variance < 0 ? "Falta dinheiro" : "Excesso de dinheiro"}</AlertTitle>
                <AlertDescription>
                  Há uma variância de {fmtEUR(variance)}. Justifique nas notas (obrigatório).
                </AlertDescription>
              </Alert>
            )}

            <div>
              <Label className="text-xs">Notas {hasVariance && !closed && <span className="text-red-600">*</span>}</Label>
              <Textarea
                disabled={closed}
                value={closed ? (closureQ.data!.notes ?? "") : notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Justificação da variância, observações…"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              {closed ? (
                <>
                  <div className="flex items-center gap-2 text-emerald-600 text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Fecho realizado em{" "}
                    {new Date(closureQ.data!.closed_at!).toLocaleString("pt-PT")}
                  </div>
                  <Button asChild variant="outline">
                    <Link to={`/delivery/routes/${routeId}/cash-close/receipt`} target="_blank">
                      <Printer className="h-4 w-4 mr-1" /> Imprimir comprovante
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setPhase(1)}>Cancelar</Button>
                  <Button
                    size="lg"
                    disabled={closeMut.isPending || (hasVariance && !notes.trim())}
                    onClick={() => closeMut.mutate()}
                  >
                    {closeMut.isPending ? "A confirmar…" : "Confirmar Fecho"}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
