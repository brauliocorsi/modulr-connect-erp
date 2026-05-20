import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { OperationalStatusBadge } from "@/core/operational";

interface CreditRow {
  id: string;
  amount: number;
  remaining_amount: number;
  state: string;
  reason: string | null;
  origin_payment_id: string | null;
  origin_service_case_id: string | null;
  created_at: string;
}

interface AppRow {
  id: string;
  credit_id: string;
  amount: number;
  applied_at: string;
  notes: string | null;
  sale_order_id: string | null;
  reversed_at: string | null;
}

export function CustomerCreditsPanel({ partnerId }: { partnerId: string }) {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<CreditRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState({ amount: 0, reason: "" });
  const [applyForm, setApplyForm] = useState({ amount: 0, sale_order_id: "", notes: "" });

  const credits = useQuery({
    enabled: !!partnerId,
    queryKey: ["customer_credits", partnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_credits")
        .select("id, amount, remaining_amount, state, reason, origin_payment_id, origin_service_case_id, created_at")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CreditRow[];
    },
  });

  const apps = useQuery({
    enabled: !!partnerId,
    queryKey: ["customer_credit_applications", partnerId],
    queryFn: async () => {
      const ids = (credits.data ?? []).map((c) => c.id);
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("customer_credit_applications")
        .select("id, credit_id, amount, applied_at, notes, sale_order_id, reversed_at")
        .in("credit_id", ids)
        .order("applied_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AppRow[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["customer_credits", partnerId] });
    qc.invalidateQueries({ queryKey: ["customer_credit_applications", partnerId] });
  };

  const create = async () => {
    if (!form.amount || form.amount <= 0) return toast.error("Valor inválido");
    setCreating(true);
    const { error } = await supabase.rpc("create_customer_credit", {
      _partner_id: partnerId,
      _amount: form.amount,
      _reason: form.reason || undefined,
      _idempotency_key: `credit:${partnerId}:${Date.now()}`,
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("Crédito criado");
    setNewOpen(false);
    setForm({ amount: 0, reason: "" });
    refresh();
  };

  const apply = async () => {
    if (!applyTarget) return;
    if (!applyForm.amount || applyForm.amount <= 0) return toast.error("Valor inválido");
    if (applyForm.amount > applyTarget.remaining_amount) return toast.error("Acima do disponível");
    setApplying(true);
    const { error } = await supabase.rpc("apply_customer_credit", {
      _credit_id: applyTarget.id,
      _amount: applyForm.amount,
      _sale_order_id: applyForm.sale_order_id || undefined,
      _notes: applyForm.notes || undefined,
    });
    setApplying(false);
    if (error) return toast.error(error.message);
    toast.success("Crédito aplicado");
    setApplyTarget(null);
    setApplyForm({ amount: 0, sale_order_id: "", notes: "" });
    refresh();
  };

  const list = credits.data ?? [];
  const totalRemaining = list.filter((c) => c.state === "open").reduce((s, c) => s + Number(c.remaining_amount || 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Créditos do cliente</span>
          <span className="text-xs text-muted-foreground">· disponível {fmtMoney(totalRemaining)}</span>
        </div>
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo crédito
        </Button>
      </div>

      {credits.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">A carregar…</div>
      ) : list.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">Sem créditos registados.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Motivo</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-right px-3 py-2">Disponível</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const exhausted = Number(c.remaining_amount) <= 0;
              const canApply = c.state === "open" && !exhausted;
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{new Date(c.created_at).toLocaleDateString("pt-PT")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.reason ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(c.remaining_amount)}</td>
                  <td className="px-3 py-2"><OperationalStatusBadge domain="customer_credit" status={c.state} /></td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canApply}
                      title={!canApply ? "Crédito esgotado ou cancelado" : undefined}
                      onClick={() => {
                        setApplyTarget(c);
                        setApplyForm({ amount: Number(c.remaining_amount), sale_order_id: "", notes: "" });
                      }}
                    >
                      Aplicar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(apps.data ?? []).length > 0 && (
        <div className="border-t">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aplicações</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-right px-3 py-2">Valor</th>
                <th className="text-left px-3 py-2">Venda</th>
                <th className="text-left px-3 py-2">Notas</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(apps.data ?? []).map((a) => (
                <tr key={a.id} className={`border-t ${a.reversed_at ? "opacity-60 line-through" : ""}`}>
                  <td className="px-3 py-2">{new Date(a.applied_at).toLocaleDateString("pt-PT")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(a.amount)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.sale_order_id ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{a.notes ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.reversed_at ? "Revertida" : "Ativa"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Novo crédito */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo crédito ao cliente</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Motivo</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex: nota de crédito por avaria" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={create} disabled={creating}>{creating ? "A criar…" : "Criar crédito"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aplicar crédito */}
      <Dialog open={!!applyTarget} onOpenChange={(o) => !o && setApplyTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aplicar crédito</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="text-sm text-muted-foreground">
              Disponível: <strong>{fmtMoney(applyTarget?.remaining_amount ?? 0)}</strong>
            </div>
            <div>
              <Label>Valor a aplicar</Label>
              <Input type="number" step="0.01" value={applyForm.amount} onChange={(e) => setApplyForm({ ...applyForm, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>ID da venda (opcional)</Label>
              <Input value={applyForm.sale_order_id} onChange={(e) => setApplyForm({ ...applyForm, sale_order_id: e.target.value })} placeholder="UUID da sale_order" />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={applyForm.notes} onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApplyTarget(null)} disabled={applying}>Cancelar</Button>
            <Button onClick={apply} disabled={applying}>{applying ? "A aplicar…" : "Aplicar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
