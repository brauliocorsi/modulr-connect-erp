import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShoppingBag, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";

const STATE_LABEL: Record<string, string> = {
  pending: "Pendente", quoting: "Em cotação", approved: "Aprovado",
  po_created: "PO criado", partially_received: "Parc. recebido",
  received: "Recebido", cancelled: "Cancelado",
};
const ORIGIN_LABEL: Record<string, string> = {
  sale: "Venda", manufacturing: "Produção", min_stock: "Stock mín.",
  manual: "Manual", forecast: "Previsão",
};
const stateTone = (s: string) => {
  if (s === "received") return "bg-emerald-600";
  if (s === "po_created" || s === "partially_received") return "bg-blue-600";
  if (s === "cancelled") return "bg-muted text-muted-foreground";
  if (s === "approved") return "bg-amber-600";
  return "bg-rose-600";
};

export default function PurchaseNeedsList() {
  const qc = useQueryClient();
  const [state, setState] = useState<string>("open");
  const [origin, setOrigin] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["purchase_needs", state, origin],
    queryFn: async () => {
      let q = supabase
        .from("purchase_needs")
        .select("id, qty_needed, origin_kind, state, needed_by, priority, created_at, notes, products(id,name,internal_ref), partners:suggested_partner_id(id,name), sale_orders(id,name), manufacturing_orders(id,code), purchase_orders(id,name,state)")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (state === "open") q = q.in("state", ["pending", "quoting", "approved", "po_created", "partially_received"]);
      else if (state !== "all") q = q.eq("state", state as any);
      if (origin !== "all") q = q.eq("origin_kind", origin as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = rows.filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (r.products?.name ?? "").toLowerCase().includes(s) || (r.partners?.name ?? "").toLowerCase().includes(s);
  });

  const counts = {
    pending: rows.filter((r: any) => r.state === "pending").length,
    po: rows.filter((r: any) => r.state === "po_created" || r.state === "partially_received").length,
    late: rows.filter((r: any) => r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state)).length,
    received: rows.filter((r: any) => r.state === "received").length,
  };

  const cancel = async (id: string) => {
    if (!confirm("Cancelar esta necessidade?")) return;
    const { error } = await supabase.from("purchase_needs").update({ state: "cancelled" } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cancelada");
    qc.invalidateQueries({ queryKey: ["purchase_needs"] });
  };

  return (
    <>
      <PageHeader
        title="Necessidades de Compra"
        breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Necessidades" }]}
      />
      <PageBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-3 w-3" />Pendentes</div><div className="text-2xl font-semibold">{counts.pending}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><ShoppingBag className="h-3 w-3" />Em PO</div><div className="text-2xl font-semibold">{counts.po}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><Clock className="h-3 w-3" />Atrasadas</div><div className="text-2xl font-semibold text-rose-600">{counts.late}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-3 w-3" />Recebidas</div><div className="text-2xl font-semibold text-emerald-600">{counts.received}</div></Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <Input className="h-9 w-56" placeholder="Buscar produto / fornecedor…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(STATE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={origin} onValueChange={setOrigin}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda origem</SelectItem>
                {Object.entries(ORIGIN_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Produto</th>
                  <th className="text-right p-2 w-20">Qtd</th>
                  <th className="text-left p-2 w-28">Origem</th>
                  <th className="text-left p-2 w-44">Referência</th>
                  <th className="text-left p-2 w-40">Fornecedor sugerido</th>
                  <th className="text-left p-2 w-28">Prazo</th>
                  <th className="text-left p-2 w-32">Estado</th>
                  <th className="text-left p-2 w-32">PO</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">A carregar…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Sem necessidades</td></tr>
                ) : filtered.map((r: any) => {
                  const late = r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state);
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        <Link to={`/products/${r.products?.id}`} className="text-primary hover:underline font-medium">{r.products?.name}</Link>
                        {r.products?.internal_ref && <div className="text-xs text-muted-foreground">{r.products.internal_ref}</div>}
                      </td>
                      <td className="p-2 text-right font-medium">{Number(r.qty_needed).toLocaleString("pt-PT")}</td>
                      <td className="p-2"><Badge variant="outline">{ORIGIN_LABEL[r.origin_kind]}</Badge></td>
                      <td className="p-2 text-xs">
                        {r.sale_orders && <Link to={`/sales/orders/${r.sale_orders.id}`} className="text-primary hover:underline">Venda {r.sale_orders.name}</Link>}
                        {r.manufacturing_orders && <Link to={`/manufacturing/orders/${r.manufacturing_orders.id}`} className="text-primary hover:underline">MO {r.manufacturing_orders.code}</Link>}
                        {!r.sale_orders && !r.manufacturing_orders && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-xs">{r.partners?.name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className={`p-2 text-xs ${late ? "text-rose-600 font-medium" : ""}`}>{r.needed_by ? new Date(r.needed_by).toLocaleDateString("pt-PT") : "—"}</td>
                      <td className="p-2"><Badge className={`${stateTone(r.state)} text-white`}>{STATE_LABEL[r.state]}</Badge></td>
                      <td className="p-2 text-xs">
                        {r.purchase_orders ? (
                          <Link to={`/purchase/orders/${r.purchase_orders.id}`} className="text-primary hover:underline">{r.purchase_orders.name}</Link>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-right">
                        {!["received", "cancelled"].includes(r.state) && (
                          <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancelar</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
