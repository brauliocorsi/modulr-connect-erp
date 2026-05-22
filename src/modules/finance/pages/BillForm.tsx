import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, Receipt, Trash2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";
import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";
import { AttachmentsField, type Attachment } from "@/modules/finance/components/AttachmentsField";

export default function BillForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const isNew = !id || id === "new";
  const prefillPoId = isNew ? sp.get("po") : null;

  const [bill, setBill] = useState<any>({
    bill_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    amount_total: 0,
    amount_paid: 0,
    state: "draft",
    partner_id: "",
    purchase_order_id: null,
    cost_center_id: "",
    reference: "",
    notes: "",
    attachments: [] as Attachment[],
  });
  const [partners, setPartners] = useState<any[]>([]);
  const [centers, setCenters] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [poInfo, setPoInfo] = useState<any | null>(null);
  const [payDlg, setPayDlg] = useState(false);

  const load = async () => {
    if (!isNew) {
      const { data } = await supabase.from("supplier_bills").select("*, partners(name)").eq("id", id!).maybeSingle();
      if (data) setBill(data);
      const { data: p } = await supabase
        .from("supplier_payments")
        .select("*, payment_methods(name), account_journals(name)")
        .eq("bill_id", id!)
        .order("payment_date", { ascending: false });
      setPayments(p ?? []);
    }
  };
  useEffect(() => {
    (async () => {
      const [{ data: pp }, { data: cc }, { data: pp2 }] = await Promise.all([
        supabase.from("partners").select("id,name").eq("is_supplier", true).order("name"),
        supabase.from("cost_centers").select("id,name,code").eq("active", true).order("code"),
        supabase.from("purchase_orders").select("id,name").order("created_at", { ascending: false }).limit(200),
      ]);
      setPartners(pp ?? []);
      setCenters(cc ?? []);
      setPos(pp2 ?? []);
      // Prefill from ?po=<id>
      if (prefillPoId) {
        const { data: po } = await supabase
          .from("purchase_orders")
          .select("id, partner_id, amount_total, name, expected_date")
          .eq("id", prefillPoId)
          .maybeSingle();
        if (po) {
          setBill((b: any) => ({
            ...b,
            partner_id: po.partner_id,
            purchase_order_id: po.id,
            amount_total: Number(po.amount_total || 0),
            reference: po.name,
            due_date: po.expected_date ?? b.due_date,
          }));
        }
      }
    })();
    load();
  }, [id, prefillPoId]);

  const save = async () => {
    if (!bill.partner_id) return toast.error("Selecione fornecedor");
    if (isNew) {
      // PO-based: usar RPC supplier_bill_create_from_po (F20-B).
      if (bill.purchase_order_id) {
        const { data, error } = await supabase.rpc("supplier_bill_create_from_po", {
          _po_id: bill.purchase_order_id,
          _bill_date: bill.bill_date,
          _reference: bill.reference || undefined,
          _idempotency_key: `bill:${bill.purchase_order_id}:${bill.bill_date}`,
        });
        if (error) return toast.error(error.message);
        const res: any = data;
        if (res?.error) return toast.error(mapBillError(res.error));
        const bid = res?.bill_id ?? res?.id ?? null;
        toast.success("Fatura criada a partir da PO");
        if (bid) return nav(`/finance/payables/${bid}`);
        return;
      }
      // Ad-hoc (sem PO) → RPC supplier_bill_create (F22-D1).
      const { data, error } = await supabase.rpc("supplier_bill_create", {
        _payload: {
          partner_id: bill.partner_id,
          bill_date: bill.bill_date,
          due_date: bill.due_date || null,
          amount_total: Number(bill.amount_total || 0),
          cost_center_id: bill.cost_center_id || null,
          reference: bill.reference || null,
          notes: bill.notes || null,
          state: "posted",
        },
      });
      if (error) return toast.error(error.message);
      const res: any = data;
      if (res?.error) return toast.error(mapBillError(res.error));
      toast.success("Fatura criada");
      nav(`/finance/payables/${res.bill_id}`);
    } else {
      // Update via RPC supplier_bill_update (F22-D1).
      const { data, error } = await supabase.rpc("supplier_bill_update", {
        _bill_id: id!,
        _payload: {
          partner_id: bill.partner_id,
          purchase_order_id: bill.purchase_order_id || null,
          bill_date: bill.bill_date,
          due_date: bill.due_date || null,
          amount_total: Number(bill.amount_total || 0),
          cost_center_id: bill.cost_center_id || null,
          reference: bill.reference,
          notes: bill.notes,
        },
      });
      if (error) return toast.error(error.message);
      const res: any = data;
      if (res?.error) return toast.error(mapBillError(res.error));
      toast.success("Salvo");
      load();
    }
  };

  const cancelBill = async () => {
    const reason = window.prompt("Motivo do cancelamento da fatura?");
    if (!reason || !reason.trim()) return;
    const { data, error } = await supabase.rpc("supplier_bill_cancel", {
      _bill_id: id!,
      _reason: reason.trim(),
    });
    if (error) return toast.error(error.message);
    const res: any = data;
    if (res?.error) return toast.error(mapBillError(res.error));
    toast.success("Fatura cancelada");
    load();
  };
  const cancelPayment = async (pid: string) => {
    const reason = window.prompt("Motivo do cancelamento do pagamento?");
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.rpc("supplier_payment_cancel", {
      _payment_id: pid,
      _reason: reason.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("Pagamento cancelado");
    load();
  };

  const open = Number(bill.amount_total || 0) - Number(bill.amount_paid || 0);

  return (
    <>
      <FormHeader
        title={bill.name || "Nova fatura"}
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Contas a Pagar", to: "/finance/payables" }, { label: bill.name || "Nova" }]}
        backTo="/finance/payables"
        state={{ label: bill.state, tone: bill.state === "paid" ? "success" : bill.state === "cancelled" ? "destructive" : "warning" }}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={save}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
            {!isNew && bill.state !== "paid" && bill.state !== "cancelled" && (
              <Button size="sm" onClick={() => setPayDlg(true)} disabled={open <= 0}>
                <Receipt className="h-4 w-4 mr-1" /> Pagar
              </Button>
            )}
            {!isNew && bill.state !== "cancelled" && (
              <Button size="sm" variant="ghost" onClick={cancelBill}>Cancelar fatura</Button>
            )}
          </div>
        }
      />
      <PageBody>
        <Card className="p-6 grid sm:grid-cols-2 gap-4">
          <div><Label>Fornecedor</Label>
            <Select value={bill.partner_id ?? ""} onValueChange={(v) => setBill({ ...bill, partner_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Ordem de Compra (opc.)</Label>
            <Select value={bill.purchase_order_id ?? ""} onValueChange={(v) => setBill({ ...bill, purchase_order_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{pos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Data</Label><Input type="date" value={bill.bill_date} onChange={(e) => setBill({ ...bill, bill_date: e.target.value })} /></div>
          <div><Label>Vencimento</Label><Input type="date" value={bill.due_date ?? ""} onChange={(e) => setBill({ ...bill, due_date: e.target.value })} /></div>
          <div><Label>Total</Label><Input type="number" step="0.01" value={bill.amount_total} onChange={(e) => setBill({ ...bill, amount_total: Number(e.target.value) })} /></div>
          <div><Label>Centro de Custo</Label>
            <Select value={bill.cost_center_id ?? ""} onValueChange={(v) => setBill({ ...bill, cost_center_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Referência</Label><Input value={bill.reference ?? ""} onChange={(e) => setBill({ ...bill, reference: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Notas</Label><Textarea value={bill.notes ?? ""} onChange={(e) => setBill({ ...bill, notes: e.target.value })} /></div>
        </Card>

        {!isNew && (
          <Card className="mt-4 p-4 grid grid-cols-3 gap-4">
            <Stat label="Total" value={fmtMoney(bill.amount_total)} />
            <Stat label="Pago" value={fmtMoney(bill.amount_paid)} tone="emerald" />
            <Stat label="Em aberto" value={fmtMoney(open)} tone={open > 0 ? "rose" : "muted"} />
          </Card>
        )}

        {!isNew && (
          <Card className="mt-4">
            <div className="px-4 py-3 border-b font-semibold">Pagamentos</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Nº</th>
                  <th className="text-left px-3 py-2">Data</th>
                  <th className="text-left px-3 py-2">Método</th>
                  <th className="text-left px-3 py-2">Diário</th>
                  <th className="text-left px-3 py-2">Ref</th>
                  <th className="text-right px-3 py-2">Valor</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem pagamentos</td></tr>
                ) : payments.map((p) => (
                  <tr key={p.id} className={`border-t ${p.state === "cancelled" ? "opacity-50 line-through" : ""}`}>
                    <td className="px-3 py-2 font-mono">{p.name}</td>
                    <td className="px-3 py-2">{p.payment_date}</td>
                    <td className="px-3 py-2">{p.payment_methods?.name ?? "—"}</td>
                    <td className="px-3 py-2">{p.account_journals?.name ?? "—"}</td>
                    <td className="px-3 py-2">{p.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                    <td className="px-3 py-2">{p.state}</td>
                    <td>{p.state === "posted" && <Button size="sm" variant="ghost" onClick={() => cancelPayment(p.id)}><Trash2 className="h-4 w-4" /></Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>

      {!isNew && (
        <RegisterSupplierPaymentDialog
          open={payDlg}
          onOpenChange={setPayDlg}
          billId={id!}
          partnerId={bill.partner_id}
          defaultAmount={open}
          onSaved={load}
        />
      )}
    </>
  );
}

const BILL_ERROR_MESSAGES: Record<string, string> = {
  permission_denied: "Sem permissão para esta operação",
  partner_required: "Selecione um fornecedor",
  total_must_be_positive: "Total deve ser maior que zero",
  due_before_bill: "Vencimento não pode ser anterior à data da fatura",
  invalid_initial_state: "Estado inicial inválido",
  bill_not_found: "Fatura não encontrada",
  bill_locked: "Fatura paga/cancelada não pode ser alterada",
  total_below_paid: "Total não pode ser inferior ao valor já pago",
  reason_required: "Motivo é obrigatório",
  already_cancelled: "Fatura já cancelada",
  bill_has_payments: "Cancele os pagamentos antes de cancelar a fatura",
  po_not_found: "Ordem de compra não encontrada",
  po_not_confirmed: "Ordem de compra não está confirmada",
};
function mapBillError(code: string): string {
  return BILL_ERROR_MESSAGES[code] ?? `Erro: ${code}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" | "muted" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (<div><div className="text-xs text-muted-foreground">{label}</div><div className={`text-lg font-semibold ${cls}`}>{value}</div></div>);
}
