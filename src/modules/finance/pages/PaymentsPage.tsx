import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmtMoney } from "@/lib/format";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("customer_payments")
        .select("id,name,payment_date,amount,state,reference,partner_id,order_id, payment_methods(name), account_journals(name), partners(name), sale_orders(name)")
        .order("payment_date", { ascending: false })
        .limit(500);
      setPayments(data ?? []);

      const { data: sched } = await supabase
        .from("sale_payment_schedules")
        .select("id,label,due_kind,due_date,due_days,amount,paid_amount,state,order_id, sale_orders(id,name,partner_id, partners(name))")
        .neq("state", "paid")
        .order("created_at");
      setPending(sched ?? []);
    })();
  }, []);

  return (
    <>
      <PageHeader title="Recebimentos" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Recebimentos" }]} />
      <PageBody>
        <Tabs defaultValue="received">
          <TabsList>
            <TabsTrigger value="received">Recebidos ({payments.length})</TabsTrigger>
            <TabsTrigger value="pending">Por Receber ({pending.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="received">
            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Nº</th>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Venda</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-left px-3 py-2">Diário</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem recebimentos</td></tr>
                  ) : payments.map((p) => (
                    <tr key={p.id} className={`border-t ${p.state === "cancelled" ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-mono">{p.name}</td>
                      <td className="px-3 py-2">{p.payment_date}</td>
                      <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {p.sale_orders ? <Link to={`/sales/orders/${p.order_id}`} className="text-primary hover:underline">{p.sale_orders.name}</Link> : "—"}
                      </td>
                      <td className="px-3 py-2">{p.payment_methods?.name ?? "—"}</td>
                      <td className="px-3 py-2">{p.account_journals?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                      <td className="px-3 py-2">{p.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Venda</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Parcela</th>
                    <th className="text-left px-3 py-2">Vencimento</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-right px-3 py-2">Pago</th>
                    <th className="text-right px-3 py-2">Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Tudo em dia</td></tr>
                  ) : pending.map((s) => {
                    const open = Number(s.amount || 0) - Number(s.paid_amount || 0);
                    const due =
                      s.due_kind === "fixed_date" ? (s.due_date ?? "—")
                      : s.due_kind === "on_confirm" ? "Na confirmação"
                      : s.due_kind === "on_delivery" ? "Na entrega"
                      : s.due_kind === "days_after_confirm" ? `${s.due_days ?? 0}d após confirmação`
                      : "—";
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">
                          <Link to={`/sales/orders/${s.order_id}`} className="text-primary hover:underline">{s.sale_orders?.name}</Link>
                        </td>
                        <td className="px-3 py-2">{s.sale_orders?.partners?.name ?? "—"}</td>
                        <td className="px-3 py-2">{s.label}</td>
                        <td className="px-3 py-2">{due}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.paid_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(open)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
