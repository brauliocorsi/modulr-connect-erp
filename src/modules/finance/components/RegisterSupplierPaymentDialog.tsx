import { useEffect, useState } from "react";
// NOTE: gravação direta em `supplier_payments` substituída por RPC
// `supplier_payment_register` (valida fatura, regista autor, idempotente,
// aceita centro de custo / plano de contas / diário desde F28-FIN B).
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AttachmentsField, type Attachment } from "@/modules/finance/components/AttachmentsField";

type Opt = { id: string; name: string; code?: string | null };

export function RegisterSupplierPaymentDialog({
  open, onOpenChange, billId, partnerId: _partnerId, defaultAmount, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  billId: string;
  partnerId?: string | null;
  defaultAmount?: number;
  onSaved?: () => void;
}) {
  const [methods, setMethods] = useState<Opt[]>([]);
  const [costCenters, setCostCenters] = useState<Opt[]>([]);
  const [accounts, setAccounts] = useState<Opt[]>([]);
  const [journals, setJournals] = useState<Opt[]>([]);
  const [form, setForm] = useState({
    amount: defaultAmount ?? 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    cost_center_id: "",
    account_id: "",
    journal_id: "",
    reference: "",
    notes: "",
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, amount: defaultAmount ?? 0 }));
    (async () => {
      const [{ data: m }, { data: cc }, { data: acc }, { data: j }, { data: bill }] = await Promise.all([
        supabase.from("payment_methods").select("id,name").eq("active", true).order("name"),
        supabase.from("cost_centers").select("id,name,code").eq("active", true).order("name"),
        supabase.from("chart_of_accounts").select("id,name,code,type").eq("active", true).in("type", ["expense","liability","asset"]).order("code"),
        supabase.from("account_journals").select("id,name").eq("active", true).order("name"),
        supabase.from("supplier_bills").select("cost_center_id,account_id").eq("id", billId).maybeSingle(),
      ]);
      setMethods(m ?? []);
      setCostCenters(cc ?? []);
      setAccounts(acc ?? []);
      setJournals(j ?? []);
      setForm((f) => ({
        ...f,
        method_id: f.method_id || (m?.[0]?.id ?? ""),
        cost_center_id: f.cost_center_id || (bill?.cost_center_id ?? ""),
        account_id: f.account_id || (bill?.account_id ?? ""),
      }));
    })();
  }, [open, defaultAmount, billId]);

  const save = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    setSaving(true);
    const idempotencyKey = `${billId}:${form.payment_date}:${form.amount}:${Date.now()}`;
    const { error } = await supabase.rpc("supplier_payment_register", {
      _bill_id: billId,
      _amount: form.amount,
      _payment_date: form.payment_date,
      _method_id: form.method_id || undefined,
      _reference: form.reference || undefined,
      _idempotency_key: idempotencyKey,
      _cost_center_id: form.cost_center_id || undefined,
      _account_id: form.account_id || undefined,
      _journal_id: form.journal_id || undefined,
    } as any);
    if (error) { setSaving(false); return toast.error(error.message); }
    if (attachments.length) {
      const { data: pay } = await supabase
        .from("supplier_payments")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (pay?.id) {
        await supabase.rpc("supplier_payment_set_attachments", { _payment_id: pay.id, _attachments: attachments as any });
      }
    }
    setSaving(false);
    toast.success("Pagamento registado");
    setAttachments([]);
    onOpenChange(false);
    onSaved?.();
  };

  const NoneItem = <SelectItem value="__none__">— Nenhum —</SelectItem>;
  const handle = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v === "__none__" ? "" : v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Pagar fornecedor</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data</Label><Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>
            <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método</Label>
              <Select value={form.method_id} onValueChange={(v) => setForm({ ...form, method_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Diário / conta financeira</Label>
              <Select value={form.journal_id || "__none__"} onValueChange={handle("journal_id")}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{NoneItem}{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Centro de custo</Label>
              <Select value={form.cost_center_id || "__none__"} onValueChange={handle("cost_center_id")}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{NoneItem}{costCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.code ? `${c.code} · ` : ""}{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Conta (plano de contas)</Label>
              <Select value={form.account_id || "__none__"} onValueChange={handle("account_id")}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{NoneItem}{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Referência</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
          <div><Label>Notas (opcional)</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="rounded-md border p-3">
            <AttachmentsField
              value={attachments}
              onChange={setAttachments}
              folder={`payments/${billId}`}
              label="Anexos do pagamento"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "A registar…" : "Registar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
