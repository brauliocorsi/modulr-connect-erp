import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Package, PlusCircle } from "lucide-react";
import { callM5Rpc } from "../lib/m5Rpc";

// UI M5 — Levantamentos em armazém. Apenas chama RPCs:
// create_customer_pickup, delivery_pick_to_pickup_area, validate_customer_pickup.
export default function PickupsPage() {
  const { data: pickups = [], refetch } = useQuery({
    queryKey: ["customer-pickups"],
    queryFn: async () =>
      (await supabase
        .from("customer_pickups")
        .select(`id, status, scheduled_date, picked_up_at, picked_up_by_name, notes,
                 sale_orders(id, name, partners(name, phone)),
                 stock_pickings(id, name, state)`)
        .order("scheduled_date", { ascending: false })
        .limit(100)).data ?? [],
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (id: string) => {
    setBusy(id);
    const r = await callM5Rpc("delivery_pick_to_pickup_area", { _pickup_id: id }, "Separar p/ pickup area");
    setBusy(null);
    if (r.ok) refetch();
  };

  return (
    <>
      <PageHeader
        title="Levantamentos em armazém"
        breadcrumb={[{ label: "Entregas" }, { label: "Pickups" }]}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="create-pickup-btn">
            <PlusCircle className="h-4 w-4 mr-1" /> Novo levantamento
          </Button>
        }
      />
      <PageBody>
        <Card>
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-2 py-1.5">Venda</th>
                <th className="text-left px-2 py-1.5">Cliente</th>
                <th className="text-left px-2 py-1.5">Data</th>
                <th className="text-left px-2 py-1.5">Picking</th>
                <th className="text-left px-2 py-1.5">Estado</th>
                <th className="text-left px-2 py-1.5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(pickups as any[]).length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sem levantamentos.</td></tr>
              ) : (pickups as any[]).map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="px-2 py-2 font-medium">{p.sale_orders?.name ?? "—"}</td>
                  <td className="px-2 py-2">{p.sale_orders?.partners?.name ?? "—"}<div className="text-[10px] text-muted-foreground">{p.sale_orders?.partners?.phone ?? ""}</div></td>
                  <td className="px-2 py-2">{p.scheduled_date}</td>
                  <td className="px-2 py-2 text-[11px]">{p.stock_pickings?.name ?? "—"}<div className="text-muted-foreground">{p.stock_pickings?.state ?? ""}</div></td>
                  <td className="px-2 py-2"><Badge variant="outline" className="capitalize">{p.status}</Badge></td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" disabled={p.status !== "pending" || busy !== null}
                        onClick={() => pick(p.id)} data-testid={`pick-${p.id}`}>
                        Separar
                      </Button>
                      <Button size="sm" variant="default" disabled={p.status !== "ready" || busy !== null}
                        onClick={() => setValidateOpen(p.id)} data-testid={`validate-${p.id}`}>
                        Validar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {createOpen && <CreatePickupDialog onClose={() => { setCreateOpen(false); refetch(); }} />}
        {validateOpen && (
          <ValidatePickupDialog
            pickupId={validateOpen}
            onClose={() => { setValidateOpen(null); refetch(); }}
          />
        )}
      </PageBody>
    </>
  );
}

function CreatePickupDialog({ onClose }: { onClose: () => void }) {
  const [soId, setSoId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const { data: sos = [] } = useQuery({
    queryKey: ["sos-for-pickup"],
    queryFn: async () =>
      (await supabase
        .from("sale_orders")
        .select("id,name,state,partners(name)")
        .in("state", ["confirmed", "sent"])
        .order("name", { ascending: false })
        .limit(80)).data ?? [],
  });

  async function submit() {
    setBusy(true);
    const r = await callM5Rpc("create_customer_pickup", { _sale_order_id: soId, _scheduled_date: date }, "Criar levantamento");
    setBusy(false);
    if (r.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle><Package className="h-4 w-4 inline mr-1" />Novo levantamento</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div>
            <Label>Venda</Label>
            <Select value={soId} onValueChange={setSoId}>
              <SelectTrigger><SelectValue placeholder="Escolher venda…" /></SelectTrigger>
              <SelectContent>
                {(sos as any[]).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} · {s.partners?.name ?? ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data prevista</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !soId} data-testid="create-pickup-submit">{busy ? "…" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidatePickupDialog({ pickupId, onClose }: { pickupId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [sessionId, setSessionId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const { data: sessions = [] } = useQuery({
    queryKey: ["cash-sessions-open"],
    queryFn: async () =>
      (await supabase.from("cash_sessions").select("id,name,state").eq("state", "open").limit(20)).data ?? [],
  });

  async function submit() {
    setBusy(true);
    const payment = payAmount
      ? {
          amount: Number(payAmount),
          method_code: method,
          session_id: sessionId || null,
          idempotency_key: crypto.randomUUID(),
        }
      : null;
    const r = await callM5Rpc(
      "validate_customer_pickup",
      { _pickup_id: pickupId, _payment: payment, _picked_up_by_name: name || null, _picked_up_by_doc: doc || null },
      "Validar levantamento",
    );
    setBusy(false);
    if (r.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Validar levantamento</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div>
            <Label>Nome de quem levanta</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Doc. identificação</Label>
            <Input value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
          <div className="rounded border p-2 space-y-2 bg-muted/20">
            <div className="text-xs font-semibold">Pagamento (opcional)</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Valor</Label>
                <Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Método</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["CASH", "MBWAY", "MB", "TRANSF"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {method === "CASH" && (
              <div>
                <Label className="text-xs">Sessão de caixa</Label>
                <Select value={sessionId} onValueChange={setSessionId}>
                  <SelectTrigger><SelectValue placeholder="Escolher sessão aberta…" /></SelectTrigger>
                  <SelectContent>
                    {(sessions as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy} data-testid="validate-pickup-submit">{busy ? "…" : "Validar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
