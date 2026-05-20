import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const CATEGORIES = [
  "Renda", "Internet", "Eletricidade", "Água", "Seguros",
  "Software", "Viatura", "Contabilidade", "Outro",
];

const FREQUENCIES = [
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "quarterly", label: "Trimestral" },
  { value: "yearly", label: "Anual" },
  { value: "custom", label: "Personalizada" },
];

export type RecurringExpense = {
  id: string;
  name: string;
  supplier_id: string | null;
  category: string;
  amount: number;
  frequency: string;
  next_due_date: string;
  payment_method_id: string | null;
  notes: string | null;
};

export function RecurringExpenseDialog({
  open, onOpenChange, expense, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expense: RecurringExpense | null;
  onSaved?: () => void;
}) {
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [methods, setMethods] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    supplier_id: "",
    category: CATEGORIES[0],
    amount: 0,
    frequency: "monthly",
    next_due_date: new Date().toISOString().slice(0, 10),
    payment_method_id: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: s }, { data: m }] = await Promise.all([
        supabase.from("partners").select("id,name").eq("is_supplier", true).order("name").limit(500),
        supabase.from("payment_methods").select("id,name").eq("active", true).order("name"),
      ]);
      setSuppliers(s ?? []);
      setMethods(m ?? []);
    })();
    if (expense) {
      setForm({
        name: expense.name,
        supplier_id: expense.supplier_id ?? "",
        category: expense.category,
        amount: Number(expense.amount),
        frequency: expense.frequency,
        next_due_date: expense.next_due_date,
        payment_method_id: expense.payment_method_id ?? "",
        notes: expense.notes ?? "",
      });
    } else {
      setForm({
        name: "", supplier_id: "", category: CATEGORIES[0], amount: 0,
        frequency: "monthly", next_due_date: new Date().toISOString().slice(0, 10),
        payment_method_id: "", notes: "",
      });
    }
  }, [open, expense]);

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    if (!form.next_due_date) return toast.error("Próxima data obrigatória");
    if (!form.frequency) return toast.error("Frequência obrigatória");

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      supplier_id: form.supplier_id || null,
      category: form.category,
      amount: form.amount,
      frequency: form.frequency,
      next_due_date: form.next_due_date,
      payment_method_id: form.payment_method_id || null,
      notes: form.notes || null,
    };
    const { data, error } = expense
      ? await supabase.rpc("recurring_expense_update", { _expense_id: expense.id, _payload: payload })
      : await supabase.rpc("recurring_expense_create", { _payload: payload });
    setSaving(false);
    if (error) return toast.error(error.message);
    const res: any = data;
    if (res?.error) return toast.error(res.error);
    toast.success(expense ? "Despesa atualizada" : "Despesa criada");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{expense ? "Editar despesa fixa" : "Nova despesa fixa"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Renda escritório" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Frequência</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Próxima data</Label>
              <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Fornecedor (opcional)</Label>
            <Select value={form.supplier_id || "__none__"} onValueChange={(v) => setForm({ ...form, supplier_id: v === "__none__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Sem fornecedor —</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Método de pagamento (opcional)</Label>
            <Select value={form.payment_method_id || "__none__"} onValueChange={(v) => setForm({ ...form, payment_method_id: v === "__none__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhum —</SelectItem>
                {methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "A guardar…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
