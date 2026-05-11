import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Send } from "lucide-react";
import { toast } from "sonner";

type Move = {
  id: string;
  product_id: string;
  variant_id: string | null;
  source_location_id: string;
  reserved_quantity: number | null;
  quantity: number;
  products?: { name: string } | null;
};

type Candidate = {
  so_id: string;
  so_name: string;
  date_order: string | null;
  partner_name: string | null;
  needed: number;
  move_id: string;
};

export function TransferReservationDialog({
  open, onOpenChange, moves, warehouseId, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  moves: Move[];
  warehouseId: string | null;
  onDone: () => void;
}) {
  const reservedMoves = useMemo(
    () => moves.filter((m) => Number(m.reserved_quantity || 0) > 0),
    [moves],
  );
  const [moveId, setMoveId] = useState<string>("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [toSo, setToSo] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMoveId(reservedMoves[0]?.id ?? "");
    setReason("");
  }, [open, reservedMoves]);

  const selected = reservedMoves.find((m) => m.id === moveId);
  const maxQty = Number(selected?.reserved_quantity || 0);

  useEffect(() => {
    setQty(maxQty > 0 ? String(maxQty) : "");
    setToSo("");
    setCandidates([]);
    if (!selected || !warehouseId) return;
    (async () => {
      // candidate moves: same product/variant/warehouse, pending, with deficit
      const { data, error } = await supabase
        .from("stock_moves")
        .select(`
          id, quantity, reserved_quantity, product_id, variant_id, source_location_id,
          stock_pickings!inner(id, origin, kind, state, warehouse_id)
        `)
        .eq("product_id", selected.product_id)
        .eq("source_location_id", selected.source_location_id)
        .in("state", ["draft", "waiting"]);
      if (error) { console.error(error); return; }
      const filtered = (data ?? []).filter((m: any) => {
        const sp = m.stock_pickings;
        if (!sp || sp.kind !== "outgoing") return false;
        if (["done", "cancelled"].includes(sp.state)) return false;
        if (sp.warehouse_id !== warehouseId) return false;
        const variantA = selected.variant_id ?? null;
        const variantB = m.variant_id ?? null;
        if (variantA !== variantB) return false;
        const need = Number(m.quantity || 0) - Number(m.reserved_quantity || 0);
        return need > 0;
      });
      const origins = Array.from(new Set(filtered.map((m: any) => m.stock_pickings.origin).filter(Boolean)));
      if (origins.length === 0) { setCandidates([]); return; }
      const { data: sos } = await supabase
        .from("sale_orders")
        .select("id,name,date_order,state,partners(name)")
        .in("name", origins as string[])
        .in("state", ["confirmed", "sent"]);
      const byName = new Map((sos ?? []).map((s: any) => [s.name, s]));
      const built: Candidate[] = filtered
        .map((m: any) => {
          const so = byName.get(m.stock_pickings.origin);
          if (!so) return null;
          return {
            so_id: so.id,
            so_name: so.name,
            date_order: so.date_order,
            partner_name: so.partners?.name ?? null,
            needed: Number(m.quantity || 0) - Number(m.reserved_quantity || 0),
            move_id: m.id,
          };
        })
        .filter(Boolean) as Candidate[];
      built.sort((a, b) => (a.date_order || "").localeCompare(b.date_order || ""));
      setCandidates(built);
    })();
  }, [moveId, selected, warehouseId]);

  const submit = async () => {
    if (!selected) return toast.error("Selecione o movimento de origem");
    if (!toSo) return toast.error("Selecione a venda destino");
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Quantidade inválida");
    if (n > maxQty) return toast.error(`Máximo ${maxQty}`);
    const dst = candidates.find((c) => c.so_id === toSo);
    if (dst && n > dst.needed) return toast.error(`Venda destino só precisa de ${dst.needed}`);
    setLoading(true);
    const { data, error } = await supabase.rpc("transfer_reservation", {
      _from_move: selected.id, _to_so: toSo, _qty: n, _reason: reason || null,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const r: any = data;
    toast.success(`Transferido: ${r?.qty} unid. → ${r?.to_so}`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferir reserva para outra venda</DialogTitle>
          <DialogDescription>
            Liberta unidades reservadas e atribui-as imediatamente a outra venda confirmada com falta do mesmo produto.
          </DialogDescription>
        </DialogHeader>

        {reservedMoves.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">Este picking não tem reservas para transferir.</div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Linha de origem</Label>
              <Select value={moveId} onValueChange={setMoveId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {reservedMoves.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.products?.name ?? m.product_id.slice(0, 8)} — reservado {Number(m.reserved_quantity || 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Venda destino {candidates.length > 0 && <span className="text-xs text-muted-foreground">(ordenadas pela mais antiga)</span>}</Label>
              {candidates.length === 0 ? (
                <div className="text-xs text-muted-foreground border rounded p-3">
                  Nenhuma venda confirmada com falta deste produto neste armazém.
                </div>
              ) : (
                <Select value={toSo} onValueChange={setToSo}>
                  <SelectTrigger><SelectValue placeholder="Escolher venda…" /></SelectTrigger>
                  <SelectContent>
                    {candidates.map((c, i) => (
                      <SelectItem key={c.so_id} value={c.so_id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.so_name}</span>
                          {i === 0 && <Badge variant="outline" className="text-[10px]">mais antiga</Badge>}
                          <span className="text-xs text-muted-foreground">
                            {c.partner_name ?? "—"} · falta {c.needed}
                            {c.date_order && ` · ${new Date(c.date_order).toLocaleDateString()}`}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" min={0} max={maxQty} step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
                <div className="text-[11px] text-muted-foreground mt-1">Máx. {maxQty}</div>
              </div>
              <div className="flex items-end justify-center text-muted-foreground"><ArrowRight className="h-5 w-5" /></div>
            </div>

            <div>
              <Label>Motivo (opcional)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente VIP, urgência, troca de prioridade…" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={loading || reservedMoves.length === 0 || !toSo}>
            <Send className="h-4 w-4 mr-1" /> Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
