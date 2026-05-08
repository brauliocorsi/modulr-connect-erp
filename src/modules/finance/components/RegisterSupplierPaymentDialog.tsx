import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function RegisterSupplierPaymentDialog({
  open, onOpenChange, billId, partnerId, defaultAmount, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  billId: string;
  partnerId?: string | null;
  defaultAmount?: number;
  onSaved?: () => void;
}) {
  const [methods, setMethods] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [centers, setCenters] = useState<any[]>([]);
  const [form, setForm] = useState({
    amount: defaultAmount ?? 0,
    payment_date: new Date().toISOString().slice(0, 10),
    method_id: "",
    journal_id: "",
    cost_center_id: "",
    reference: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, amount: defaultAmount ?? 0 }));
    (async () => {
      const [{ data: m }, { data: j }, { data: c }] = await Promise.all([
        supabase.from("payment_methods").select("id,name,default_journal_id").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name,type").eq("active", true).order("name"),
        supabase.from("cost_centers").select("id,name,code").eq("active", true).order("code"),
      ]);
      setMethods(m ?? []);
      setJournals(j ?? []);
      setCenters(c ?? []);
      if ((m ?? []).length) {
        const first = m![0];
        setForm((f) => ({ ...f, method_id: first.id, journal_id: first.default_journal_id ?? (j?.[0]?.id ?? "") }));
      }
    })();
  }, [open, defaultAmount]);

  const save = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    const { data: seq } = await supabase.rpc("next_sequence", { _code: "supplier_payment" });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("supplier_payments").insert({
      name: seq ?? "SPAY",
      bill_id: billId,
      partner_id: partnerId ?? null,
      payment_date: form.payment_date,
      amount: form.amount,
      method_id: form.method_id || null,
      journal_id: form.journal_id || null,
      cost_center_id: form.cost_center_id || null,
      reference: form.reference || null,
      notes: form.notes || null,
      state: "posted",
      created_by: user?.id,
    });
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
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Método</Label>
              <Select value={form.method_id} onValueChange={(v) => setForm({ ...form, method_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Diário</Label>
              <Select value={form.journal_id} onValueChange={(v) => setForm({ ...form, journal_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Centro de Custo</Label>
            <Select value={form.cost_center_id} onValueChange={(v) => setForm({ ...form, cost_center_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Referência</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
          <div><Label>Notas</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save}>Registar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
