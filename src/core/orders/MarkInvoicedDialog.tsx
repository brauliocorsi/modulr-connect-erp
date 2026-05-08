import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function MarkInvoicedDialog({
  open, onOpenChange, orderId, current, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  current?: { invoice_number?: string | null; invoice_date?: string | null; invoice_notes?: string | null };
  onSaved?: () => void;
}) {
  const [num, setNum] = useState(current?.invoice_number ?? "");
  const [date, setDate] = useState(current?.invoice_date ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(current?.invoice_notes ?? "");

  const save = async () => {
    const { error } = await supabase.from("sale_orders").update({
      invoice_status: "invoiced",
      invoice_number: num || null,
      invoice_date: date || null,
      invoice_notes: notes || null,
    }).eq("id", orderId);
    if (error) return toast.error(error.message);
    toast.success("Marcado como faturado");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Marcar como faturado</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nº da fatura</Label>
              <Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="FT 2025/123" />
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save}>Confirmar faturação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
