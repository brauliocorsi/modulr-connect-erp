import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Wrench } from "lucide-react";

type Product = { id: string; name: string };

export function ServiceRequestDialog({
  open, onOpenChange, pickingId, partnerId, routeId, products,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pickingId?: string | null;
  partnerId?: string | null;
  routeId?: string | null;
  products: Product[];
}) {
  const [productId, setProductId] = useState<string>("");
  const [priority, setPriority] = useState<string>("normal");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && products[0]) setProductId(products[0].id);
  }, [open, products]);

  const submit = async () => {
    if (!description.trim()) return toast.error("Descreve o problema");
    setBusy(true);
    const { data: seq } = await supabase.rpc("next_sequence", { _code: "service_request" });
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("service_requests").insert({
      name: seq ?? "SR/NEW",
      partner_id: partnerId ?? null,
      product_id: productId || null,
      picking_id: pickingId ?? null,
      route_id: routeId ?? null,
      reported_by: u.user?.id,
      priority,
      description,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Pedido de assistência aberto");
    setDescription(""); setPriority("normal");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-500" /> Abrir pedido de assistência
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Produto</Label>
            <select className="w-full h-9 border rounded-md px-2 bg-background"
              value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— sem produto específico —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Prioridade</Label>
            <select className="w-full h-9 border rounded-md px-2 bg-background"
              value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>
          <div>
            <Label>Descrição do problema</Label>
            <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: porta do armário danificada no transporte; cliente quer substituição" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Abrir pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
