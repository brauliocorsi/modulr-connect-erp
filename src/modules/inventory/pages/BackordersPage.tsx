import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { stateLabel, kindLabel } from "@/lib/picking";
import { ArrowLeftRight } from "lucide-react";

const STATE_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-800",
  ready: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function BackordersPage() {
  const [origin, setOrigin] = useState("");
  const [partner, setPartner] = useState("");
  const [state, setState] = useState<string>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["backorders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_pickings")
        .select("id,name,kind,state,origin,scheduled_at,backorder_id,partners(name),original:backorder_id(id,name)")
        .not("backorder_id", "is", null)
        .order("scheduled_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return (rows as any[]).filter((r) => {
      if (state !== "all" && r.state !== state) return false;
      if (origin && !(r.origin ?? "").toLowerCase().includes(origin.toLowerCase())) return false;
      if (partner && !(r.partners?.name ?? "").toLowerCase().includes(partner.toLowerCase())) return false;
      return true;
    });
  }, [rows, origin, partner, state]);

  return (
    <>
      <PageHeader title="Backorders" subtitle="Entregas/recebimentos pendentes gerados automaticamente" icon={ArrowLeftRight} />
      <PageBody>
        <Card className="p-4 mb-4 grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Origem</Label>
            <Input placeholder="ex: S00011" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Parceiro</Label>
            <Input placeholder="Nome do parceiro" value={partner} onChange={(e) => setPartner(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="waiting">A aguardar</SelectItem>
                <SelectItem value="ready">Pronto</SelectItem>
                <SelectItem value="done">Concluído</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Referência</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Picking original</th>
                <th className="text-left px-3 py-2">Origem doc.</th>
                <th className="text-left px-3 py-2">Parceiro</th>
                <th className="text-left px-3 py-2">Programado</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Carregando…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem backorders</td></tr>
              )}
              {filtered.map((r: any) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link to={`/inventory/transfers/${r.id}`} className="text-primary hover:underline font-medium">{r.name}</Link>
                  </td>
                  <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2">
                    {r.original ? (
                      <Link to={`/inventory/transfers/${r.original.id}`} className="text-primary hover:underline">{r.original.name}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{r.origin ?? "—"}</td>
                  <td className="px-3 py-2">{r.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge className={STATE_TONE[r.state] ?? ""}>{stateLabel(r.state)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
