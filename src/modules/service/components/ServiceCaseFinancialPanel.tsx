import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { SummaryCards } from "@/core/operational";
import { Plus, Receipt, Wrench } from "lucide-react";

interface CostRow {
  id: string;
  kind: string;
  description: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier_id: string | null;
  created_at: string;
}

interface ChargeRow {
  id: string;
  kind: string;
  amount: number;
  partner_id: string;
  notes: string | null;
  customer_credit_id: string | null;
  customer_payment_id: string | null;
  created_at: string;
}

const COST_KINDS = [
  { value: "internal_labor", label: "Mão-de-obra interna" },
  { value: "internal_parts", label: "Peças internas" },
  { value: "supplier_repair", label: "Reparação fornecedor" },
  { value: "supplier_parts", label: "Peças fornecedor" },
  { value: "other", label: "Outro" },
];

const CHARGE_KINDS = [
  { value: "invoice", label: "Fatura" },
  { value: "payment", label: "Pagamento direto" },
  { value: "credit", label: "Crédito aplicado" },
  { value: "refund", label: "Reembolso" },
];

/**
 * Painel financeiro embutível por service case.
 * Usa exclusivamente RPCs (service_case_cost_add / service_case_charge_add).
 * Não cria pagamentos novos — backend resolve isso.
 */
export function ServiceCaseFinancialPanel({
  serviceCaseId,
  customerId,
  warrantyStatus,
}: {
  serviceCaseId: string;
  customerId?: string | null;
  /** Se 'in_warranty', cobrança ao cliente fica disabled. */
  warrantyStatus?: string | null;
}) {
  const qc = useQueryClient();
  const [costOpen, setCostOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [savingCost, setSavingCost] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);

  const [costForm, setCostForm] = useState({
    kind: "internal_labor",
    description: "",
    quantity: 1,
    unit_cost: 0,
    supplier_id: "",
    notes: "",
  });
  const [chargeForm, setChargeForm] = useState({
    kind: "invoice",
    amount: 0,
    notes: "",
  });

  const costs = useQuery({
    enabled: !!serviceCaseId,
    queryKey: ["service_case_costs", serviceCaseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_case_costs")
        .select("id, kind, description, quantity, unit_cost, total_cost, supplier_id, created_at")
        .eq("service_case_id", serviceCaseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CostRow[];
    },
  });

  const charges = useQuery({
    enabled: !!serviceCaseId,
    queryKey: ["service_case_charges", serviceCaseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_case_charges")
        .select("id, kind, amount, partner_id, notes, customer_credit_id, customer_payment_id, created_at")
        .eq("service_case_id", serviceCaseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChargeRow[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["service_case_costs", serviceCaseId] });
    qc.invalidateQueries({ queryKey: ["service_case_charges", serviceCaseId] });
  };

  const totalCost = (costs.data ?? []).reduce((s, c) => s + Number(c.total_cost || 0), 0);
  const totalCharged = (charges.data ?? []).reduce((s, c) => s + Number(c.amount || 0), 0);
  const net = totalCharged - totalCost;

  const isWarranty = warrantyStatus === "in_warranty" || warrantyStatus === "warranty";
  const chargeDisabledReason = isWarranty
    ? "Caso em garantia — sem cobrança ao cliente"
    : !customerId
      ? "Sem cliente associado"
      : null;

  const addCost = async () => {
    if (!costForm.description.trim()) return toast.error("Descrição obrigatória");
    if (costForm.unit_cost < 0) return toast.error("Custo inválido");
    setSavingCost(true);
    const { error } = await supabase.rpc("service_case_cost_add", {
      _service_case_id: serviceCaseId,
      _kind: costForm.kind,
      _description: costForm.description.trim(),
      _quantity: costForm.quantity,
      _unit_cost: costForm.unit_cost,
      _supplier_id: costForm.supplier_id || undefined,
      _notes: costForm.notes || undefined,
    });
    setSavingCost(false);
    if (error) return toast.error(error.message);
    toast.success("Custo adicionado");
    setCostOpen(false);
    setCostForm({ kind: "internal_labor", description: "", quantity: 1, unit_cost: 0, supplier_id: "", notes: "" });
    refresh();
  };

  const addCharge = async () => {
    if (!customerId) return toast.error("Sem cliente");
    if (!chargeForm.amount || chargeForm.amount <= 0) return toast.error("Valor inválido");
    setSavingCharge(true);
    const { error } = await supabase.rpc("service_case_charge_add", {
      _service_case_id: serviceCaseId,
      _partner_id: customerId,
      _amount: chargeForm.amount,
      _kind: chargeForm.kind,
      _notes: chargeForm.notes || undefined,
    });
    setSavingCharge(false);
    if (error) return toast.error(error.message);
    toast.success("Cobrança registada");
    setChargeOpen(false);
    setChargeForm({ kind: "invoice", amount: 0, notes: "" });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SummaryCards
        items={[
          { key: "cost", label: "Custos totais", value: fmtMoney(totalCost), tone: "warning" },
          { key: "charged", label: "Cobrado", value: fmtMoney(totalCharged), tone: "primary" },
          { key: "net", label: "Resultado", value: fmtMoney(net), tone: net >= 0 ? "success" : "danger" },
        ]}
      />

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 font-semibold"><Wrench className="h-4 w-4" /> Custos</div>
          <Button size="sm" onClick={() => setCostOpen(true)}><Plus className="h-4 w-4 mr-1" /> Adicionar custo</Button>
        </div>
        {costs.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">A carregar…</div>
        ) : (costs.data ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Sem custos registados.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Descrição</th>
                <th className="text-right px-3 py-2">Qtd</th>
                <th className="text-right px-3 py-2">Unit.</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {(costs.data ?? []).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString("pt-PT")}</td>
                  <td className="px-3 py-2">{COST_KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</td>
                  <td className="px-3 py-2">{c.description ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.unit_cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(c.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4" /> Cobranças ao cliente</div>
          <Button
            size="sm"
            onClick={() => setChargeOpen(true)}
            disabled={!!chargeDisabledReason}
            title={chargeDisabledReason ?? undefined}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar cobrança
          </Button>
        </div>
        {charges.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">A carregar…</div>
        ) : (charges.data ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {chargeDisabledReason ?? "Sem cobranças registadas."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Notas</th>
                <th className="text-right px-3 py-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {(charges.data ?? []).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString("pt-PT")}</td>
                  <td className="px-3 py-2">{CHARGE_KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.notes ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Dialog custo */}
      <Dialog open={costOpen} onOpenChange={setCostOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar custo</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={costForm.kind} onValueChange={(v) => setCostForm({ ...costForm, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COST_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={costForm.description} onChange={(e) => setCostForm({ ...costForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" step="0.01" value={costForm.quantity} onChange={(e) => setCostForm({ ...costForm, quantity: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Custo unitário</Label>
                <Input type="number" step="0.01" value={costForm.unit_cost} onChange={(e) => setCostForm({ ...costForm, unit_cost: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label>Fornecedor (UUID, opcional)</Label>
              <Input value={costForm.supplier_id} onChange={(e) => setCostForm({ ...costForm, supplier_id: e.target.value })} />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={costForm.notes} onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCostOpen(false)} disabled={savingCost}>Cancelar</Button>
            <Button onClick={addCost} disabled={savingCost}>{savingCost ? "A guardar…" : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cobrança */}
      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar cobrança</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Tipo</Label>
              <Select value={chargeForm.kind} onValueChange={(v) => setChargeForm({ ...chargeForm, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHARGE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={chargeForm.notes} onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChargeOpen(false)} disabled={savingCharge}>Cancelar</Button>
            <Button onClick={addCharge} disabled={savingCharge}>{savingCharge ? "A guardar…" : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
