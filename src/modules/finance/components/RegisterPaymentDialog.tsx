import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

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
  const [form, setForm] = useState({
    amount: defaultAmount ?? 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    journal_id: "",
    reference: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, amount: defaultAmount ?? 0 }));
    (async () => {
      const [{ data: m }, { data: j }] = await Promise.all([
        supabase.from("payment_methods").select("id,name,default_journal_id,confirmation_mode,requires_reference").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name,type").eq("active", true).order("name"),
      ]);
      setMethods(m ?? []);
      setJournals(j ?? []);
      if ((m ?? []).length && !form.method_id) {
        const first = (m ?? [])[0];
        setForm((f) => ({ ...f, method_id: first.id, journal_id: first.default_journal_id ?? (j?.[0]?.id ?? "") }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAmount]);

  const onMethodChange = (id: string) => {
    const m = methods.find((x) => x.id === id);
    setForm((f) => ({ ...f, method_id: id, journal_id: m?.default_journal_id ?? f.journal_id }));
  };

  const save = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
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
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data</Label>
              <Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
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
          <Button onClick={save}>Registar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
