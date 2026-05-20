import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { usePermissions } from "@/core/permissions/usePermissions";
import { useAuth } from "@/core/auth/AuthProvider";

const ERROR_PT: Record<string, string> = {
  user_without_store: "Este utilizador não está associado a nenhuma loja.",
  no_open_cash_session_for_store: "Não há caixa aberto para a sua loja.",
  multiple_open_cash_sessions: "Selecione um caixa aberto da sua loja.",
  cash_session_not_allowed: "Este caixa não pertence à sua loja.",
  payment_method_requires_reference: "Este método exige referência.",
};

type SessionInfo = {
  session_id: string;
  register_id: string;
  register_name: string;
  store_id: string;
  store_name: string;
  opened_at: string;
};

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
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPaid, setOrderPaid] = useState(0);
  const [schedAmount, setSchedAmount] = useState<number | null>(null);
  const [schedPaid, setSchedPaid] = useState(0);
  const [cashStatus, setCashStatus] = useState<{
    status: "ok" | "no_store" | "no_open_session" | "multiple_open_sessions" | "loading";
    sessions: SessionInfo[];
    default_session_id?: string;
  }>({ status: "loading", sessions: [] });
  const [form, setForm] = useState({
    amount: 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    cash_session_id: "",
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

  const currentMethod = useMemo(
    () => methods.find((m) => m.id === form.method_id),
    [methods, form.method_id],
  );
  const isCash = !!currentMethod?.feeds_cash_session;

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: m }, { data: order }, { data: pays }] = await Promise.all([
        supabase
          .from("payment_methods")
          .select("id,name,confirmation_mode,requires_reference,feeds_cash_session,default_journal_id")
          .eq("active", true)
          .order("name"),
        supabase.from("sale_orders").select("amount_total").eq("id", orderId).maybeSingle(),
        supabase.from("customer_payments").select("amount, schedule_id, state").eq("order_id", orderId).neq("state", "cancelled"),
      ]);
      setMethods(m ?? []);
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
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, scheduleId, defaultAmount]);

  // Load cash session info when method changes to cash
  useEffect(() => {
    if (!open || !isCash) {
      if (!isCash) setForm((f) => ({ ...f, cash_session_id: "" }));
      return;
    }
    setCashStatus({ status: "loading", sessions: [] });
    (async () => {
      const { data, error } = await supabase.rpc("cash_session_for_current_user", { _store_id: null } as any);
      if (error) {
        setCashStatus({ status: "no_open_session", sessions: [] });
        return;
      }
      const r = data as any;
      setCashStatus({
        status: r.status,
        sessions: r.sessions ?? [],
        default_session_id: r.default_session_id,
      });
      if (r.status === "ok" && r.default_session_id) {
        setForm((f) => ({ ...f, cash_session_id: r.default_session_id }));
      } else {
        setForm((f) => ({ ...f, cash_session_id: "" }));
      }
    })();
  }, [open, isCash]);

  const onMethodChange = (id: string) => {
    setForm((f) => ({ ...f, method_id: id, cash_session_id: "" }));
  };

  const cashBlocked = isCash && cashStatus.status !== "ok" && !(cashStatus.status === "multiple_open_sessions" && form.cash_session_id);
  const cashHelp =
    isCash && cashStatus.status === "no_store" ? ERROR_PT.user_without_store :
    isCash && cashStatus.status === "no_open_session" ? ERROR_PT.no_open_cash_session_for_store :
    isCash && cashStatus.status === "multiple_open_sessions" && !form.cash_session_id ? ERROR_PT.multiple_open_cash_sessions :
    "";

  const save = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    if (form.amount > maxAllowed + 0.01) {
      return toast.error(`Valor excede o em aberto (${fmtMoney(maxAllowed)})`);
    }
    if (!form.method_id) return toast.error("Escolha um método");
    if (currentMethod?.requires_reference && !form.reference) return toast.error(ERROR_PT.payment_method_requires_reference);
    if (isCash && cashBlocked) return toast.error(cashHelp || ERROR_PT.no_open_cash_session_for_store);

    const idem = `ui:${orderId}:${scheduleId ?? "none"}:${form.payment_date}:${form.amount}:${form.method_id}`;
    const { error } = await supabase.rpc("register_customer_payment", {
      _order: orderId,
      _amount: form.amount,
      _method: form.method_id,
      _journal: null,
      _schedule: scheduleId ?? null,
      _reference: form.reference || null,
      _idempotency_key: idem,
      _payment_date: form.payment_date,
      _notes: form.notes || null,
      _cash_session_id: isCash ? (form.cash_session_id || null) : null,
    } as any);
    if (error) {
      const key = (error.message || "").trim();
      return toast.error(ERROR_PT[key] ?? error.message);
    }
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

          <div>
            <Label>Método</Label>
            <Select value={form.method_id} onValueChange={onMethodChange}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {/* CASH: caixa da loja do user */}
          {isCash && (
            <div className="rounded-md border p-3 bg-muted/20 space-y-2" data-testid="cash-block">
              <Label className="text-xs uppercase text-muted-foreground">Caixa físico</Label>
              {cashStatus.status === "loading" && <div className="text-sm text-muted-foreground">A carregar caixa…</div>}
              {cashStatus.status === "ok" && cashStatus.sessions[0] && (
                <div className="text-sm font-medium">
                  Caixa: {cashStatus.sessions[0].store_name} / {cashStatus.sessions[0].register_name}
                </div>
              )}
              {cashStatus.status === "multiple_open_sessions" && (
                <Select value={form.cash_session_id} onValueChange={(v) => setForm({ ...form, cash_session_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione caixa aberto…" /></SelectTrigger>
                  <SelectContent>
                    {cashStatus.sessions.map((s) => (
                      <SelectItem key={s.session_id} value={s.session_id}>
                        {s.store_name} / {s.register_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {cashHelp && <div className="text-xs text-rose-600">{cashHelp}</div>}
            </div>
          )}

          {/* Non-cash: vai para conciliação */}
          {!isCash && currentMethod && (
            <div className="rounded-md border p-3 bg-muted/20 flex items-center gap-2" data-testid="noncash-block">
              <Badge variant="secondary">Vai para conciliação</Badge>
              <span className="text-xs text-muted-foreground">Não entra no caixa físico.</span>
            </div>
          )}

          <div>
            <Label>
              Referência {currentMethod?.requires_reference && <span className="text-rose-600">*</span>}
            </Label>
            <Input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="Nº recibo, transferência…"
              required={!!currentMethod?.requires_reference}
            />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={save}
            disabled={form.amount <= 0 || form.amount > maxAllowed + 0.01 || (isCash && cashBlocked)}
          >
            Registar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
