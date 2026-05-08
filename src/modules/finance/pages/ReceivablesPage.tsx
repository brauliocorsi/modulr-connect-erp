import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { Receipt } from "lucide-react";
import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";

const dueLabel = (s: any) => {
  if (s.due_kind === "fixed_date") return s.due_date ?? "—";
  if (s.due_kind === "on_confirm") return "Na confirmação";
  if (s.due_kind === "on_delivery") return "Na entrega";
  if (s.due_kind === "days_after_confirm") return `${s.due_days ?? 0}d após`;
  return "—";
};

const isOverdue = (s: any) => {
  if (s.due_kind === "fixed_date" && s.due_date) return new Date(s.due_date) < new Date();
  return false;
};

export default function ReceivablesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pickedOrder, setPickedOrder] = useState<{ id: string; partner_id?: string | null; amount: number } | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("sale_payment_schedules")
      .select("id,label,due_kind,due_date,due_days,amount,paid_amount,state,order_id, sale_orders(id,name,partner_id, partners(name))")
      .neq("state", "paid")
      .order("created_at");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const all = rows.map((r) => ({ ...r, _open: Number(r.amount) - Number(r.paid_amount), _overdue: isOverdue(r) }));
    return {
      all,
      overdue: all.filter((r) => r._overdue),
      week: all.filter((r) => !r._overdue && r.due_kind === "fixed_date" && r.due_date && new Date(r.due_date) <= new Date(Date.now() + 7 * 86400000)),
    };
  }, [rows]);

  const Table = ({ data }: { data: any[] }) => (
    <Card>
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2">Venda</th>
            <th className="text-left px-3 py-2">Cliente</th>
            <th className="text-left px-3 py-2">Parcela</th>
            <th className="text-left px-3 py-2">Vencimento</th>
            <th className="text-right px-3 py-2">Valor</th>
            <th className="text-right px-3 py-2">Em aberto</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nada por aqui</td></tr>
          ) : data.map((s) => (
            <tr key={s.id} className={`border-t ${s._overdue ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}`}>
              <td className="px-3 py-2"><Link to={`/sales/orders/${s.order_id}`} className="text-primary hover:underline">{s.sale_orders?.name}</Link></td>
              <td className="px-3 py-2">{s.sale_orders?.partners?.name ?? "—"}</td>
              <td className="px-3 py-2">{s.label}</td>
              <td className="px-3 py-2">{dueLabel(s)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(s._open)}</td>
              <td className="px-2">
                <Button size="sm" variant="ghost" onClick={() => setPickedOrder({ id: s.order_id, partner_id: s.sale_orders?.partner_id, amount: s._open })}>
                  <Receipt className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );

  return (
    <>
      <PageHeader title="Contas a Receber" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "A Receber" }]} />
      <PageBody>
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">Todas ({groups.all.length})</TabsTrigger>
            <TabsTrigger value="week">Esta semana ({groups.week.length})</TabsTrigger>
            <TabsTrigger value="overdue">Vencidas ({groups.overdue.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="all"><Table data={groups.all} /></TabsContent>
          <TabsContent value="week"><Table data={groups.week} /></TabsContent>
          <TabsContent value="overdue"><Table data={groups.overdue} /></TabsContent>
        </Tabs>
      </PageBody>
      {pickedOrder && (
        <RegisterPaymentDialog
          open={!!pickedOrder}
          onOpenChange={(v) => { if (!v) setPickedOrder(null); }}
          orderId={pickedOrder.id}
          partnerId={pickedOrder.partner_id}
          defaultAmount={pickedOrder.amount}
          onSaved={() => { setPickedOrder(null); load(); }}
        />
      )}
    </>
  );
}
