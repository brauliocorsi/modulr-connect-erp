import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  ["general_question", "Dúvida"],
  ["order_status", "Status do pedido"],
  ["delivery_schedule", "Agenda entrega"],
  ["payment_question", "Pagamento"],
  ["damaged_product", "Produto danificado"],
  ["missing_part", "Peça em falta"],
  ["warranty_claim", "Garantia"],
  ["return_request", "Devolução"],
  ["complaint", "Reclamação"],
  ["other", "Outro"],
] as const;
const PRIORITIES = [
  ["low", "Baixa"], ["normal", "Normal"], ["high", "Alta"], ["urgent", "Urgente"],
] as const;

type Partner = { id: string; name: string };

export function NewTicketDialog({ onCreated }: { onCreated?: (id: string) => void }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Partner[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("general_question");
  const [priority, setPriority] = useState<string>("normal");

  const reset = () => {
    setSubmitting(false); setCustomerSearch(""); setCustomers([]); setCustomerId("");
    setSubject(""); setDescription(""); setCategory("general_question"); setPriority("normal");
  };

  const searchCustomers = async (q: string) => {
    setCustomerSearch(q);
    if (q.trim().length < 2) { setCustomers([]); return; }
    const { data } = await supabase
      .from("partners")
      .select("id,name")
      .ilike("name", `%${q}%`)
      .eq("is_customer", true)
      .order("name")
      .limit(20);
    setCustomers((data ?? []) as Partner[]);
  };

  const submit = async () => {
    if (!customerId) return toast.error("Selecione o cliente");
    if (!subject.trim()) return toast.error("Informe o assunto");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("helpdesk_ticket_create" as any, {
      _payload: {
        customer_id: customerId,
        subject: subject.trim(),
        description: description.trim() || null,
        category,
        priority,
        source: "agent",
      },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Ticket criado");
    const id = (data as unknown as string) || "";
    setOpen(false);
    reset();
    if (id) {
      onCreated?.(id);
      nav(`/helpdesk/tickets/${id}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="helpdesk-new-ticket-btn">
          <Plus className="h-4 w-4 mr-1" /> Novo Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Input
              placeholder="Buscar cliente…"
              value={customerSearch}
              onChange={(e) => searchCustomers(e.target.value)}
            />
            {customers.length > 0 && (
              <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                {customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCustomerId(c.id); setCustomerSearch(c.name); setCustomers([]); }}
                    className="w-full text-left px-2 py-1.5 hover:bg-accent text-sm"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {customerId && <div className="text-xs text-muted-foreground">ID: {customerId}</div>}
          </div>
          <div className="space-y-1.5">
            <Label>Assunto *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Resumo do ticket" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhes do ticket…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting} data-testid="helpdesk-new-ticket-submit">
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
