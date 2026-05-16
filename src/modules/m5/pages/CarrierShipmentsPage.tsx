import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { callM5Rpc } from "../lib/m5Rpc";

type Action = "handover" | "delivered" | "failed";

// UI M5 — transportadora externa. Apenas chama RPCs:
// delivery_handover_to_carrier, carrier_confirm_delivered, carrier_mark_failed_or_returned.
export default function CarrierShipmentsPage() {
  const { data: rows = [], refetch } = useQuery({
    queryKey: ["carrier-schedules"],
    queryFn: async () =>
      (await supabase
        .from("delivery_schedules")
        .select(`id, scheduled_date, physical_state, carrier_id, tracking_code, status,
                 sale_orders(name, partners(name, city)),
                 carriers(name, stock_location_id)`)
        .in("physical_state", ["ready", "loaded", "with_carrier", "delivered", "failed", "returned"])
        .order("scheduled_date", { ascending: false })
        .limit(100)).data ?? [],
  });

  const [open, setOpen] = useState<{ id: string; action: Action } | null>(null);

  return (
    <>
      <PageHeader title="Transportadora externa" breadcrumb={[{ label: "Entregas" }, { label: "Transportadora" }]} />
      <PageBody>
        <Card>
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-2 py-1.5">Venda</th>
                <th className="text-left px-2 py-1.5">Cliente</th>
                <th className="text-left px-2 py-1.5">Data</th>
                <th className="text-left px-2 py-1.5">Transportadora</th>
                <th className="text-left px-2 py-1.5">Tracking</th>
                <th className="text-left px-2 py-1.5">Estado físico</th>
                <th className="text-left px-2 py-1.5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(rows as any[]).length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem schedules elegíveis.</td></tr>
              ) : (rows as any[]).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-2 py-2 font-medium">{s.sale_orders?.name ?? "—"}</td>
                  <td className="px-2 py-2">{s.sale_orders?.partners?.name ?? "—"}<div className="text-[10px] text-muted-foreground">{s.sale_orders?.partners?.city ?? ""}</div></td>
                  <td className="px-2 py-2">{s.scheduled_date}</td>
                  <td className="px-2 py-2">{s.carriers?.name ?? "—"}{!s.carriers?.stock_location_id && s.carrier_id && <div className="text-[10px] text-rose-700">⚠ sem location</div>}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{s.tracking_code ?? "—"}</td>
                  <td className="px-2 py-2"><Badge variant="outline">{s.physical_state}</Badge></td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" disabled={!["ready", "loaded"].includes(s.physical_state)}
                        onClick={() => setOpen({ id: s.id, action: "handover" })} data-testid={`handover-${s.id}`}>
                        Entregar à transp.
                      </Button>
                      <Button size="sm" variant="default" disabled={s.physical_state !== "with_carrier"}
                        onClick={() => setOpen({ id: s.id, action: "delivered" })} data-testid={`delivered-${s.id}`}>
                        Entregue
                      </Button>
                      <Button size="sm" variant="ghost" disabled={s.physical_state !== "with_carrier"}
                        onClick={() => setOpen({ id: s.id, action: "failed" })} data-testid={`failed-${s.id}`}>
                        Falha/Retorno
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {open && <CarrierActionDialog {...open} onClose={() => { setOpen(null); refetch(); }} />}
      </PageBody>
    </>
  );
}

function CarrierActionDialog({ id, action, onClose }: { id: string; action: Action; onClose: () => void }) {
  const [carrierId, setCarrierId] = useState<string>("");
  const [tracking, setTracking] = useState("");
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<"good" | "damaged" | "quarantine">("good");
  const [busy, setBusy] = useState(false);

  const { data: carriers = [] } = useQuery({
    queryKey: ["carriers-active"],
    enabled: action === "handover",
    queryFn: async () => (await (supabase as any).from("carriers").select("id,name,stock_location_id").eq("active", true)).data ?? [],
  });

  async function submit() {
    setBusy(true);
    let res;
    if (action === "handover") {
      res = await callM5Rpc(
        "delivery_handover_to_carrier",
        { _schedule_id: id, _carrier_id: carrierId, _tracking_code: tracking || null },
        "Entregar à transportadora",
      );
    } else if (action === "delivered") {
      res = await callM5Rpc("carrier_confirm_delivered", { _schedule_id: id }, "Confirmar entrega");
    } else {
      res = await callM5Rpc(
        "carrier_mark_failed_or_returned",
        { _schedule_id: id, _reason: reason || "no_reason", _condition: condition },
        "Marcar falha/retorno",
      );
    }
    setBusy(false);
    if (res.ok) onClose();
  }

  const title = action === "handover" ? "Entregar à transportadora"
              : action === "delivered" ? "Confirmar entrega pela transportadora"
              : "Marcar falha/retorno";

  const disabled = busy || (action === "handover" && !carrierId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          {action === "handover" && (
            <>
              <div>
                <Label>Transportadora</Label>
                <Select value={carrierId} onValueChange={setCarrierId}>
                  <SelectTrigger><SelectValue placeholder="Escolher…" /></SelectTrigger>
                  <SelectContent>
                    {(carriers as any[]).map((c) => (
                      <SelectItem key={c.id} value={c.id} disabled={!c.stock_location_id}>
                        {c.name}{!c.stock_location_id ? " (sem location)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tracking</Label>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </div>
            </>
          )}
          {action === "failed" && (
            <>
              <div>
                <Label>Motivo</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
              <div>
                <Label>Condição do retorno</Label>
                <Select value={condition} onValueChange={(v: any) => setCondition(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Bom estado</SelectItem>
                    <SelectItem value="damaged">Danificado</SelectItem>
                    <SelectItem value="quarantine">Quarentena</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {action === "delivered" && (
            <div className="text-xs text-muted-foreground">
              Vai consumir o stock que está na localização da transportadora e marcar a venda como entregue.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={disabled} data-testid={`carrier-submit-${action}`}>{busy ? "…" : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
