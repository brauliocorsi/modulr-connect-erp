import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRpcMutation } from "@/core/operational";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MachineRow {
  id: string;
  code: string | null;
  name: string;
  work_center_id: string | null;
  status: string;
  maintenance_status: string | null;
  capacity_per_hour: number | null;
  cost_per_hour: number | null;
  active: boolean;
  notes: string | null;
  machine_type: string | null;
  next_maintenance_at: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: MachineRow | null;
  onSaved?: () => void;
}

const STATUS = ["available", "busy", "maintenance", "inactive"] as const;
const MAINT = ["ok", "due", "overdue", "blocked"] as const;

export default function MachineDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [wc, setWc] = useState<string>("");
  const [status, setStatus] = useState<string>("available");
  const [maint, setMaint] = useState<string>("ok");
  const [cap, setCap] = useState<string>("");
  const [cost, setCost] = useState<string>("");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [type, setType] = useState("");
  const [nextM, setNextM] = useState("");

  useEffect(() => {
    if (open) {
      setCode(initial?.code ?? "");
      setName(initial?.name ?? "");
      setWc(initial?.work_center_id ?? "");
      setStatus(initial?.status ?? "available");
      setMaint(initial?.maintenance_status ?? "ok");
      setCap(initial?.capacity_per_hour?.toString() ?? "");
      setCost(initial?.cost_per_hour?.toString() ?? "");
      setActive(initial?.active ?? true);
      setNotes(initial?.notes ?? "");
      setType(initial?.machine_type ?? "");
      setNextM(initial?.next_maintenance_at?.slice(0, 16) ?? "");
    }
  }, [open, initial]);

  const { data: wcs = [] } = useQuery({
    queryKey: ["wc-options"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name,code").eq("active", true).order("name")).data ?? [],
    enabled: open,
  });

  const m = useRpcMutation<{ _machine_id: string | null; _payload: Record<string, unknown> }, string>({
    rpc: "machine_upsert",
    successMessage: initial ? "Máquina atualizada" : "Máquina criada",
    invalidateKeys: [["machines"]],
    onSuccess: () => { onSaved?.(); onOpenChange(false); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar máquina" : "Nova máquina"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Código *</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="col-span-2">
            <Label>Centro de trabalho *</Label>
            <Select value={wc} onValueChange={setWc}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>
                {(wcs as Array<{ id: string; name: string; code: string | null }>).map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Manutenção</Label>
            <Select value={maint} onValueChange={setMaint}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MAINT.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Tipo</Label><Input value={type} onChange={(e) => setType(e.target.value)} /></div>
          <div><Label>Próxima manutenção</Label><Input type="datetime-local" value={nextM} onChange={(e) => setNextM(e.target.value)} /></div>
          <div><Label>Capac./hora</Label><Input type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
          <div><Label>€/hora</Label><Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="active" />
            <Label htmlFor="active">Ativo</Label>
          </div>
          <div className="col-span-2"><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={m.isPending || !code.trim() || !name.trim() || !wc}
            onClick={() => m.mutate({
              _machine_id: initial?.id ?? null,
              _payload: {
                code: code.trim(),
                name: name.trim(),
                work_center_id: wc,
                status,
                maintenance_status: maint,
                capacity_per_hour: cap === "" ? null : cap,
                cost_per_hour: cost === "" ? null : cost,
                active,
                notes: notes.trim() || null,
                machine_type: type.trim() || null,
                next_maintenance_at: nextM || null,
              },
            })}
          >Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
