import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { Receipt, Wallet, AlertTriangle, ArrowDownToLine } from "lucide-react";

export default function FinanceDashboard() {
  const [stats, setStats] = useState<any>({
    receivable: 0, payable: 0, overdue_recv: 0, overdue_pay: 0, openSessions: 0, pending: 0,
  });

  useEffect(() => {
    (async () => {
      const [{ data: rcv }, { data: pay }, { data: open }, { data: pend }] = await Promise.all([
        supabase.from("sale_payment_schedules").select("amount,paid_amount,due_kind,due_date,state"),
        supabase.from("supplier_bills").select("amount_total,amount_paid,due_date,state"),
        supabase.from("cash_sessions").select("id,opening_balance").eq("state", "open"),
        supabase.from("customer_payments").select("id").in("state", ["pending", "pending_delivery"]),
      ]);
      const today = new Date(); today.setHours(0,0,0,0);
      const recv = (rcv ?? []).filter((s) => s.state !== "paid");
      const recvOpen = recv.reduce((s, x) => s + (Number(x.amount) - Number(x.paid_amount)), 0);
      const recvOverdue = recv.filter((s) => s.due_kind === "fixed_date" && s.due_date && new Date(s.due_date) < today).reduce((s, x) => s + (Number(x.amount) - Number(x.paid_amount)), 0);
      const pays = (pay ?? []).filter((b) => !["paid","cancelled"].includes(b.state));
      const payOpen = pays.reduce((s, b) => s + (Number(b.amount_total) - Number(b.amount_paid)), 0);
      const payOverdue = pays.filter((b) => b.due_date && new Date(b.due_date) < today).reduce((s, b) => s + (Number(b.amount_total) - Number(b.amount_paid)), 0);
      setStats({
        receivable: recvOpen, payable: payOpen,
        overdue_recv: recvOverdue, overdue_pay: payOverdue,
        openSessions: (open ?? []).length, pending: (pend ?? []).length,
      });
    })();
  }, []);

  return (
    <>
      <PageHeader title="Financeiro" breadcrumb={[{ label: "Financeiro" }]} />
      <PageBody>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DashCard to="/finance/receivables" icon={ArrowDownToLine} title="A Receber" value={fmtMoney(stats.receivable)} tone="emerald" sub={`Vencido: ${fmtMoney(stats.overdue_recv)}`} />
          <DashCard to="/finance/payables" icon={Receipt} title="A Pagar" value={fmtMoney(stats.payable)} tone="rose" sub={`Vencido: ${fmtMoney(stats.overdue_pay)}`} />
          <DashCard to="/finance/pending" icon={AlertTriangle} title="Confirmações pendentes" value={String(stats.pending)} tone="amber" sub="Multibanco / transferência" />
          <DashCard to="/finance/cash" icon={Wallet} title="Caixas abertos" value={String(stats.openSessions)} tone="muted" />
          <DashCard to="/finance/payments" icon={Receipt} title="Recebimentos" value="Ver lista" tone="muted" />
          <DashCard to="/finance/cost_centers" icon={Wallet} title="Centros de Custo" value="Configurar" tone="muted" />
        </div>
      </PageBody>
    </>
  );
}

function DashCard({ to, icon: Icon, title, value, sub, tone }: { to: string; icon: any; title: string; value: string; sub?: string; tone?: string }) {
  const toneCls = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <Link to={to}>
      <Card className="p-4 hover:shadow-md transition">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2"><Icon className="h-4 w-4" /> {title}</div>
        <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </Card>
    </Link>
  );
}
