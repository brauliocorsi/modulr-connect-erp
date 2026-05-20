import { useEffect, useState } from "react";
// NOTE: gravação direta em `supplier_payments` substituída por RPC
// `supplier_payment_register` (valida fatura, regista autor, idempotente).
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

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
  const [methods, setMethods] = useState<any[]>([]);
  const [form, setForm] = useState({
    amount: defaultAmount ?? 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    reference: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, amount: defaultAmount ?? 0 }));
    (async () => {
      const { data: m } = await supabase
        .from("payment_methods").select("id,name").eq("active", true).order("name");
      setMethods(m ?? []);
      if ((m ?? []).length) setForm((f) => ({ ...f, method_id: f.method_id || m![0].id }));
    })();
  }, [open, defaultAmount]);

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
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Pagamento registado");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pagar fornecedor</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data</Label><Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>
            <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
          </div>
          <div>
            <Label>Método</Label>
            <Select value={form.method_id} onValueChange={(v) => setForm({ ...form, method_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Referência</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
          <div><Label>Notas (opcional)</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "A registar…" : "Registar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
