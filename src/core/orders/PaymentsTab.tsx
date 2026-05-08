import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";

const DUE_KIND_LABEL: Record<string, string> = {
  on_confirm: "Na confirmação",
  on_delivery: "Na entrega",
  fixed_date: "Data fixa",
  days_after_confirm: "X dias após confirmação",
};

const STATE_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

export function PaymentsTab({
  orderId,
  partnerId,
  total,
  isLocked,
}: {
  orderId: string;
  partnerId?: string | null;
  total: number;
  isLocked: boolean;
}) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("sale_payment_schedules").select("*").eq("order_id", orderId).order("sequence"),
      supabase.from("customer_payments").select("*, payment_methods(name), account_journals(name)").eq("order_id", orderId).order("payment_date", { ascending: false }),
    ]);
    setSchedules(s ?? []);
    setPayments(p ?? []);
  };
  useEffect(() => { if (orderId) load(); }, [orderId]);

  const paidTotal = payments.filter((p) => p.state === "posted").reduce((s, p) => s + Number(p.amount || 0), 0);
  const open = Math.max(0, total - paidTotal);
  const nextSchedule = schedules.find((s) => s.state !== "paid");

  const setSched = (idx: number, patch: any) => {
    setSchedules((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], ...patch };
      if ("percent" in patch) {
        n[idx].amount = Number(((total * (Number(patch.percent) || 0)) / 100).toFixed(2));
      }
      return n;
    });
  };

  const addSched = () =>
    setSchedules((p) => [...p, {
      order_id: orderId,
      sequence: (p[p.length - 1]?.sequence ?? 0) + 10,
      label: "Parcela",
      due_kind: "on_delivery",
      percent: 0,
      amount: 0,
      state: "pending",
    }]);

  const removeSched = async (idx: number) => {
    const s = schedules[idx];
    if (s.id) await supabase.from("sale_payment_schedules").delete().eq("id", s.id);
    setSchedules((p) => p.filter((_, i) => i !== idx));
  };

  const saveSchedules = async () => {
    const sumPct = schedules.reduce((s, x) => s + Number(x.percent || 0), 0);
    if (Math.abs(sumPct - 100) > 0.01) return toast.error(`Soma dos percentuais é ${sumPct.toFixed(2)}%, deve ser 100%`);
    for (const s of schedules) {
      const payload: any = {
        order_id: orderId,
        sequence: s.sequence,
        label: s.label,
        due_kind: s.due_kind,
        due_date: s.due_kind === "fixed_date" ? s.due_date : null,
        due_days: s.due_kind === "days_after_confirm" ? s.due_days : null,
        percent: s.percent,
        amount: s.amount,
      };
      if (s.id) await supabase.from("sale_payment_schedules").update(payload).eq("id", s.id);
      else await supabase.from("sale_payment_schedules").insert(payload);
    }
    toast.success("Cronograma salvo");
    load();
  };

  const cancelPayment = async (id: string) => {
    if (!confirm("Cancelar este recebimento?")) return;
    await supabase.from("customer_payments").update({ state: "cancelled" }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Total da venda" value={fmtMoney(total)} />
        <Stat label="Recebido" value={fmtMoney(paidTotal)} tone="emerald" />
        <Stat label="Em aberto" value={fmtMoney(open)} tone={open > 0 ? "rose" : "muted"} />
        <Stat label="Próximo vencimento" value={nextSchedule ? `${nextSchedule.label} · ${fmtMoney((nextSchedule.amount ?? 0) - (nextSchedule.paid_amount ?? 0))}` : "—"} />
      </Card>

      <Card>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Cronograma</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addSched}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
            <Button size="sm" onClick={saveSchedules}>Salvar cronograma</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Rótulo</th>
                <th className="text-left px-3 py-2 w-44">Vencimento</th>
                <th className="text-left px-3 py-2 w-36">Detalhe</th>
                <th className="text-left px-3 py-2 w-24">%</th>
                <th className="text-right px-3 py-2 w-32">Valor</th>
                <th className="text-right px-3 py-2 w-32">Pago</th>
                <th className="text-left px-3 py-2 w-28">Estado</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem parcelas (será criado "100% na entrega" ao confirmar)</td></tr>
              ) : schedules.map((s, i) => (
                <tr key={s.id ?? `new-${i}`} className="border-t">
                  <td className="px-2 py-1">
                    <Input className="h-8" value={s.label} onChange={(e) => setSched(i, { label: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={s.due_kind} onValueChange={(v) => setSched(i, { due_kind: v })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(DUE_KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    {s.due_kind === "fixed_date" && (
                      <Input className="h-8" type="date" value={s.due_date ?? ""} onChange={(e) => setSched(i, { due_date: e.target.value })} />
                    )}
                    {s.due_kind === "days_after_confirm" && (
                      <Input className="h-8" type="number" placeholder="dias" value={s.due_days ?? ""} onChange={(e) => setSched(i, { due_days: Number(e.target.value) })} />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <Input className="h-8" type="number" step="0.01" value={s.percent} onChange={(e) => setSched(i, { percent: Number(e.target.value) })} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.paid_amount ?? 0)}</td>
                  <td className="px-2 py-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATE_TONE[s.state] ?? STATE_TONE.pending}`}>{s.state}</span>
                  </td>
                  <td>
                    <Button variant="ghost" size="icon" onClick={() => removeSched(i)} disabled={s.state === "paid"}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Recebimentos</div>
          <Button size="sm" onClick={() => setDialogOpen(true)} disabled={isLocked && open <= 0}>
            <Receipt className="h-4 w-4 mr-1" /> Registar recebimento
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Nº</th>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Método</th>
                <th className="text-left px-3 py-2">Diário</th>
                <th className="text-left px-3 py-2">Referência</th>
                <th className="text-right px-3 py-2">Valor</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem recebimentos</td></tr>
              ) : payments.map((p) => (
                <tr key={p.id} className={`border-t ${p.state === "cancelled" ? "opacity-50 line-through" : ""}`}>
                  <td className="px-3 py-2 font-mono">{p.name}</td>
                  <td className="px-3 py-2">{p.payment_date}</td>
                  <td className="px-3 py-2">{p.payment_methods?.name ?? "—"}</td>
                  <td className="px-3 py-2">{p.account_journals?.name ?? "—"}</td>
                  <td className="px-3 py-2">{p.reference ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                  <td className="px-3 py-2">{p.state}</td>
                  <td>
                    {p.state === "posted" && (
                      <Button variant="ghost" size="icon" onClick={() => cancelPayment(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RegisterPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orderId={orderId}
        partnerId={partnerId}
        defaultAmount={open}
        onSaved={load}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" | "muted" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
