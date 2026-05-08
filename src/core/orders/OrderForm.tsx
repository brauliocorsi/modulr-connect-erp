import { fmtMoney } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { FulfillmentBadge } from "@/core/orders/FulfillmentBadge";
import { OrderTraceability } from "@/core/orders/OrderTraceability";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

type Line = {
  id?: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct?: number;
  tax_pct?: number;
  subtotal: number;
};

const STATE_TONES: Record<string, "default" | "success" | "warning" | "info" | "destructive"> = {
  draft: "default",
  sent: "info",
  rfq_sent: "info",
  confirmed: "warning",
  done: "success",
  cancelled: "destructive",
};

export default function OrderForm({ kind }: { kind: "sale" | "purchase" }) {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const ordersTable = kind === "sale" ? "sale_orders" : "purchase_orders";
  const linesTable = kind === "sale" ? "sale_order_lines" : "purchase_order_lines";
  const partnerFlag = kind === "sale" ? "is_customer" : "is_supplier";
  const basePath = kind === "sale" ? "/sales/orders" : "/purchase/orders";
  const moduleLabel = kind === "sale" ? "Vendas" : "Compras";

  const [order, setOrder] = useState<any>({
    name: "Rascunho",
    state: "draft",
    partner_id: null,
    notes: "",
    amount_total: 0,
    amount_untaxed: 0,
    amount_tax: 0,
  });
  const [lines, setLines] = useState<Line[]>([]);

  const { data: partners } = useQuery({
    queryKey: ["partners-of", partnerFlag],
    queryFn: async () =>
      (await supabase.from("partners").select("id,name").eq(partnerFlag, true).order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,list_price,standard_cost").order("name")).data ?? [],
  });
  const { data: stockMap } = useQuery({
    queryKey: ["products-stock-agg"],
    queryFn: async () => {
      const { data } = await supabase.from("product_stock_forecast").select("product_id,available,on_hand,incoming");
      const m: Record<string, { available: number; on_hand: number; incoming: number }> = {};
      (data ?? []).forEach((r: any) => {
        const k = r.product_id;
        if (!m[k]) m[k] = { available: 0, on_hand: 0, incoming: 0 };
        m[k].available += Number(r.available || 0);
        m[k].on_hand += Number(r.on_hand || 0);
        m[k].incoming += Number(r.incoming || 0);
      });
      return m;
    },
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: o } = await supabase.from(ordersTable as any).select("*").eq("id", id!).maybeSingle();
      if (o) setOrder(o);
      const { data: ls } = await supabase.from(linesTable as any).select("*").eq("order_id", id!).order("sequence");
      setLines((ls ?? []) as unknown as Line[]);
    })();
  }, [id, isNew, ordersTable, linesTable]);

  const totals = useMemo(() => {
    const untaxed = lines.reduce((s, l) => s + Number(l.subtotal || 0), 0);
    return { untaxed, tax: 0, total: untaxed };
  }, [lines]);

  const setLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => {
      const next = [...prev];
      const L = { ...next[idx], ...patch };
      const qty = Number(L.quantity || 0);
      const price = Number(L.unit_price || 0);
      const disc = Number(L.discount_pct || 0);
      L.subtotal = qty * price * (1 - disc / 100);
      next[idx] = L;
      return next;
    });
  };

  const addLine = () =>
    setLines((p) => [...p, { product_id: null, description: "", quantity: 1, unit_price: 0, subtotal: 0 }]);

  const removeLine = async (idx: number) => {
    const l = lines[idx];
    if (l.id) await supabase.from(linesTable as any).delete().eq("id", l.id);
    setLines((p) => p.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!order.partner_id) return toast.error(kind === "sale" ? "Selecione um cliente" : "Selecione um fornecedor");
    let oid = id as string | undefined;
    const payload: any = {
      partner_id: order.partner_id,
      notes: order.notes,
      amount_untaxed: totals.untaxed,
      amount_tax: totals.tax,
      amount_total: totals.total,
    };
    if (isNew) {
      const { data: seqRes } = await supabase.rpc("next_sequence", { _code: kind === "sale" ? "sale_order" : "purchase_order" });
      payload.name = seqRes ?? "TMP";
      const { data, error } = await supabase.from(ordersTable as any).insert(payload).select("id, name").single();
      if (error) return toast.error(error.message);
      oid = (data as any).id;
      setOrder((o: any) => ({ ...o, id: oid, name: (data as any).name }));
    } else {
      const { error } = await supabase.from(ordersTable as any).update(payload).eq("id", oid!);
      if (error) return toast.error(error.message);
    }
    // upsert lines
    for (const l of lines) {
      if (!l.product_id) continue;
      const lp: any = {
        order_id: oid,
        product_id: l.product_id,
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct ?? 0,
        tax_pct: l.tax_pct ?? 0,
        subtotal: l.subtotal,
      };
      if (l.id) await supabase.from(linesTable as any).update(lp).eq("id", l.id);
      else await supabase.from(linesTable as any).insert(lp);
    }
    toast.success("Salvo");
    if (isNew && oid) nav(`${basePath}/${oid}`);
  };

  const confirmOrder = async () => {
    if (isNew) return toast.error("Salve antes");
    // Re-check current state to avoid double-confirm with stale UI
    const { data: cur } = await supabase.from(ordersTable as any).select("state").eq("id", id!).maybeSingle();
    const curState = (cur as any)?.state;
    if (curState && !["draft", "sent"].includes(curState)) {
      setOrder((o: any) => ({ ...o, state: curState }));
      return toast.info(`Pedido já está em "${curState}"`);
    }
    const fn = kind === "sale" ? "confirm_sale_order" : "confirm_purchase_order";
    const { error } = await supabase.rpc(fn as any, { _order: id });
    if (error) {
      const { data } = await supabase.from(ordersTable as any).select("state").eq("id", id!).maybeSingle();
      if (data) setOrder((o: any) => ({ ...o, state: (data as any).state }));
      return toast.error(error.message);
    }
    toast.success(kind === "sale" ? "Pedido confirmado e transferência criada" : "Compra confirmada e recebimento criado");
    const { data } = await supabase.from(ordersTable as any).select("state").eq("id", id!).maybeSingle();
    setOrder((o: any) => ({ ...o, state: (data as any)?.state }));
  };

  const cancelOrder = async () => {
    if (!confirm("Cancelar?")) return;
    const fn = kind === "sale" ? "cancel_sale_order" : "cancel_purchase_order";
    await supabase.rpc(fn as any, { _order: id });
    toast.success("Cancelado");
    setOrder((o: any) => ({ ...o, state: "cancelled" }));
  };

  const isLocked = ["confirmed", "done", "cancelled"].includes(order.state);

  return (
    <>
      <FormHeader
        title={order.name || "Novo"}
        breadcrumb={[
          { label: moduleLabel, to: kind === "sale" ? "/sales" : "/purchase" },
          { label: kind === "sale" ? "Pedidos" : "Pedidos de Compra", to: basePath },
          { label: order.name || "Novo" },
        ]}
        backTo={basePath}
        state={{ label: order.state, tone: STATE_TONES[order.state] ?? "default" }}
        actions={
          <div className="flex gap-2 items-center">
            {kind === "sale" && <FulfillmentBadge status={order.fulfillment_status} />}
            {!isLocked && (
              <Button size="sm" variant="outline" onClick={save}>
                Salvar
              </Button>
            )}
            {!isLocked && !isNew && (
              <Button size="sm" onClick={confirmOrder}>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {kind === "sale" ? "Confirmar venda" : "Confirmar compra"}
              </Button>
            )}
            {!["cancelled", "done"].includes(order.state) && !isNew && (
              <Button size="sm" variant="ghost" onClick={cancelOrder}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-6 grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{kind === "sale" ? "Cliente" : "Fornecedor"}</Label>
                <Select
                  value={order.partner_id ?? ""}
                  onValueChange={(v) => setOrder({ ...order, partner_id: v })}
                  disabled={isLocked}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {partners?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Input value={order.notes ?? ""} onChange={(e) => setOrder({ ...order, notes: e.target.value })} disabled={isLocked} />
              </div>
            </Card>

            <Card>
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="font-semibold">Linhas</div>
                {!isLocked && (
                  <Button size="sm" variant="outline" onClick={addLine}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar linha
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2">Produto</th>
                      <th className="text-left px-3 py-2 w-28">Stock</th>
                      <th className="text-left px-3 py-2 w-32">Qtd</th>
                      <th className="text-left px-3 py-2 w-40">Preço unit.</th>
                      {kind === "sale" && <th className="text-left px-3 py-2 w-24">Desc %</th>}
                      <th className="text-right px-3 py-2 w-32">Subtotal</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem linhas</td></tr>
                    ) : lines.map((l, i) => {
                      const s = l.product_id ? stockMap?.[l.product_id] : undefined;
                      const avail = s?.available ?? 0;
                      const qty = Number(l.quantity || 0);
                      const tone = !l.product_id ? "text-muted-foreground"
                        : avail >= qty ? "text-emerald-600"
                        : avail > 0 ? "text-amber-600" : "text-rose-600";
                      return (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">
                          <Select
                            value={l.product_id ?? ""}
                            onValueChange={(v) => {
                              const p = products?.find((x: any) => x.id === v);
                              setLine(i, {
                                product_id: v,
                                unit_price: kind === "sale" ? Number(p?.list_price ?? 0) : Number(p?.standard_cost ?? 0),
                                description: p?.name ?? "",
                              });
                            }}
                            disabled={isLocked}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Produto…" /></SelectTrigger>
                            <SelectContent>
                              {products?.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          {l.product_id ? (
                            <div className={`text-xs ${tone}`}>
                              <div className="font-medium">{avail} disp.</div>
                              {s?.incoming ? <div className="text-[10px] text-muted-foreground">+{s.incoming} a chegar</div> : null}
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-2 py-1">
                          <Input className="h-8" type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} disabled={isLocked} />
                        </td>
                        <td className="px-2 py-1">
                          <Input className="h-8" type="number" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: Number(e.target.value) })} disabled={isLocked} />
                        </td>
                        {kind === "sale" && (
                          <td className="px-2 py-1">
                            <Input className="h-8" type="number" step="0.01" value={l.discount_pct ?? 0} onChange={(e) => setLine(i, { discount_pct: Number(e.target.value) })} disabled={isLocked} />
                          </td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.subtotal)}</td>
                        <td>
                          {!isLocked && (
                            <Button variant="ghost" size="icon" onClick={() => removeLine(i)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td colSpan={kind === "sale" ? 5 : 4} className="px-3 py-2 text-right">Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totals.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {!isNew && kind === "sale" && <OrderTraceability saleOrderId={id!} />}
            {!isNew && <RecordSidebar recordType={kind === "sale" ? "sale_order" : "purchase_order"} recordId={id!} />}
          </div>

          <aside className="space-y-4">
            <Card className="p-4 text-sm">
              <div className="o-section-title mb-2">Resumo</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Linhas</span><span>{lines.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(totals.untaxed)}</span></div>
              <div className="flex justify-between font-semibold mt-2"><span>Total</span><span>{fmtMoney(totals.total)}</span></div>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
