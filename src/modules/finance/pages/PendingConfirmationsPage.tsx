import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { fmtMoney } from "@/lib/format";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { OperationalStatusBadge } from "@/core/operational";

export default function PendingConfirmationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("customer_payments")
      .select("id,name,payment_date,amount,state,reference,partner_id,order_id, payment_methods(name,confirmation_mode), account_journals(name), partners(name), sale_orders(name)")
      .in("state", ["pending", "pending_delivery"])
      .order("payment_date", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const confirm = async (id: string) => {
    setConfirmingId(id);
    const { error } = await supabase.rpc("confirm_pending_payment", { _payment: id });
    setConfirmingId(null);
    if (error) return toast.error(error.message);
    toast.success("Recebimento confirmado");
    load();
  };

  const openReject = (p: any) => {
    setRejectTarget(p);
    setRejectReason("");
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) return toast.error("Indique o motivo da rejeição");
    setRejecting(true);
    const { error } = await supabase.rpc("cancel_customer_payment", {
      _payment_id: rejectTarget.id,
      _reason: reason,
    });
    setRejecting(false);
    if (error) return toast.error(error.message);
    toast.success("Recebimento rejeitado");
    setRejectTarget(null);
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
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">A carregar…</td></tr>
              ) : rows.length === 0 ? (
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
                    <OperationalStatusBadge domain="customer_payment" status={p.state} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Confirmar"
                        disabled={confirmingId === p.id}
                        onClick={() => confirm(p.id)}
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Rejeitar" onClick={() => openReject(p)}>
                        <X className="h-4 w-4 text-rose-600" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>

      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar recebimento</DialogTitle>
            {rejectTarget && (
              <DialogDescription>
                Rejeitar {rejectTarget.name} ({fmtMoney(rejectTarget.amount)}). O motivo fica registado na auditoria.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="reject-reason">Motivo *</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex.: referência incorreta, valor não recebido…"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)} disabled={rejecting}>Cancelar</Button>
            <Button variant="destructive" onClick={submitReject} disabled={rejecting || rejectReason.trim().length < 3}>
              {rejecting ? "A rejeitar…" : "Rejeitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
