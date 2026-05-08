import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const KINDS = [
  { value: "withdrawal", label: "Retirada", sign: -1 },
  { value: "expense", label: "Despesa", sign: -1 },
  { value: "bonus", label: "Bónus", sign: -1 },
  { value: "advance", label: "Adiantamento", sign: -1 },
  { value: "sangria", label: "Sangria", sign: -1 },
  { value: "deposit", label: "Reforço", sign: 1 },
];

export function CashMovementDialog({
  open, onOpenChange, sessionId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  onSaved?: () => void;
}) {
  const [kind, setKind] = useState("withdrawal");
  const [amount, setAmount] = useState<number>(0);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const save = async () => {
    if (!amount || amount <= 0) return toast.error("Valor inválido");
    const k = KINDS.find((x) => x.value === kind);
    const signed = (k?.sign ?? -1) * Math.abs(amount);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("cash_movements").insert({
      session_id: sessionId,
      kind,
      amount: signed,
      reference: reference || null,
      notes: notes || null,
      created_by: user?.id,
      user_id: user?.id,
    });
    if (error) return toast.error(error.message);
    toast.success("Movimento registado");
    onOpenChange(false);
    setAmount(0); setReference(""); setNotes("");
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registar movimento de caixa</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>Referência / beneficiário</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
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
