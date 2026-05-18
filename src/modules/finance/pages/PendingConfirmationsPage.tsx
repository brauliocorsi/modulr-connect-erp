import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

export default function PendingConfirmationsPage() {
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("customer_payments")
      .select("id,name,payment_date,amount,state,reference,partner_id,order_id, payment_methods(name,confirmation_mode), account_journals(name), partners(name), sale_orders(name)")
      .in("state", ["pending", "pending_delivery"])
      .order("payment_date", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const confirm = async (id: string) => {
    const { error } = await supabase.rpc("confirm_pending_payment", { _payment: id });
    if (error) return toast.error(error.message);
    toast.success("Recebimento confirmado");
    load();
  };
  const cancel = async (id: string) => {
    if (!window.confirm("Cancelar este recebimento?")) return;
    const { error } = await supabase.rpc("cancel_customer_payment", { _payment_id: id });
    if (error) return toast.error(error.message);
    toast.success("Recebimento cancelado");
    load();
  };

  return (
    <>
      <PageHeader title="Confirmações Pendentes" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Confirmações" }]} />
      <PageBody>
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Nº</th>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Venda</th>
                <th className="text-left px-3 py-2">Método</th>
                <th className="text-left px-3 py-2">Referência</th>
                <th className="text-right px-3 py-2">Valor</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Nenhum pagamento pendente</td></tr>
              ) : rows.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{p.name}</td>
                  <td className="px-3 py-2">{p.payment_date}</td>
                  <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2">{p.sale_orders ? <Link to={`/sales/orders/${p.order_id}`} className="text-primary hover:underline">{p.sale_orders.name}</Link> : "—"}</td>
                  <td className="px-3 py-2">{p.payment_methods?.name ?? "—"}</td>
                  <td className="px-3 py-2">{p.reference ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900">
                      {p.state === "pending_delivery" ? "Aguarda entrega" : "Aguarda confirmação"}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => confirm(p.id)}><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => cancel(p.id)}><X className="h-4 w-4 text-rose-600" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
