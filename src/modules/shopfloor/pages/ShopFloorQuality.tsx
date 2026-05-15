import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { PhotoUploader, type Attachment } from "@/modules/manufacturing/components/PhotoUploader";

export default function ShopFloorQuality() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<any>(null);
  const [result, setResult] = useState("pass");
  const [defects, setDefects] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Attachment[]>([]);

  const { data } = useQuery({
    queryKey: ["qc-queue"],
    queryFn: async () => (await supabase
      .from("manufacturing_orders")
      .select("id,code,qty,due_date,product:products(name),partner:partners(name)")
      .eq("state", "qc")
      .order("due_date", { ascending: true, nullsFirst: false })).data ?? [],
  });

  const submit = async () => {
    const { error } = await supabase.rpc("mfg_quality_check", {
      _mo: open.id, _result: result as any, _defects: defects || null, _notes: notes || null,
      _attachments: photos as any,
    });
    if (error) toast.error(error.message);
    else { toast.success("Qualidade registada"); setOpen(null); setDefects(""); setNotes(""); setPhotos([]); qc.invalidateQueries({ queryKey: ["qc-queue"] }); }
  };

  return (
    <>
      <PageHeader title="Controle de Qualidade" breadcrumb={[{ label: "Chão de Fábrica", to: "/shop-floor" }, { label: "Qualidade" }]} />
      <PageBody>
        {!data?.length ? <div className="text-sm text-muted-foreground">Sem ordens aguardando qualidade.</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.map((m: any) => (
              <Card key={m.id} className="p-4 space-y-2">
                <div className="font-semibold">{m.code}</div>
                <div className="text-sm">{m.product?.name}</div>
                <div className="text-xs text-muted-foreground">{m.partner?.name} • Qtd: {Number(m.qty)} • Prazo: {fmtDate(m.due_date)}</div>
                <Button onClick={() => setOpen(m)} className="w-full mt-2">Avaliar</Button>
              </Card>
            ))}
          </div>
        )}
        <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Qualidade — {open?.code}</DialogTitle></DialogHeader>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pass">Aprovado</SelectItem>
                <SelectItem value="rework">Retrabalho</SelectItem>
                <SelectItem value="fail">Reprovado</SelectItem>
              </SelectContent>
            </Select>
            <Textarea placeholder="Defeitos" value={defects} onChange={(e) => setDefects(e.target.value)} />
            <Textarea placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <DialogFooter><Button onClick={submit}>Registar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
