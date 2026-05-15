import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { usePermissions } from "@/core/permissions/usePermissions";

type FormState = {
  product_id: string;
  qty: string;
  priority: "low" | "normal" | "high" | "urgent";
  origin: "manual" | "replenishment" | "rework" | "other";
  planned_start: string;
  planned_end: string;
  due_date: string;
  responsible_id: string;
  notes: string;
};

const init: FormState = {
  product_id: "",
  qty: "1",
  priority: "normal",
  origin: "manual",
  planned_start: "",
  planned_end: "",
  due_date: "",
  responsible_id: "",
  notes: "",
};

export default function CreateManualMODialog() {
  const { isAdmin, inGroup } = usePermissions();
  const allowed = isAdmin || inGroup("production_manager");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(init);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: products } = useQuery({
    queryKey: ["mfg-manual-products"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,internal_ref")
        .eq("can_be_manufactured", true)
        .eq("active", true)
        .order("name")
        .limit(500);
      return data ?? [];
    },
  });

  const { data: users } = useQuery({
    queryKey: ["mfg-manual-users"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,email").order("full_name").limit(500);
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.product_id) throw new Error("Selecione um produto");
      const qty = Number(form.qty);
      if (!(qty > 0)) throw new Error("Quantidade deve ser maior que zero");
      const { data, error } = await supabase.rpc("mfg_create_manual_mo", {
        _product: form.product_id,
        _variant: null,
        _qty: qty,
        _priority: form.priority,
        _planned_start: form.planned_start ? new Date(form.planned_start).toISOString() : null,
        _planned_end: form.planned_end ? new Date(form.planned_end).toISOString() : null,
        _due: form.due_date || null,
        _responsible: form.responsible_id || null,
        _notes: form.notes || null,
        _origin: form.origin,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Ordem de fabricação criada");
      qc.invalidateQueries({ queryKey: ["manufacturing_orders"] });
      qc.invalidateQueries({ queryKey: ["mfg-dashboard"] });
      setOpen(false);
      setForm(init);
      if (id) navigate(`/manufacturing/orders/${id}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar ordem"),
  });

  if (!allowed) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Criar Ordem de Produção</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova ordem de produção</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Produto a fabricar *</Label>
            <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione um produto fabricável" /></SelectTrigger>
              <SelectContent>
                {products?.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.internal_ref ? `[${p.internal_ref}] ` : ""}{p.name}</SelectItem>
                ))}
                {products && products.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum produto fabricável.</div>}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Quantidade *</Label>
            <Input type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={form.priority} onValueChange={(v: any) => setForm({ ...form, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Baixa</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Origem</Label>
            <Select value={form.origin} onValueChange={(v: any) => setForm({ ...form, origin: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="replenishment">Reposição de stock</SelectItem>
                <SelectItem value="rework">Retrabalho</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Responsável</Label>
            <Select value={form.responsible_id} onValueChange={(v) => setForm({ ...form, responsible_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {users?.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Início previsto</Label>
            <Input type="datetime-local" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })} />
          </div>
          <div>
            <Label>Conclusão prevista</Label>
            <Input type="datetime-local" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Prazo (data)</Label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "A criar…" : "Criar ordem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
