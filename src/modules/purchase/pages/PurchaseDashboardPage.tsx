/**
 * F29 Bloco 7 — Dashboard de Compras
 * Rota: /purchase
 * Visão diária para o comprador: necessidades, encomendas em curso,
 * receções esperadas e contas a pagar.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingCart, PackageOpen, Truck, Receipt, AlertTriangle, ArrowRight } from "lucide-react";

const REFRESH_MS = 60_000;

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-PT") : "—";
const todayISO = () => new Date().toISOString().slice(0, 10);
const inDaysISO = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function KpiCard({ icon: Icon, label, value, hint, tone = "default" }: {
  icon: any; label: string; value: string; hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneCls = {
    default: "border-border",
    danger: "border-rose-300 bg-rose-50/40",
    warning: "border-amber-300 bg-amber-50/40",
    success: "border-emerald-300 bg-emerald-50/40",
  }[tone];
  return (
    <Card className={toneCls}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="p-2 rounded-md bg-muted"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PurchaseDashboardPage() {
  // 7.1 — Necessidades pendentes
  const { data: needs = [] } = useQuery({
    queryKey: ["purchase-dash-needs"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_needs")
        .select(`
          id, qty_needed, needed_by, priority, origin_kind, state,
          product:products(id, name, default_code),
          supplier:partners!purchase_needs_suggested_partner_id_fkey(id, name),
          sale_order:sale_orders(id, name)
        `)
        .eq("state", "pending")
        .order("priority", { ascending: false })
        .order("needed_by", { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 7.1 — Encomendas em curso
  const { data: pos = [] } = useQuery({
    queryKey: ["purchase-dash-pos"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select(`id, name, state, expected_date, amount_total, partner:partners(name)`)
        .in("state", ["draft", "rfq_sent", "confirmed"] as any)
        .order("expected_date", { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 7.1 — Receções esperadas próximos 7 dias
  const { data: receipts = [] } = useQuery({
    queryKey: ["purchase-dash-receipts"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_pickings")
        .select(`id, name, state, scheduled_at, origin, partner:partners(name)`)
        .eq("kind", "incoming" as any)
        .in("state", ["waiting", "ready"] as any)
        .gte("scheduled_at", new Date().toISOString())
        .lte("scheduled_at", new Date(inDaysISO(7) + "T23:59:59").toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // 7.1 — Contas a pagar a fornecedores
  const { data: bills = [] } = useQuery({
    queryKey: ["purchase-dash-bills"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_bills")
        .select(`id, name, amount_total, amount_paid, due_date, state, partner:partners(name)`)
        .neq("state", "paid")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const overdueBills = bills.filter((b) => b.due_date && b.due_date < todayISO()).length;
  const overdueTotal = bills
    .filter((b) => b.due_date && b.due_date < todayISO())
    .reduce((s, b) => s + Number(b.amount_total ?? 0) - Number(b.amount_paid ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard de Compras"
        breadcrumb={[{ label: "Compras" }, { label: "Dashboard" }]}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/purchase/needs">Necessidades</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/purchase/orders/new">Nova Encomenda</Link>
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiCard
            icon={PackageOpen}
            label="Necessidades pendentes"
            value={String(needs.length)}
            hint="Top 20 por prioridade"
          />
          <KpiCard
            icon={ShoppingCart}
            label="Encomendas em curso"
            value={String(pos.length)}
            hint="Rascunho · RFQ · Confirmadas"
          />
          <KpiCard
            icon={Truck}
            label="Receções (7 dias)"
            value={String(receipts.length)}
            hint="Pickings 'incoming' agendados"
            tone={receipts.length > 0 ? "success" : "default"}
          />
          <KpiCard
            icon={Receipt}
            label="Contas a pagar"
            value={fmtEUR(bills.reduce((s, b) => s + Number(b.amount_total ?? 0) - Number(b.amount_paid ?? 0), 0))}
            hint={overdueBills > 0 ? `${overdueBills} vencidas · ${fmtEUR(overdueTotal)}` : `${bills.length} faturas`}
            tone={overdueBills > 0 ? "danger" : "default"}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Necessidades pendentes</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link to="/purchase/needs">Ver todas <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Fornecedor sugerido</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Para</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {needs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem necessidades pendentes.</TableCell></TableRow>
                  ) : needs.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{n.product?.name ?? "—"}</div>
                        {n.product?.default_code && (
                          <div className="text-[10px] text-muted-foreground">{n.product.default_code}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{n.supplier?.name ?? <span className="text-muted-foreground italic">A definir</span>}</TableCell>
                      <TableCell>
                        {n.sale_order ? (
                          <Link to={`/sales/${n.sale_order.id}`} className="text-xs text-primary hover:underline">{n.sale_order.name}</Link>
                        ) : (
                          <Badge variant="outline" className="capitalize text-[10px]">{n.origin_kind}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Number(n.qty_needed).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(n.needed_by)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Encomendas em curso</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link to="/purchase/orders">Ver todas <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Encomenda</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Prevista</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem encomendas em curso.</TableCell></TableRow>
                  ) : pos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link to={`/purchase/orders/${p.id}`} className="text-sm text-primary hover:underline font-medium">{p.name}</Link>
                      </TableCell>
                      <TableCell className="text-sm">{p.partner?.name ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-[10px]">{p.state}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtDate(p.expected_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEUR(p.amount_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receções esperadas (próximos 7 dias)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Picking</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Agendado</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem receções nos próximos 7 dias.</TableCell></TableRow>
                  ) : receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to={`/inventory/receipts`} className="text-sm text-primary hover:underline font-medium">{r.name}</Link>
                      </TableCell>
                      <TableCell className="text-sm">{r.partner?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.origin ?? "—"}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.scheduled_at)}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-[10px]">{r.state}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Contas a pagar a fornecedores</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link to="/finance/payables">Ver todas <ArrowRight className="h-3 w-3 ml-1" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Fatura</TableHead>
                    <TableHead className="text-right">Em dívida</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Sem faturas em aberto.</TableCell></TableRow>
                  ) : bills.map((b) => {
                    const overdue = b.due_date && b.due_date < todayISO();
                    return (
                      <TableRow key={b.id} className={overdue ? "bg-rose-50/40" : ""}>
                        <TableCell className="text-sm">{b.partner?.name ?? "—"}</TableCell>
                        <TableCell>
                          <Link to={`/finance/payables/${b.id}`} className="text-xs text-primary hover:underline">{b.name}</Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEUR(Number(b.amount_total ?? 0) - Number(b.amount_paid ?? 0))}
                        </TableCell>
                        <TableCell className="text-xs">
                          {overdue && <AlertTriangle className="h-3 w-3 text-rose-600 inline mr-1" />}
                          {fmtDate(b.due_date)}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="capitalize text-[10px]">{b.state}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
