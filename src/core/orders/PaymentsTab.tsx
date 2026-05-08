import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Receipt, Calendar, CheckCircle2, Clock, AlertCircle, Pencil, X, ChevronDown, ChevronRight } from "lucide-react";
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" | "muted" }) {
  const cls =
    tone === "emerald" ? "text-emerald-600"
    : tone === "rose" ? "text-rose-600"
    : tone === "muted" ? "text-muted-foreground"
    : "";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any[]>([]);
  const [picked, setPicked] = useState<{ amount: number; scheduleId?: string | null } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  // ---------- presets ----------
  const recalc = (rows: any[]) => {
    const out = rows.map((r) => ({ ...r, amount: Number(((total * (Number(r.percent) || 0)) / 100).toFixed(2)) }));
    if (out.length > 0) {
      const sum = out.reduce((s, r) => s + Number(r.amount || 0), 0);
      const diff = Number((total - sum).toFixed(2));
      if (Math.abs(diff) >= 0.01) out[out.length - 1].amount = Number((Number(out[out.length - 1].amount) + diff).toFixed(2));
    }
    return out;
  };

  const presetRows = (preset: string): any[] => {
    switch (preset) {
      case "full_delivery": return [{ sequence: 10, label: "Total a receber", due_kind: "on_delivery", percent: 100, state: "pending" }];
      case "signal_50": return [
        { sequence: 10, label: "Sinal", due_kind: "on_confirm", percent: 50, state: "pending" },
        { sequence: 20, label: "Saldo", due_kind: "on_delivery", percent: 50, state: "pending" },
      ];
      case "signal_30": return [
        { sequence: 10, label: "Sinal", due_kind: "on_confirm", percent: 30, state: "pending" },
        { sequence: 20, label: "Saldo", due_kind: "on_delivery", percent: 70, state: "pending" },
      ];
      case "split_2x": return [
        { sequence: 10, label: "1ª parcela", due_kind: "on_delivery", percent: 50, state: "pending" },
        { sequence: 20, label: "2ª parcela", due_kind: "days_after_confirm", due_days: 30, percent: 50, state: "pending" },
      ];
      case "split_3x": return [
        { sequence: 10, label: "1ª parcela", due_kind: "on_delivery", percent: 33.33, state: "pending" },
        { sequence: 20, label: "2ª parcela", due_kind: "days_after_confirm", due_days: 30, percent: 33.33, state: "pending" },
        { sequence: 30, label: "3ª parcela", due_kind: "days_after_confirm", due_days: 60, percent: 33.34, state: "pending" },
      ];
    }
    return [];
  };

  const applyPreset = async (preset: string) => {
    const rows = recalc(presetRows(preset).map((r) => ({ ...r, order_id: orderId })));
    // remove qualquer plano antigo sem pagamentos
    await supabase.from("sale_payment_schedules").delete().eq("order_id", orderId);
    await supabase.from("sale_payment_schedules").insert(rows.map(({ state, ...r }) => r));
    toast.success("Plano criado");
    load();
  };

  const startEdit = () => {
    setDraft(schedules.length ? schedules.map((s) => ({ ...s })) : recalc(presetRows("full_delivery").map((r) => ({ ...r, order_id: orderId }))));
    setEditing(true);
  };

  const setRow = (i: number, patch: any) => {
    setDraft((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      if ("percent" in patch) n[i].amount = Number(((total * (Number(patch.percent) || 0)) / 100).toFixed(2));
      if ("amount" in patch) n[i].percent = total > 0 ? Number(((Number(patch.amount) || 0) * 100 / total).toFixed(2)) : 0;
      return n;
    });
  };

  const addRow = () =>
    setDraft((p) => [...p, { order_id: orderId, sequence: (p[p.length - 1]?.sequence ?? 0) + 10, label: "Parcela", due_kind: "on_delivery", percent: 0, amount: 0, state: "pending" }]);

  const removeRow = (i: number) => setDraft((p) => p.filter((_, idx) => idx !== i));

  const saveDraft = async () => {
    if (draft.length === 0) return toast.error("Adicione ao menos uma parcela");
    const adjusted = recalc(draft);
    const existingIds = adjusted.filter((s) => s.id).map((s) => s.id);
    const { data: current } = await supabase.from("sale_payment_schedules").select("id").eq("order_id", orderId);
    const toDelete = (current ?? []).filter((c) => !existingIds.includes(c.id)).map((c) => c.id);
    if (toDelete.length) await supabase.from("sale_payment_schedules").delete().in("id", toDelete);
    for (const s of adjusted) {
      const payload: any = {
        order_id: orderId, sequence: s.sequence, label: s.label, due_kind: s.due_kind,
        due_date: s.due_kind === "fixed_date" ? s.due_date : null,
        due_days: s.due_kind === "days_after_confirm" ? s.due_days : null,
        percent: s.percent, amount: s.amount,
      };
      if (s.id) await supabase.from("sale_payment_schedules").update(payload).eq("id", s.id);
      else await supabase.from("sale_payment_schedules").insert(payload);
    }
    toast.success("Plano salvo");
    setEditing(false);
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

  const openReceive = async (sched?: any) => {
    if (!schedules.length && !sched) {
      const { data: created } = await supabase.from("sale_payment_schedules").insert({
        order_id: orderId, sequence: 10, label: "Total a receber",
        due_kind: "on_delivery", percent: 100, amount: total,
      }).select().single();
      await load();
      setPicked({ amount: total, scheduleId: created?.id ?? null });
      return;
    }
    const s = sched ?? schedules.find((x) => x.state !== "paid") ?? schedules[0];
    const remaining = Math.max(0, Number(s.amount || 0) - Number(s.paid_amount || 0));
    setPicked({ amount: remaining > 0 ? remaining : open, scheduleId: s?.id ?? null });
  };

  const sumPct = draft.reduce((s, x) => s + Number(x.percent || 0), 0);
  const sumAmt = draft.reduce((s, x) => s + Number(x.amount || 0), 0);

  // ---------- render ----------
  return (
    <div className="space-y-4">
      {/* Resumo */}
      <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Total da venda" value={fmtMoney(total)} />
        <Stat label="Recebido" value={fmtMoney(paidTotal)} tone="emerald" />
        <Stat label="Em aberto" value={fmtMoney(open)} tone={open > 0 ? "rose" : "muted"} />
        <Stat label="Próximo vencimento" value={nextSchedule ? `${nextSchedule.label} · ${fmtMoney((nextSchedule.amount ?? 0) - (nextSchedule.paid_amount ?? 0))}` : "—"} />
      </Card>

      {/* Plano de pagamento (unificado) */}
      <Card>
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold">Plano de Pagamento</div>
          <div className="flex gap-2">
            {!editing && schedules.length > 0 && (
              <Button size="sm" variant="ghost" onClick={startEdit}>
                <Pencil className="h-4 w-4 mr-1" /> Editar plano
              </Button>
            )}
            {!editing && (
              <Button size="sm" onClick={() => openReceive()} disabled={isLocked || open <= 0}>
                <Receipt className="h-4 w-4 mr-1" /> Receber
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4 mr-1" />Cancelar</Button>
                <Button size="sm" onClick={saveDraft}>Salvar plano</Button>
              </>
            )}
          </div>
        </div>

        {/* Sem plano → modelos rápidos */}
        {!editing && schedules.length === 0 && (
          <div className="p-6 text-center space-y-4">
            <div className="text-sm text-muted-foreground">Escolha um modelo de pagamento para começar:</div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => applyPreset("full_delivery")}>100% na entrega</Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("signal_50")}>50% sinal + 50% entrega</Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("signal_30")}>30% sinal + 70% entrega</Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("split_2x")}>2× (entrega + 30d)</Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("split_3x")}>3× (entrega + 30/60d)</Button>
              <Button variant="ghost" size="sm" onClick={startEdit}>Personalizado…</Button>
            </div>
          </div>
        )}

        {/* Lista unificada de parcelas */}
        {!editing && schedules.length > 0 && (
          <div className="divide-y">
            {schedules.map((s) => {
              const meta = STATE_META[s.state] ?? STATE_META.pending;
              const Icon = meta.icon;
              const remaining = Math.max(0, Number(s.amount || 0) - Number(s.paid_amount || 0));
              const linked = payments.filter((p) => p.schedule_id === s.id);
              const isOpen = expanded[s.id];
              const hasPayments = linked.length > 0;
              return (
                <div key={s.id} className="p-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      onClick={() => hasPayments && setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
                      disabled={!hasPayments}
                    >
                      {hasPayments ? (isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />) : <span className="w-4" />}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {dueLabel(s)}
                        </div>
                      </div>
                    </button>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{fmtMoney(s.amount)}</div>
                      {Number(s.paid_amount || 0) > 0 && (
                        <div className="text-xs text-emerald-600 tabular-nums">Pago {fmtMoney(s.paid_amount)}</div>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.tone}`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </span>
                    <Button
                      size="sm"
                      variant={s.state === "paid" ? "ghost" : "default"}
                      disabled={isLocked || s.state === "paid" || remaining <= 0}
                      onClick={() => openReceive(s)}
                    >
                      <Receipt className="h-4 w-4 mr-1" /> Receber
                    </Button>
                  </div>

                  {hasPayments && isOpen && (
                    <div className="mt-3 ml-6 space-y-1">
                      {linked.map((p) => (
                        <div key={p.id} className={`flex items-center justify-between text-sm rounded-md border px-3 py-2 ${p.state === "cancelled" ? "opacity-50 line-through" : ""}`}>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.payment_date} · {p.payment_methods?.name ?? "—"}{p.reference ? ` · ${p.reference}` : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums font-medium">{fmtMoney(p.amount)}</span>
                            {p.state !== "cancelled" && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelPayment(p.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Modo edição */}
        {editing && (
          <div>
            <div className="px-4 py-2 border-b bg-muted/20 flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted-foreground mr-1">Modelos:</span>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft(recalc(presetRows("full_delivery").map((r) => ({ ...r, order_id: orderId }))))}>100% entrega</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft(recalc(presetRows("signal_50").map((r) => ({ ...r, order_id: orderId }))))}>50/50</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft(recalc(presetRows("signal_30").map((r) => ({ ...r, order_id: orderId }))))}>30/70</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft(recalc(presetRows("split_2x").map((r) => ({ ...r, order_id: orderId }))))}>2× (30d)</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft(recalc(presetRows("split_3x").map((r) => ({ ...r, order_id: orderId }))))}>3× (30/60d)</Button>
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
              </div>
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
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((s, i) => (
                    <tr key={s.id ?? `new-${i}`} className="border-t">
                      <td className="px-2 py-1"><Input className="h-8" value={s.label} onChange={(e) => setRow(i, { label: e.target.value })} /></td>
                      <td className="px-2 py-1">
                        <Select value={s.due_kind} onValueChange={(v) => setRow(i, { due_kind: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(DUE_KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        {s.due_kind === "fixed_date" && <Input className="h-8" type="date" value={s.due_date ?? ""} onChange={(e) => setRow(i, { due_date: e.target.value })} />}
                        {s.due_kind === "days_after_confirm" && <Input className="h-8" type="number" placeholder="dias" value={s.due_days ?? ""} onChange={(e) => setRow(i, { due_days: Number(e.target.value) })} />}
                      </td>
                      <td className="px-2 py-1"><Input className="h-8" type="number" step="0.01" value={s.percent ?? 0} onChange={(e) => setRow(i, { percent: Number(e.target.value) })} /></td>
                      <td className="px-2 py-1"><Input className="h-8 text-right tabular-nums" type="number" step="0.01" value={s.amount ?? 0} onChange={(e) => setRow(i, { amount: Number(e.target.value) })} /></td>
                      <td>
                        <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={s.state === "paid"}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/20 text-xs">
                    <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                      {Math.abs(sumPct - 100) > 0.01
                        ? <span className="text-amber-600">⚠ Soma {sumPct.toFixed(2)}% — última linha será ajustada ao salvar</span>
                        : <span className="text-emerald-600">✓ Soma 100%</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{sumPct.toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(sumAmt)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Card>

      {picked && (
        <RegisterPaymentDialog
          open={!!picked}
          onOpenChange={(v) => { if (!v) setPicked(null); }}
          orderId={orderId}
          partnerId={partnerId}
          defaultAmount={picked.amount}
          onSaved={() => { setPicked(null); load(); }}
        />
      )}
    </div>
  );
}
