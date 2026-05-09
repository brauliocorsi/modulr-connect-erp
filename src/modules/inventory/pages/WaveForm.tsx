import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CheckCircle2, X, Plus } from "lucide-react";
import { stateLabel } from "@/lib/picking";
import { toast } from "sonner";

export default function WaveForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id || id === "new";
  const [wave, setWave] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const load = async () => {
    if (isNew) {
      const { data } = await supabase
        .from("stock_moves")
        .select("id,quantity,state,picking_id,products(name),stock_pickings!inner(name,state,kind)")
        .is("wave_id", null)
        .in("state", ["waiting", "ready"])
        .limit(500);
      setPending(data ?? []);
      return;
    }
    const { data: w } = await supabase.from("stock_picking_waves").select("*").eq("id", id!).maybeSingle();
    setWave(w);
    const { data: m } = await supabase
      .from("stock_moves")
      .select("id,quantity,quantity_done,state,picking_id,products(name),stock_pickings(name)")
      .eq("wave_id", id!);
    setMoves(m ?? []);
  };
  useEffect(() => { load(); }, [id]);

  const toggle = (mid: string) => setSelected((p) => { const n = new Set(p); n.has(mid) ? n.delete(mid) : n.add(mid); return n; });

  const create = async () => {
    if (selected.size === 0) return toast.error("Selecione pelo menos um movimento");
    const { data, error } = await supabase.rpc("create_wave", { _moves: Array.from(selected) });
    if (error) return toast.error(error.message);
    toast.success("Onda criada");
    nav(`/inventory/waves/${data}`);
  };

  const validate = async () => {
    const { error } = await supabase.rpc("validate_wave", { _wave: id! });
    if (error) return toast.error(error.message);
    toast.success("Onda validada");
    load();
  };
  const cancel = async () => {
    if (!confirm("Cancelar a onda e libertar reservas dos movimentos não concluídos?")) return;
    const { error } = await supabase.rpc("cancel_wave", { _wave: id! });
    if (error) return toast.error(error.message);
    toast.success("Onda cancelada e reservas libertadas");
    load();
  };

  if (isNew) {
    const filtered = pending.filter((m: any) => !filter || m.products?.name?.toLowerCase().includes(filter.toLowerCase()));
    return (
      <>
        <FormHeader
          title="Nova onda"
          breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ondas", to: "/inventory/waves" }, { label: "Nova" }]}
          backTo="/inventory/waves"
          actions={
            <Button size="sm" onClick={create} disabled={selected.size === 0}>
              <Plus className="h-4 w-4 mr-1" /> Criar onda ({selected.size})
            </Button>
          }
        />
        <PageBody>
          <Card className="p-3 mb-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por produto…" className="max-w-sm" />
          </Card>
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr><th className="w-10 px-3 py-2"></th><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2">Qtd</th><th className="text-left px-3 py-2">Transferência</th><th className="text-left px-3 py-2">Estado</th></tr>
              </thead>
              <tbody>
                {filtered.map((m: any) => (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2"><Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} /></td>
                    <td className="px-3 py-2">{m.products?.name}</td>
                    <td className="px-3 py-2">{m.quantity}</td>
                    <td className="px-3 py-2">{m.stock_pickings?.name}</td>
                    <td className="px-3 py-2">{stateLabel(m.state)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos pendentes</td></tr>}
              </tbody>
            </table>
          </Card>
        </PageBody>
      </>
    );
  }

  if (!wave) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const locked = ["done", "cancelled"].includes(wave.state);

  return (
    <>
      <FormHeader
        title={wave.name}
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ondas", to: "/inventory/waves" }, { label: wave.name }]}
        backTo="/inventory/waves"
        state={{ label: stateLabel(wave.state), tone: wave.state === "done" ? "success" : wave.state === "cancelled" ? "destructive" : "default" }}
        actions={
          <div className="flex gap-2">
            {!locked && <Button size="sm" onClick={validate}><CheckCircle2 className="h-4 w-4 mr-1" /> Validar onda</Button>}
            {!locked && <Button size="sm" variant="ghost" onClick={cancel}><X className="h-4 w-4 mr-1" /> Cancelar</Button>}
          </div>
        }
      />
      <PageBody>
        <Card>
          <div className="px-4 py-3 border-b font-semibold">Movimentos da onda</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2">Qtd</th><th className="text-left px-3 py-2">Feito</th><th className="text-left px-3 py-2">Transferência</th><th className="text-left px-3 py-2">Estado</th></tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{m.products?.name}</td>
                  <td className="px-3 py-2">{m.quantity}</td>
                  <td className="px-3 py-2">{m.quantity_done ?? 0}</td>
                  <td className="px-3 py-2"><Link to={`/inventory/transfers/${m.picking_id}`} className="text-primary hover:underline">{m.stock_pickings?.name}</Link></td>
                  <td className="px-3 py-2">{stateLabel(m.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
