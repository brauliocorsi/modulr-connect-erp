import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, ArrowRight } from "lucide-react";
import { fmtMoney } from "@/lib/format";

type Bill = {
  id: string;
  name: string;
  bill_date: string;
  due_date: string | null;
  amount_total: number;
  amount_paid: number;
  state: string;
  reference: string | null;
};

const BILL_STATE_LABEL: Record<string, string> = {
  draft: "Rascunho",
  posted: "Lançada",
  paid: "Paga",
  cancelled: "Cancelada",
};

export function PurchaseBillsPanel({
  poId,
  poName,
  poTotal,
}: {
  poId: string;
  poName: string;
  poTotal: number;
}) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [received, setReceived] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("supplier_bills")
        .select("id,name,bill_date,due_date,amount_total,amount_paid,state,reference")
        .eq("purchase_order_id", poId)
        .order("bill_date", { ascending: false });
      if (cancelled) return;
      setBills((data ?? []) as Bill[]);

      // Cross-check with received quantities
      const { data: lines } = await supabase
        .from("purchase_order_lines")
        .select("quantity")
        .eq("order_id", poId);
      const totalQty = (lines ?? []).reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
      const { data: pks } = await supabase
        .from("stock_pickings")
        .select("state, stock_moves(quantity_done)")
        .eq("origin", poName);
      let doneQty = 0;
      (pks ?? []).forEach((p: any) => {
        if (p.state !== "done") return;
        (p.stock_moves || []).forEach((m: any) => {
          doneQty += Number(m.quantity_done || 0);
        });
      });
      if (!cancelled) setReceived({ done: doneQty, total: totalQty });
    };
    load();
    const ch = supabase
      .channel(`po-bills-${poId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "supplier_bills", filter: `purchase_order_id=eq.${poId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "supplier_payments" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [poId, poName]);

  const billed = bills.reduce((s, b) => s + Number(b.amount_total || 0), 0);
  const paid = bills.reduce((s, b) => s + Number(b.amount_paid || 0), 0);
  const remainingBill = Math.max(0, Number(poTotal || 0) - billed);
  const remainingPay = Math.max(0, billed - paid);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Faturas & Conciliação</h3>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/finance/payables/new?po=${poId}`}>
            <Plus className="h-4 w-4 mr-1" /> Nova fatura
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div className="rounded border p-2">
          <div className="text-xs text-muted-foreground">Total da compra</div>
          <div className="font-semibold tabular-nums">{fmtMoney(poTotal)}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-xs text-muted-foreground">Faturado</div>
          <div className="font-semibold tabular-nums">{fmtMoney(billed)}</div>
          {remainingBill > 0 && <div className="text-[10px] text-amber-600">Falta faturar {fmtMoney(remainingBill)}</div>}
        </div>
        <div className="rounded border p-2">
          <div className="text-xs text-muted-foreground">Pago</div>
          <div className="font-semibold tabular-nums">{fmtMoney(paid)}</div>
          {remainingPay > 0 && <div className="text-[10px] text-rose-600">Em dívida {fmtMoney(remainingPay)}</div>}
        </div>
        <div className="rounded border p-2">
          <div className="text-xs text-muted-foreground">Recebido</div>
          <div className="font-semibold tabular-nums">
            {received ? `${received.done} / ${received.total}` : "—"}
          </div>
          {received && received.total > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {received.done >= received.total ? "Receção completa" : "Receção parcial"}
            </div>
          )}
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded p-3 text-center">
          Sem faturas associadas. Crie uma para conciliar com os pagamentos.
        </div>
      ) : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left px-3 py-2">Fatura</th>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Vencimento</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Pago</th>
                <th className="text-right px-3 py-2">Em dívida</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const due = Number(b.amount_total || 0) - Number(b.amount_paid || 0);
                const paidPct = b.amount_total > 0 ? (b.amount_paid / b.amount_total) * 100 : 0;
                const tone = paidPct >= 100 ? "default" : paidPct > 0 ? "secondary" : "outline";
                return (
                  <tr key={b.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2">{b.bill_date ? new Date(b.bill_date).toLocaleDateString("pt-PT") : "—"}</td>
                    <td className="px-3 py-2">{b.due_date ? new Date(b.due_date).toLocaleDateString("pt-PT") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.amount_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.amount_paid)}</td>
                    <td className={"px-3 py-2 text-right tabular-nums " + (due > 0 ? "text-rose-600" : "text-emerald-600")}>
                      {fmtMoney(due)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={tone as any}>{BILL_STATE_LABEL[b.state] ?? b.state}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <Button asChild size="icon" variant="ghost">
                        <Link to={`/finance/payables/${b.id}`}>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
