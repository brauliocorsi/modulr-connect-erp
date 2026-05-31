/**
 * F29 Bloco 4 — Página dedicada de agendamento de venda
 * Rota: /sales/:orderId/schedule
 * Mostra contexto da venda + reutiliza ScheduleSaleOrderDeliveryDialog.
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScheduleSaleOrderDeliveryDialog } from "@/modules/sales/components/ScheduleSaleOrderDeliveryDialog";
import { ArrowLeft, CalendarClock, MapPin, Package } from "lucide-react";

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-PT") : "—";

export default function SaleOrderSchedulePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const orderQ = useQuery({
    queryKey: ["sale-order-schedule", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const [orderRes, paymentsRes] = await Promise.all([
        supabase
          .from("sale_orders")
          .select("id,name,state,commitment_date,delivery_mode,delivery_zone_label,amount_total,payment_status,partner:partners(name,zip)")
          .eq("id", orderId!)
          .maybeSingle(),
        supabase
          .from("customer_payments")
          .select("amount")
          .eq("order_id", orderId!)
          .eq("state", "posted"),
      ]);
      if (orderRes.error) throw orderRes.error;
      const paid = (paymentsRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      return { ...orderRes.data, amount_paid: paid } as Record<string, unknown> & { id: string; name: string };
    },
  });

  const scheduleQ = useQuery({
    queryKey: ["sale-order-schedule-existing", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_schedules")
        .select("id,scheduled_date,slot_start,slot_end,status,physical_state,route_id,fulfillment_type")
        .eq("sale_order_id", orderId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (orderQ.isLoading) return <div className="p-6 text-muted-foreground">A carregar…</div>;
  if (!orderQ.data) return <div className="p-6">Venda não encontrada.</div>;

  const o = orderQ.data as {
    id: string; name: string; state: string;
    commitment_date: string | null; delivery_mode: string | null;
    delivery_zone_label: string | null;
    amount_total: number; amount_paid: number; payment_status: string | null;
    partner: { name: string; zip: string | null } | null;
  };
  const sched = scheduleQ.data;
  const due = Number(o.amount_total) - Number(o.amount_paid);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Agendar entrega</h1>
        <Badge variant="outline">{o.state}</Badge>
      </div>

      {/* Contexto da venda */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            <Link to={`/sales/orders/${o.id}`} className="hover:underline">{o.name}</Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Cliente</div><div className="font-medium">{o.partner?.name ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">CP / Zona</div><div className="font-medium">{o.partner?.zip ?? o.delivery_zone_label ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Modo</div><div className="font-medium capitalize">{o.delivery_mode ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Data desejada</div><div className="font-medium">{fmtDate(o.commitment_date)}</div></div>
        </CardContent>
      </Card>

      {/* Pagamento pendente */}
      {due > 0.01 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-amber-700 font-semibold">Saldo a cobrar na entrega</div>
              <div className="text-2xl font-bold tabular-nums text-amber-900">{fmtEUR(due)}</div>
              <div className="text-xs text-amber-700 mt-1">O entregador deve cobrar este valor.</div>
            </div>
            <Badge variant="secondary" className="bg-amber-200 text-amber-900">{o.payment_status ?? "pendente"}</Badge>
          </CardContent>
        </Card>
      )}

      {/* Agendamento atual */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Agendamento
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scheduleQ.isLoading ? (
            <div className="text-sm text-muted-foreground">A carregar…</div>
          ) : sched ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Data</div>
                  <div className="font-semibold">{fmtDate(sched.scheduled_date)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Janela</div>
                  <div className="font-semibold">
                    {sched.slot_start?.slice(0, 5) ?? "—"}
                    {sched.slot_end ? ` – ${sched.slot_end.slice(0, 5)}` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Estado</div>
                  <Badge variant="secondary">{sched.status}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" /> Estado físico
                  </div>
                  <Badge variant="outline">{sched.physical_state}</Badge>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {sched.route_id ? <Link to={`/routes/${sched.route_id}`} className="hover:underline">Rota atribuída</Link> : "Sem rota atribuída"}
                </div>
                <Button onClick={() => setDialogOpen(true)}>Reagendar</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Esta venda ainda não tem agendamento.</div>
              <Button onClick={() => setDialogOpen(true)}>Agendar entrega</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleSaleOrderDeliveryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        saleOrderId={o.id}
        preferredDate={o.commitment_date}
        onScheduled={() => {
          setDialogOpen(false);
          scheduleQ.refetch();
        }}
      />
    </div>
  );
}
