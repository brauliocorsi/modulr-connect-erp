import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";

export function RegisterPaymentDialog({
  open,
  onOpenChange,
  orderId,
  partnerId,
  defaultAmount,
  scheduleId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  partnerId?: string | null;
  defaultAmount?: number;
  scheduleId?: string | null;
  onSaved?: () => void;
}) {
  const [methods, setMethods] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPaid, setOrderPaid] = useState(0);
  const [schedAmount, setSchedAmount] = useState<number | null>(null);
  const [schedPaid, setSchedPaid] = useState(0);
  const [form, setForm] = useState({
    amount: 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    journal_id: "",
    reference: "",
    notes: "",
  });

  const orderOpen = useMemo(() => Math.max(0, +(orderTotal - orderPaid).toFixed(2)), [orderTotal, orderPaid]);
  const schedOpen = useMemo(
    () => (schedAmount == null ? null : Math.max(0, +(schedAmount - schedPaid).toFixed(2))),
    [schedAmount, schedPaid],
  );
  const maxAllowed = useMemo(() => {
    const caps = [orderOpen, schedOpen ?? Infinity];
    return Math.min(...caps);
  }, [orderOpen, schedOpen]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: m }, { data: j }, { data: order }, { data: pays }] = await Promise.all([
        supabase.from("payment_methods").select("id,name,default_journal_id,confirmation_mode,requires_reference").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name,type").eq("active", true).order("name"),
        supabase.from("sale_orders").select("amount_total").eq("id", orderId).maybeSingle(),
        supabase.from("customer_payments").select("amount, schedule_id, state").eq("order_id", orderId).neq("state", "cancelled"),
      ]);
      setMethods(m ?? []);
      setJournals(j ?? []);
      const total = Number(order?.amount_total ?? 0);
      const paidAll = (pays ?? []).reduce((a, p: any) => a + Number(p.amount || 0), 0);
      setOrderTotal(total);
      setOrderPaid(paidAll);

      let sAmount: number | null = null;
      let sPaid = 0;
      if (scheduleId) {
        const { data: s } = await supabase.from("sale_payment_schedules").select("amount").eq("id", scheduleId).maybeSingle();
        sAmount = Number(s?.amount ?? 0);
        sPaid = (pays ?? []).filter((p: any) => p.schedule_id === scheduleId).reduce((a, p: any) => a + Number(p.amount || 0), 0);
      }
      setSchedAmount(sAmount);
      setSchedPaid(sPaid);

      const orderOpenLocal = Math.max(0, +(total - paidAll).toFixed(2));
      const schedOpenLocal = sAmount == null ? Infinity : Math.max(0, +(sAmount - sPaid).toFixed(2));
      const cap = Math.min(orderOpenLocal, schedOpenLocal);
      const proposed = Math.min(defaultAmount ?? cap, cap);

      setForm((f) => ({
        ...f,
        amount: proposed,
        method_id: f.method_id || ((m ?? [])[0]?.id ?? ""),
        journal_id: f.journal_id || ((m ?? [])[0]?.default_journal_id ?? (j?.[0]?.id ?? "")),
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, scheduleId, defaultAmount]);

  const onMethodChange = (id: string) => {
    const m = methods.find((x) => x.id === id);
    setForm((f) => ({ ...f, method_id: id, journal_id: m?.default_journal_id ?? f.journal_id }));
  };

  const save = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    if (form.amount > maxAllowed + 0.01) {
      return toast.error(`Valor excede o em aberto (${fmtMoney(maxAllowed)})`);
    }
    if (!form.method_id) return toast.error("Escolha um método");
    if (!form.journal_id) return toast.error("Escolha um diário");
    const method = methods.find((x) => x.id === form.method_id);
    if (method?.requires_reference && !form.reference) return toast.error("Este método exige referência");
    const initialState =
      method?.confirmation_mode === "pending_finance" ? "pending"
      : method?.confirmation_mode === "pending_delivery" ? "pending_delivery"
      : "posted";
    const { data: seq } = await supabase.rpc("next_sequence", { _code: "customer_payment" });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("customer_payments").insert({
      name: seq ?? "PAY",
      partner_id: partnerId ?? null,
      order_id: orderId,
      schedule_id: scheduleId ?? null,
      payment_date: form.payment_date,
      amount: form.amount,
      method_id: form.method_id,
      journal_id: form.journal_id,
      reference: form.reference || null,
      notes: form.notes || null,
      state: initialState,
      created_by: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Recebimento registado");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registar recebimento</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs text-muted-foreground">Total venda</div>
            <div className="tabular-nums font-medium">{fmtMoney(orderTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Já recebido</div>
            <div className="tabular-nums font-medium">{fmtMoney(orderPaid)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Em aberto</div>
            <div className={`tabular-nums font-semibold ${orderOpen > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
              {fmtMoney(orderOpen)}
            </div>
          </div>
          {schedAmount != null && (
            <div className="col-span-3 text-xs text-muted-foreground border-t pt-2">
              Parcela: {fmtMoney(schedPaid)} / {fmtMoney(schedAmount)} · em aberto {fmtMoney(schedOpen ?? 0)}
            </div>
          )}
        </div>

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data</Label>
              <Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
            </div>
            <div>
              <Label>Valor</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  max={maxAllowed}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, amount: maxAllowed })} disabled={maxAllowed <= 0}>
                  Tudo
                </Button>
              </div>
              {form.amount > maxAllowed + 0.01 && (
                <div className="text-xs text-rose-600 mt-1">Excede o em aberto ({fmtMoney(maxAllowed)})</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método</Label>
              <Select value={form.method_id} onValueChange={onMethodChange}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Diário</Label>
              <Select value={form.journal_id} onValueChange={(v) => setForm({ ...form, journal_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Referência</Label>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Nº recibo, transferência…" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={form.amount <= 0 || form.amount > maxAllowed + 0.01}>Registar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
