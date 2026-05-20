import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRpcMutation } from "@/core/operational";

const TYPES = ["manual", "machine", "cutting", "sewing", "upholstery", "assembly", "quality", "packing", "other"];

export interface WorkCenterRow {
  id: string;
  code: string | null;
  name: string;
  type: string | null;
  warehouse_id: string | null;
  capacity_per_day: number | null;
  efficiency_percent: number | null;
  cost_per_hour: number | null;
  active: boolean;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: WorkCenterRow | null;
  onSaved?: () => void;
}

export default function WorkCenterDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("manual");
  const [warehouse, setWarehouse] = useState<string>("");
  const [cap, setCap] = useState("");
  const [eff, setEff] = useState("100");
  const [cost, setCost] = useState("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCode(initial?.code ?? "");
      setName(initial?.name ?? "");
      setType(initial?.type ?? "manual");
      setWarehouse(initial?.warehouse_id ?? "");
      setCap(initial?.capacity_per_day?.toString() ?? "");
      setEff(initial?.efficiency_percent?.toString() ?? "100");
      setCost(initial?.cost_per_hour?.toString() ?? "");
      setActive(initial?.active ?? true);
      setNotes(initial?.notes ?? "");
    }
  }, [open, initial]);

  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
    enabled: open,
  });

  const m = useRpcMutation<{ _work_center_id: string | null; _payload: Record<string, unknown> }, string>({
    rpc: "work_center_upsert",
    successMessage: initial ? "Centro atualizado" : "Centro criado",
    invalidateKeys: [["work-centers"]],
    onSuccess: () => { onSaved?.(); onOpenChange(false); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar centro de trabalho" : "Novo centro de trabalho"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Código *</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Armazém</Label>
            <Select value={warehouse || "none"} onValueChange={(v) => setWarehouse(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(warehouses as Array<{ id: string; name: string }>).map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Capac./dia</Label><Input type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
          <div><Label>Eficiência %</Label><Input type="number" min="1" step="1" value={eff} onChange={(e) => setEff(e.target.value)} /></div>
          <div><Label>€/hora</Label><Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="wc-active" />
            <Label htmlFor="wc-active">Ativo</Label>
          </div>
          <div className="col-span-2"><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={m.isPending || !code.trim() || !name.trim()}
            onClick={() => m.mutate({
              _work_center_id: initial?.id ?? null,
              _payload: {
                code: code.trim(),
                name: name.trim(),
                type,
                warehouse_id: warehouse || null,
                capacity_per_day: cap === "" ? null : cap,
                efficiency_percent: eff === "" ? 100 : eff,
                cost_per_hour: cost === "" ? null : cost,
                active,
                notes: notes.trim() || null,
              },
            })}
          >Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
