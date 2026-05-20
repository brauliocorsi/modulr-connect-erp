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

export interface OperationRow {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  default_work_center_id: string | null;
  requires_machine: boolean | null;
  requires_employee: boolean | null;
  requires_quality_check: boolean | null;
  active: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: OperationRow | null;
  onSaved?: () => void;
}

export default function OperationDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [wc, setWc] = useState<string>("");
  const [rm, setRm] = useState(false);
  const [re, setRe] = useState(true);
  const [rq, setRq] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      setCode(initial?.code ?? "");
      setName(initial?.name ?? "");
      setDesc(initial?.description ?? "");
      setWc(initial?.default_work_center_id ?? "");
      setRm(initial?.requires_machine ?? false);
      setRe(initial?.requires_employee ?? true);
      setRq(initial?.requires_quality_check ?? false);
      setActive(initial?.active ?? true);
    }
  }, [open, initial]);

  const { data: wcs = [] } = useQuery({
    queryKey: ["wc-options"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name").eq("active", true).order("name")).data ?? [],
    enabled: open,
  });

  const m = useRpcMutation<{ _operation_id: string | null; _payload: Record<string, unknown> }, string>({
    rpc: "manufacturing_operation_upsert",
    successMessage: initial ? "Operação atualizada" : "Operação criada",
    invalidateKeys: [["manufacturing-operations"]],
    onSuccess: () => { onSaved?.(); onOpenChange(false); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar operação" : "Nova operação"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Código *</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="col-span-2">
            <Label>Centro de trabalho padrão</Label>
            <Select value={wc || "none"} onValueChange={(v) => setWc(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(wcs as Array<{ id: string; name: string }>).map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Descrição</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></div>
          <label className="flex items-center gap-2"><Switch checked={rm} onCheckedChange={setRm} /> Requer máquina</label>
          <label className="flex items-center gap-2"><Switch checked={re} onCheckedChange={setRe} /> Requer operador</label>
          <label className="flex items-center gap-2"><Switch checked={rq} onCheckedChange={setRq} /> Requer QC</label>
          <label className="flex items-center gap-2"><Switch checked={active} onCheckedChange={setActive} /> Ativo</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={m.isPending || !code.trim() || !name.trim()}
            onClick={() => m.mutate({
              _operation_id: initial?.id ?? null,
              _payload: {
                code: code.trim(),
                name: name.trim(),
                description: desc.trim() || null,
                default_work_center_id: wc || null,
                requires_machine: rm,
                requires_employee: re,
                requires_quality_check: rq,
                active,
              },
            })}
          >Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
