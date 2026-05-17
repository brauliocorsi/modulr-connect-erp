import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShoppingBag, AlertTriangle, Clock, CheckCircle2, ArrowRight } from "lucide-react";

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
const ERR_LABEL: Record<string, string> = {
  NEED_CANCELLED: "Necessidade cancelada.",
  NEED_RECEIVED: "Necessidade já recebida.",
  NEED_NO_REMAINING_QTY: "Sem quantidade restante a encomendar.",
  NEED_VARIANT_REQUIRED: "Selecione a variante do produto antes de encomendar.",
  NEED_SUPPLIER_SELECTION: "Selecione um fornecedor — produto sem fornecedor preferencial.",
  MIXED_SUPPLIER_SELECTION: "Fornecedor selecionado é incompatível com necessidades de outros fornecedores.",
  permission_denied: "Sem permissão para criar pedidos de compra.",
};
const mapError = (msg: string) => {
  const k = Object.keys(ERR_LABEL).find((k) => msg.includes(k));
  return k ? ERR_LABEL[k] : msg;
};

type Row = any;

export default function PurchaseNeedsList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [state, setState] = useState<string>("open");
  const [origin, setOrigin] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertNeeds, setConvertNeeds] = useState<Row[]>([]);
  const [forceSupplier, setForceSupplier] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["purchase_needs", state, origin],
    queryFn: async () => {
      let q = supabase
        .from("purchase_needs")
        .select(
          "id, qty_needed, origin_kind, state, needed_by, priority, created_at, notes, product_variant_id, " +
            "products(id,name,internal_ref), product_variants:product_variant_id(id,sku), " +
            "partners:suggested_partner_id(id,name), sale_orders(id,name), " +
            "manufacturing_orders(id,code), purchase_orders(id,name,state)",
        )
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

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-suppliers"],
    queryFn: async () => {
      const { data } = await supabase.from("partners").select("id,name").eq("is_supplier", true).order("name").limit(500);
      return data ?? [];
    },
  });

  const filtered = useMemo(
    () =>
      rows.filter((r: Row) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          (r.products?.name ?? "").toLowerCase().includes(s) ||
          (r.partners?.name ?? "").toLowerCase().includes(s) ||
          (r.product_variants?.sku ?? "").toLowerCase().includes(s)
        );
      }),
    [rows, search],
  );

  const counts = {
    pending: rows.filter((r: Row) => r.state === "pending").length,
    po: rows.filter((r: Row) => r.state === "po_created" || r.state === "partially_received").length,
    late: rows.filter(
      (r: Row) => r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state),
    ).length,
    received: rows.filter((r: Row) => r.state === "received").length,
  };

  const selectableRows = filtered.filter(
    (r: Row) => !["received", "cancelled", "po_created", "partially_received"].includes(r.state),
  );
  const allSelected = selectableRows.length > 0 && selectableRows.every((r: Row) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableRows.map((r: Row) => r.id)));
  };
  const toggleOne = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const openConvert = (needs: Row[]) => {
    setConvertNeeds(needs);
    // Pre-fill supplier if all share one
    const suppliers = new Set(needs.map((n) => n.partners?.id).filter(Boolean));
    setForceSupplier(suppliers.size === 1 ? (needs[0].partners?.id ?? "") : "");
    setExpectedDate("");
    setConvertOpen(true);
  };

  const cancel = async (id: string) => {
    if (!confirm("Cancelar esta necessidade?")) return;
    const { error } = await supabase.rpc("cancel_purchase_need" as any, { _id: id });
    if (error) return toast.error(mapError(error.message));
    toast.success("Cancelada");
    qc.invalidateQueries({ queryKey: ["purchase_needs"] });
  };

  const submitConvert = async () => {
    if (convertNeeds.length === 0) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("purchase_needs_create_po" as any, {
      _need_ids: convertNeeds.map((n) => n.id),
      _supplier_id: forceSupplier || null,
      _expected_date: expectedDate || null,
    });
    setSubmitting(false);
    if (error) return toast.error(mapError(error.message));
    const created = (data as any)?.created ?? [];
    const linked = (data as any)?.already_linked ?? [];
    const poIds = Array.from(new Set([...created.map((c: any) => c.purchase_order_id), ...linked.map((c: any) => c.purchase_order_id)]));
    toast.success(
      `Criados ${created.length} linhas em ${poIds.length} pedido(s).` +
        (linked.length ? ` ${linked.length} já vinculadas.` : ""),
    );
    setConvertOpen(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["purchase_needs"] });
    if (poIds.length === 1) nav(`/purchase/orders/${poIds[0]}`);
  };

  return (
    <>
      <PageHeader title="Necessidades de Compra" breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Necessidades" }]} />
      <PageBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-3 w-3" />Pendentes</div><div className="text-2xl font-semibold">{counts.pending}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><ShoppingBag className="h-3 w-3" />Em PO</div><div className="text-2xl font-semibold">{counts.po}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><Clock className="h-3 w-3" />Atrasadas</div><div className="text-2xl font-semibold text-rose-600">{counts.late}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-3 w-3" />Recebidas</div><div className="text-2xl font-semibold text-emerald-600">{counts.received}</div></Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <Input className="h-9 w-56" placeholder="Buscar produto / fornecedor / variante…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            <div className="flex-1" />
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => openConvert(filtered.filter((r: Row) => selected.has(r.id)))}
            >
              <ShoppingBag className="h-4 w-4" />
              Gerar Pedidos ({selected.size})
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-8 p-2"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                  <th className="text-left p-2">Produto</th>
                  <th className="text-left p-2 w-24">Variante</th>
                  <th className="text-right p-2 w-20">Qtd</th>
                  <th className="text-left p-2 w-28">Origem</th>
                  <th className="text-left p-2 w-44">Referência</th>
                  <th className="text-left p-2 w-40">Fornecedor sugerido</th>
                  <th className="text-left p-2 w-28">Prazo</th>
                  <th className="text-left p-2 w-32">Estado</th>
                  <th className="text-left p-2 w-32">PO</th>
                  <th className="w-40 p-2" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">A carregar…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">Sem necessidades</td></tr>
                ) : filtered.map((r: Row) => {
                  const late = r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state);
                  const canSelect = !["received", "cancelled", "po_created", "partially_received"].includes(r.state);
                  const canCreatePO = canSelect;
                  const canCancel = !["received", "cancelled", "po_created", "partially_received"].includes(r.state);
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        {canSelect && <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />}
                      </td>
                      <td className="p-2">
                        <Link to={`/products/${r.products?.id}`} className="text-primary hover:underline font-medium">{r.products?.name}</Link>
                        {r.products?.internal_ref && <div className="text-xs text-muted-foreground">{r.products.internal_ref}</div>}
                      </td>
                      <td className="p-2 text-xs">
                        {r.product_variants?.sku ? <Badge variant="outline">{r.product_variants.sku}</Badge> : <span className="text-muted-foreground">—</span>}
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
                      <td className="p-2 text-right whitespace-nowrap">
                        {canCreatePO && (
                          <Button size="sm" variant="default" onClick={() => openConvert([r])} className="mr-1">
                            <ArrowRight className="h-3 w-3" />Criar Pedido
                          </Button>
                        )}
                        {canCancel && (
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

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Criar Pedido de Compra</DialogTitle>
            <DialogDescription>
              {convertNeeds.length} necessidade(s). Necessidades de fornecedores diferentes vão gerar pedidos separados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-64 overflow-y-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Produto</th>
                    <th className="text-left p-2">Variante</th>
                    <th className="text-right p-2">Qtd</th>
                    <th className="text-left p-2">Fornecedor sugerido</th>
                    <th className="text-left p-2">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {convertNeeds.map((n) => (
                    <tr key={n.id} className="border-t">
                      <td className="p-2">{n.products?.name}</td>
                      <td className="p-2">{n.product_variants?.sku ?? "—"}</td>
                      <td className="p-2 text-right">{Number(n.qty_needed).toLocaleString("pt-PT")}</td>
                      <td className="p-2">{n.partners?.name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2">{n.manufacturing_orders?.code ?? n.sale_orders?.name ?? ORIGIN_LABEL[n.origin_kind]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Forçar fornecedor (opcional)</label>
                <Select value={forceSupplier || "auto"} onValueChange={(v) => setForceSupplier(v === "auto" ? "" : v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático (sugerido / preferencial)</SelectItem>
                    {partners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Data esperada (opcional)</label>
                <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="h-9" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvertOpen(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={submitConvert} disabled={submitting}>
              {submitting ? "A criar…" : "Confirmar e Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
