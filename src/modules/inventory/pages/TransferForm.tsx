import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Chatter } from "@/core/chatter/Chatter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

const TONE: Record<string, any> = { draft: "default", waiting: "warning", ready: "info", done: "success", cancelled: "destructive" };

export default function TransferForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [picking, setPicking] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);

  const load = async () => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path)")
      .eq("id", id!)
      .maybeSingle();
    setPicking(p);
    const { data: m } = await supabase
      .from("stock_moves")
      .select("*, products(name)")
      .eq("picking_id", id!);
    setMoves(m ?? []);
  };
  useEffect(() => {
    if (id) load();
  }, [id]);

  const setMoveDone = (idx: number, v: number) => {
    setMoves((p) => {
      const n = [...p];
      n[idx] = { ...n[idx], quantity_done: v };
      return n;
    });
  };

  const validate = async () => {
    // persist quantity_done first
    for (const m of moves) {
      await supabase.from("stock_moves").update({ quantity_done: m.quantity_done ?? m.quantity }).eq("id", m.id);
    }
    const { error } = await supabase.rpc("validate_picking", { _picking: id! });
    if (error) return toast.error(error.message);
    toast.success("Transferência validada");
    load();
  };

  const cancel = async () => {
    await supabase.from("stock_pickings").update({ state: "cancelled" }).eq("id", id!);
    toast.success("Cancelado");
    load();
  };

  if (!picking) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const isLocked = ["done", "cancelled"].includes(picking.state);

  return (
    <>
      <FormHeader
        title={picking.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Transferências", to: "/inventory/transfers" }, { label: picking.name }]}
        backTo="/inventory/transfers"
        state={{ label: picking.state, tone: TONE[picking.state] ?? "default" }}
        actions={
          <div className="flex gap-2">
            {!isLocked && (
              <Button size="sm" onClick={validate}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Validar
              </Button>
            )}
            {!isLocked && (
              <Button size="sm" variant="ghost" onClick={cancel}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-4 grid sm:grid-cols-3 gap-4 text-sm">
              <div><div className="o-section-title">Tipo</div>{picking.kind}</div>
              <div><div className="o-section-title">Origem</div>{picking.source?.full_path ?? picking.source?.name}</div>
              <div><div className="o-section-title">Destino</div>{picking.dest?.full_path ?? picking.dest?.name}</div>
              <div><div className="o-section-title">Parceiro</div>{picking.partners?.name ?? "—"}</div>
              <div><div className="o-section-title">Origem doc.</div>{picking.origin ?? "—"}</div>
              <div><div className="o-section-title">Programado</div>{picking.scheduled_at ? new Date(picking.scheduled_at).toLocaleString("pt-BR") : "—"}</div>
            </Card>

            <Card>
              <div className="px-4 py-3 border-b font-semibold">Movimentos</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Produto</th>
                    <th className="text-left px-3 py-2 w-32">Demanda</th>
                    <th className="text-left px-3 py-2 w-32">Feito</th>
                    <th className="text-left px-3 py-2 w-32">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m, i) => (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2">{m.products?.name}</td>
                      <td className="px-3 py-2">{m.quantity}</td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-8"
                          type="number"
                          step="0.01"
                          value={m.quantity_done ?? m.quantity}
                          disabled={isLocked}
                          onChange={(e) => setMoveDone(i, Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">{m.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Chatter recordType="stock_picking" recordId={id!} />
          </div>
          <aside />
        </div>
      </PageBody>
    </>
  );
}
