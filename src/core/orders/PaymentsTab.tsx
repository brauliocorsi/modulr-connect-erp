import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Receipt, Calendar, CheckCircle2, Clock, AlertCircle, Settings2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";

const DUE_KIND_LABEL: Record<string, string> = {
  on_confirm: "Na confirmação",
  on_delivery: "Na entrega",
  fixed_date: "Data fixa",
  days_after_confirm: "X dias após confirmação",
};

const STATE_META: Record<string, { tone: string; label: string; icon: any }> = {
  pending: { tone: "bg-muted text-muted-foreground", label: "A receber", icon: Clock },
  partial: { tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", label: "Parcial", icon: AlertCircle },
  paid: { tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", label: "Pago", icon: CheckCircle2 },
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
  const [advanced, setAdvanced] = useState(false);

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

  // ---------- helpers ----------
  const recalcAmounts = (rows: any[]) => {
    const out = rows.map((r) => ({ ...r, amount: Number(((total * (Number(r.percent) || 0)) / 100).toFixed(2)) }));
    // Adjust rounding diff into the LAST line so soma = total exatamente
    if (out.length > 0) {
      const sum = out.reduce((s, r) => s + Number(r.amount || 0), 0);
      const diff = Number((total - sum).toFixed(2));
      if (Math.abs(diff) >= 0.01) out[out.length - 1].amount = Number((Number(out[out.length - 1].amount) + diff).toFixed(2));
    }
    return out;
  };

  const setSched = (idx: number, patch: any) => {
    setSchedules((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], ...patch };
      if ("percent" in patch) n[idx].amount = Number(((total * (Number(patch.percent) || 0)) / 100).toFixed(2));
      if ("amount" in patch) n[idx].percent = total > 0 ? Number(((Number(patch.amount) || 0) * 100 / total).toFixed(2)) : 0;
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

  const applyPreset = (preset: "full_delivery" | "signal_50" | "signal_30" | "split_2x" | "split_3x") => {
    let rows: any[] = [];
    switch (preset) {
      case "full_delivery":
        rows = [{ order_id: orderId, sequence: 10, label: "Total a receber", due_kind: "on_delivery", percent: 100, state: "pending" }];
        break;
      case "signal_50":
        rows = [
          { order_id: orderId, sequence: 10, label: "Sinal", due_kind: "on_confirm", percent: 50, state: "pending" },
          { order_id: orderId, sequence: 20, label: "Saldo", due_kind: "on_delivery", percent: 50, state: "pending" },
        ]; break;
      case "signal_30":
        rows = [
          { order_id: orderId, sequence: 10, label: "Sinal", due_kind: "on_confirm", percent: 30, state: "pending" },
          { order_id: orderId, sequence: 20, label: "Saldo", due_kind: "on_delivery", percent: 70, state: "pending" },
        ]; break;
      case "split_2x":
        rows = [
          { order_id: orderId, sequence: 10, label: "1ª parcela", due_kind: "on_delivery", percent: 50, state: "pending" },
          { order_id: orderId, sequence: 20, label: "2ª parcela", due_kind: "days_after_confirm", due_days: 30, percent: 50, state: "pending" },
        ]; break;
      case "split_3x":
        rows = [
          { order_id: orderId, sequence: 10, label: "1ª parcela", due_kind: "on_delivery", percent: 33.33, state: "pending" },
          { order_id: orderId, sequence: 20, label: "2ª parcela", due_kind: "days_after_confirm", due_days: 30, percent: 33.33, state: "pending" },
          { order_id: orderId, sequence: 30, label: "3ª parcela", due_kind: "days_after_confirm", due_days: 60, percent: 33.34, state: "pending" },
        ]; break;
    }
    setSchedules(recalcAmounts(rows));
    setAdvanced(true);
  };

  const saveSchedules = async () => {
    if (schedules.length === 0) return toast.error("Adicione ao menos uma linha");
    // ajusta automaticamente a última linha para fechar 100%
    const adjusted = recalcAmounts(schedules);
    // limpa antigas que foram removidas
    const existingIds = adjusted.filter((s) => s.id).map((s) => s.id);
    const { data: current } = await supabase.from("sale_payment_schedules").select("id").eq("order_id", orderId);
    const toDelete = (current ?? []).filter((c) => !existingIds.includes(c.id)).map((c) => c.id);
    if (toDelete.length) await supabase.from("sale_payment_schedules").delete().in("id", toDelete);
    for (const s of adjusted) {
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

  const dueLabel = (s: any) => {
    if (s.due_kind === "fixed_date") return s.due_date ? new Date(s.due_date).toLocaleDateString("pt-PT") : "Data fixa";
    if (s.due_kind === "days_after_confirm") return `${s.due_days ?? 0} dias após confirmação`;
    return DUE_KIND_LABEL[s.due_kind] ?? s.due_kind;
  };

  const sumPct = schedules.reduce((s, x) => s + Number(x.percent || 0), 0);
  const sumAmt = schedules.reduce((s, x) => s + Number(x.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Total da venda" value={fmtMoney(total)} />
        <Stat label="Recebido" value={fmtMoney(paidTotal)} tone="emerald" />
        <Stat label="Em aberto" value={fmtMoney(open)} tone={open > 0 ? "rose" : "muted"} />
        <Stat label="Próximo vencimento" value={nextSchedule ? `${nextSchedule.label} · ${fmtMoney((nextSchedule.amount ?? 0) - (nextSchedule.paid_amount ?? 0))}` : "—"} />
      </Card>

      {/* Cronograma */}
      <Card>
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="font-semibold">Cronograma</div>
            <span className="text-xs text-muted-foreground">
              {schedules.length} {schedules.length === 1 ? "linha" : "linhas"} · {sumPct.toFixed(0)}%
            </span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {!advanced && schedules.length === 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => applyPreset("full_delivery")}>
                  <Wand2 className="h-4 w-4 mr-1" /> 100% na entrega
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("signal_50")}>Sinal 50%</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("signal_30")}>Sinal 30%</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAdvanced((v) => !v)}>
              <Settings2 className="h-4 w-4 mr-1" /> {advanced ? "Modo simples" : "Avançado"}
            </Button>
            {advanced && (
              <>
                <Button size="sm" variant="outline" onClick={addSched}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
                <Button size="sm" onClick={saveSchedules}>Salvar</Button>
              </>
            )}
          </div>
        </div>

        {/* Vista simplificada — cards por parcela */}
        {!advanced ? (
          schedules.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Sem cronograma. Será criado <strong>"Total a receber na entrega"</strong> ao confirmar a venda,
              ou escolha um modelo acima.
            </div>
          ) : (
            <div className="p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {schedules.map((s) => {
                const meta = STATE_META[s.state] ?? STATE_META.pending;
                const Icon = meta.icon;
                const remaining = Math.max(0, Number(s.amount || 0) - Number(s.paid_amount || 0));
                return (
                  <div key={s.id ?? s.sequence} className="rounded-lg border p-3 bg-card">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-medium">{s.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="h-3 w-3" /> {dueLabel(s)}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.tone}`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">Valor</div>
                        <div className="text-lg font-semibold tabular-nums">{fmtMoney(s.amount)}</div>
                      </div>
                      {Number(s.paid_amount || 0) > 0 && (
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Pago</div>
                          <div className="text-sm tabular-nums text-emerald-600">{fmtMoney(s.paid_amount)}</div>
                          {remaining > 0 && <div className="text-xs text-rose-600 tabular-nums">Falta {fmtMoney(remaining)}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Vista avançada — tabela editável + presets */
          <div>
            <div className="px-4 py-2 border-b bg-muted/20 flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted-foreground mr-1">Modelos:</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => applyPreset("full_delivery")}>100% entrega</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => applyPreset("signal_50")}>50/50</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => applyPreset("signal_30")}>30/70</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => applyPreset("split_2x")}>2× (30d)</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => applyPreset("split_3x")}>3× (30/60d)</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Rótulo</th>
                    <th className="text-left px-3 py-2 w-44">Vencimento</th>
                    <th className="text-left px-3 py-2 w-36">Detalhe</th>
                    <th className="text-left px-3 py-2 w-20">%</th>
                    <th className="text-right px-3 py-2 w-32">Valor</th>
                    <th className="text-right px-3 py-2 w-28">Pago</th>
                    <th className="text-left px-3 py-2 w-28">Estado</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem parcelas</td></tr>
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
                        <Input className="h-8" type="number" step="0.01" value={s.percent ?? 0} onChange={(e) => setSched(i, { percent: Number(e.target.value) })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input className="h-8 text-right tabular-nums" type="number" step="0.01" value={s.amount ?? 0} onChange={(e) => setSched(i, { amount: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.paid_amount ?? 0)}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATE_META[s.state]?.tone ?? STATE_META.pending.tone}`}>
                          {STATE_META[s.state]?.label ?? s.state}
                        </span>
                      </td>
                      <td>
                        <Button variant="ghost" size="icon" onClick={() => removeSched(i)} disabled={s.state === "paid"}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {schedules.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/20 text-xs">
                      <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                        {Math.abs(sumPct - 100) > 0.01
                          ? <span className="text-amber-600">⚠ Soma {sumPct.toFixed(2)}% — última linha será ajustada ao salvar</span>
                          : <span className="text-emerald-600">✓ Soma 100%</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{sumPct.toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(sumAmt)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Recebimentos */}
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
