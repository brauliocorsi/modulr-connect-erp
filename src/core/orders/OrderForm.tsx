import { fmtMoney } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { FulfillmentBadge } from "@/core/orders/FulfillmentBadge";
import { PaymentStatusBadge } from "@/core/orders/PaymentStatusBadge";
import { InvoiceStatusBadge } from "@/core/orders/InvoiceStatusBadge";
import { MarkInvoicedDialog } from "@/core/orders/MarkInvoicedDialog";
import { FileCheck2 } from "lucide-react";
import { OrderTraceability } from "@/core/orders/OrderTraceability";
import { SmartButtons } from "@/core/orders/SmartButtons";
import { PaymentsTab } from "@/core/orders/PaymentsTab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, CheckCircle2, X, Printer, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { printSaleOrder } from "./printSaleOrder";
import { NumberField } from "@/core/forms/NumberField";

type Line = {
  id?: string;
  product_id: string | null;
  variant_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct?: number;
  tax_pct?: number;
  subtotal: number;
  line_kind?: string;
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
      (await supabase.from("products").select("id,name,list_price,standard_cost,image_url,barcode,assembly_fee,delivery_surcharge,uom_id, product_uom!products_uom_id_fkey(category)").order("name")).data ?? [],
  });
  const { data: zipRules } = useQuery({
    queryKey: ["delivery_zip_rules_active"],
    queryFn: async () =>
      (await supabase.from("delivery_zip_rules").select("id,label,zip_from,zip_to,price").eq("active", true).order("zip_from")).data ?? [],
  });
  const { data: regionRules } = useQuery({
    queryKey: ["delivery_region_rules_active"],
    queryFn: async () =>
      (await supabase.from("delivery_region_rules").select("id,region,country,price").eq("active", true).order("region")).data ?? [],
  });
  const { data: variantsByProduct } = useQuery({
    queryKey: ["product-variants-by-product"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_variants")
        .select("id, product_id, sku, price_extra, active, image_url, product_variant_values(product_attribute_values(name))")
        .eq("active", true);
      const m: Record<string, { id: string; label: string; price_extra: number; image_url: string | null; sku: string | null }[]> = {};
      (data ?? []).forEach((v: any) => {
        const names = (v.product_variant_values || [])
          .map((x: any) => x.product_attribute_values?.name)
          .filter(Boolean)
          .join(" / ");
        const label = names || v.sku || "Variante";
        (m[v.product_id] ||= []).push({ id: v.id, label, price_extra: Number(v.price_extra || 0), image_url: v.image_url, sku: v.sku });
      });
      return m;
    },
  });
  const { data: shipment } = useQuery({
    enabled: kind === "sale" && !!order.name && order.name !== "Rascunho",
    queryKey: ["sale-shipment", order.name],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,done_at")
        .eq("kind", "outgoing")
        .eq("origin", order.name)
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
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
  const { data: variantStockMap } = useQuery({
    queryKey: ["variants-stock-agg"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_quants")
        .select("variant_id,quantity,reserved_quantity,stock_locations!inner(type)")
        .eq("stock_locations.type", "internal")
        .not("variant_id", "is", null);
      const m: Record<string, { available: number; on_hand: number }> = {};
      (data ?? []).forEach((r: any) => {
        const k = r.variant_id as string;
        if (!m[k]) m[k] = { available: 0, on_hand: 0 };
        m[k].on_hand += Number(r.quantity || 0);
        m[k].available += Number(r.quantity || 0) - Number(r.reserved_quantity || 0);
      });
      return m;
    },
  });

  useEffect(() => {
    if (isNew) return;
    const reload = async () => {
      const { data: o } = await supabase.from(ordersTable as any).select("*").eq("id", id!).maybeSingle();
      if (o) setOrder(o);
      const { data: ls } = await supabase.from(linesTable as any).select("*").eq("order_id", id!).order("sequence");
      setLines((ls ?? []) as unknown as Line[]);
    };
    reload();
    let timer: any;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(reload, 300); };
    const channel = supabase
      .channel(`order-${ordersTable}-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: ordersTable, filter: `id=eq.${id}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: linesTable, filter: `order_id=eq.${id}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_pickings" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_moves" }, debounced)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [id, isNew, ordersTable, linesTable]);

  const productLines = useMemo(() => lines.filter((l) => (l.line_kind ?? "product") === "product"), [lines]);
  const serviceLines = useMemo(() => lines.filter((l) => (l.line_kind ?? "product") !== "product"), [lines]);
  const totals = useMemo(() => {
    const untaxed = lines.reduce((s, l) => s + Number(l.subtotal || 0), 0);
    return { untaxed, tax: 0, total: untaxed };
  }, [lines]);

  const refreshServices = async (oid: string) => {
    const { error } = await supabase.rpc("refresh_order_services" as any, { _order: oid });
    if (error) return toast.error(error.message);
    const { data: o } = await supabase.from("sale_orders").select("*").eq("id", oid).maybeSingle();
    if (o) setOrder(o);
    const { data: ls } = await supabase.from(linesTable as any).select("*").eq("order_id", oid).order("sequence");
    setLines((ls ?? []) as unknown as Line[]);
  };

  const toggleService = async (key: "include_assembly" | "include_delivery", value: boolean) => {
    if (isNew) return toast.error("Salve o pedido primeiro");
    setOrder((o: any) => ({ ...o, [key]: value }));
    await supabase.from("sale_orders").update({ [key]: value } as any).eq("id", id!);
    await refreshServices(id!);
  };

  const setDeliveryMode = async (mode: "delivery" | "pickup" | "direct") => {
    if (isNew) return toast.error("Salve o pedido primeiro");
    setOrder((o: any) => ({ ...o, delivery_mode: mode }));
    const { error } = await supabase.from("sale_orders").update({ delivery_mode: mode } as any).eq("id", id!);
    if (error) toast.error(error.message);
  };

  const setDeliveryZone = async (value: string) => {
    if (isNew) return toast.error("Salve o pedido primeiro");
    // value format: "zip:<id>" | "region:<id>" | "auto"
    const patch: any = { delivery_zip_rule_id: null, delivery_region_rule_id: null };
    if (value.startsWith("zip:")) patch.delivery_zip_rule_id = value.slice(4);
    else if (value.startsWith("region:")) patch.delivery_region_rule_id = value.slice(7);
    setOrder((o: any) => ({ ...o, ...patch }));
    await supabase.from("sale_orders").update(patch).eq("id", id!);
    if (order.include_delivery) await refreshServices(id!);
  };

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
    // Require variant when product has variants
    for (const l of lines) {
      if ((l.line_kind ?? "product") !== "product") continue;
      if (!l.product_id) continue;
      const vs = (variantsByProduct?.[l.product_id] ?? []).filter((v: any) => v.active !== false);
      if (vs.length > 0 && !l.variant_id) {
        const p = products?.find((x: any) => x.id === l.product_id);
        return toast.error(`Selecione a variante para "${p?.name ?? "produto"}"`);
      }
    }
    let oid = id as string | undefined;
    const payload: any = {
      partner_id: order.partner_id,
      notes: order.notes,
      amount_untaxed: totals.untaxed,
      amount_tax: totals.tax,
      amount_total: totals.total,
    };
    if (kind === "sale") payload.commitment_date = order.commitment_date ?? null;
    if (isNew) {
      const { data: seqRes } = await supabase.rpc("next_sequence", { _code: kind === "sale" ? "sale_order" : "purchase_order" });
      payload.name = seqRes ?? "TMP";
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (uid) {
        payload.created_by = uid;
        if (kind === "purchase") payload.buyer_id = uid;
        else payload.salesperson_id = uid;
      }
      const { data, error } = await supabase.from(ordersTable as any).insert(payload).select("id, name").single();
      if (error) return toast.error(error.message);
      oid = (data as any).id;
      setOrder((o: any) => ({ ...o, id: oid, name: (data as any).name }));
    } else {
      const { error } = await supabase.from(ordersTable as any).update(payload).eq("id", oid!);
      if (error) return toast.error(error.message);
    }
    // upsert lines (only product lines; service lines are managed by RPC)
    for (const l of lines) {
      if ((l.line_kind ?? "product") !== "product") continue;
      if (!l.product_id) continue;
      const lp: any = {
        order_id: oid,
        product_id: l.product_id,
        variant_id: l.variant_id ?? null,
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
    if (kind === "sale" && oid && (order.include_assembly || order.include_delivery)) {
      await refreshServices(oid);
    }
    toast.success("Salvo");
    if (isNew && oid) nav(`${basePath}/${oid}`);
  };

  const confirmOrder = async () => {
    if (isNew) return toast.error("Salve antes");
    // Auto-save pending edits (e.g. newly added lines) before confirming
    await save();
    // Verify lines were actually persisted with quantity > 0
    const { count: lineCount } = await supabase
      .from(linesTable as any)
      .select("id", { count: "exact", head: true })
      .eq("order_id", id!)
      .gt("quantity", 0);
    if (!lineCount) {
      return toast.error("Adicione ao menos uma linha com quantidade maior que 0 antes de confirmar.");
    }
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
  const [invDlg, setInvDlg] = useState(false);

  const revertInvoice = async () => {
    if (!confirm("Reverter faturação?")) return;
    await supabase.from("sale_orders").update({ invoice_status: "not_invoiced", invoice_number: null, invoice_date: null }).eq("id", id!);
    const { data } = await supabase.from("sale_orders").select("invoice_status,invoice_number,invoice_date,invoice_notes").eq("id", id!).maybeSingle();
    if (data) setOrder((o: any) => ({ ...o, ...data }));
  };

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
            {kind === "sale" && <PaymentStatusBadge status={order.payment_status} />}
            {kind === "sale" && !isNew && <InvoiceStatusBadge status={order.invoice_status} />}
            {kind === "sale" && !isNew && order.invoice_status !== "invoiced" && (
              <Button size="sm" variant="outline" onClick={() => setInvDlg(true)}>
                <FileCheck2 className="h-4 w-4 mr-1" /> Marcar faturado
              </Button>
            )}
            {kind === "sale" && !isNew && order.invoice_status === "invoiced" && (
              <Button size="sm" variant="ghost" onClick={revertInvoice}>Reverter fatura</Button>
            )}
            {kind === "sale" && !isNew && (
              <Button size="sm" variant="outline" onClick={() => printSaleOrder(id!)}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir / PDF
              </Button>
            )}
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
            {!isNew && order.name && order.name !== "Rascunho" && (
              <SmartButtons kind={kind} orderName={order.name} />
            )}
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
              {kind === "sale" && (
                <div className="space-y-2">
                  <Label>Data de entrega prometida</Label>
                  <Input
                    type="date"
                    value={order.commitment_date ?? ""}
                    onChange={(e) => setOrder({ ...order, commitment_date: e.target.value || null })}
                    disabled={isLocked}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Notas</Label>
                <Input value={order.notes ?? ""} onChange={(e) => setOrder({ ...order, notes: e.target.value })} disabled={isLocked} />
              </div>
            </Card>

            {kind === "sale" && shipment && (
              <Card className="p-3 flex items-center gap-3 border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div className="text-sm flex-1">
                  <span className="font-medium">Entrega programada</span> — {shipment.name}
                  {shipment.scheduled_at && <> · prevista {new Date(shipment.scheduled_at).toLocaleString("pt-PT")}</>}
                  {shipment.done_at && <> · entregue {new Date(shipment.done_at).toLocaleString("pt-PT")}</>}
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={`/inventory/transfers/${shipment.id}`}>Abrir</a>
                </Button>
              </Card>
            )}

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
                      <th className="text-left px-3 py-2 w-24">Stock</th>
                      <th className="text-center px-3 py-2 w-36">Qtd</th>
                      <th className="text-right px-3 py-2 w-40">Preço unit.</th>
                      {kind === "sale" && <th className="text-right px-3 py-2 w-28">Desc</th>}
                      <th className="text-right px-3 py-2 w-32">Subtotal</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productLines.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem linhas</td></tr>
                    ) : productLines.map((l) => {
                      const i = lines.indexOf(l);
                      const ps = l.product_id ? stockMap?.[l.product_id] : undefined;
                      const product = products?.find((x: any) => x.id === l.product_id);
                      const productVariants = l.product_id ? variantsByProduct?.[l.product_id] ?? [] : [];
                      const productHasVariants = productVariants.length > 0;
                      const vs = l.variant_id ? variantStockMap?.[l.variant_id] : undefined;
                      // Se o produto tem variantes, o stock só é válido por variante.
                      // Sem variante selecionada → 0 (força a escolha). Variante sem entrada de stock → 0.
                      const avail = productHasVariants
                        ? (l.variant_id ? (vs?.available ?? 0) : 0)
                        : (ps?.available ?? 0);
                      const qty = Number(l.quantity || 0);
                      const tone = !l.product_id ? "text-muted-foreground"
                        : avail >= qty ? "text-emerald-600"
                        : avail > 0 ? "text-amber-600" : "text-rose-600";
                      return (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1 min-w-[280px]">
                          {(() => {
                            const product = products?.find((x: any) => x.id === l.product_id);
                            const variants = l.product_id ? variantsByProduct?.[l.product_id] ?? [] : [];
                            const variant = variants.find((x) => x.id === l.variant_id);
                            const thumb = variant?.image_url || product?.image_url;
                            return (
                              <div className="flex items-start gap-2">
                                <div className="w-11 h-11 rounded border bg-muted/30 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-muted-foreground">—</span>}
                                </div>
                                <div className="flex-1 space-y-1">
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 w-full justify-between font-normal"
                                        disabled={isLocked}
                                      >
                                        <span className="truncate text-left">
                                          {product?.name ?? <span className="text-muted-foreground">Produto…</span>}
                                        </span>
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="p-0 w-[420px]" align="start">
                                      <Command>
                                        <CommandInput placeholder="Buscar por nome, SKU ou código…" />
                                        <CommandList>
                                          <CommandEmpty>Nenhum produto</CommandEmpty>
                                          <CommandGroup>
                                            {products?.map((p: any) => (
                                              <CommandItem
                                                key={p.id}
                                                value={`${p.name} ${p.barcode ?? ""}`}
                                                onSelect={() => {
                                                  const pvs = (variantsByProduct?.[p.id] ?? []).filter((v: any) => v.active !== false);
                                                  const onlyV = pvs.length === 1 ? pvs[0] : null;
                                                  const base = kind === "sale" ? Number(p.list_price ?? 0) : Number(p.standard_cost ?? 0);
                                                  setLine(i, {
                                                    product_id: p.id,
                                                    variant_id: onlyV?.id ?? null,
                                                    unit_price: base + Number(onlyV?.price_extra ?? 0),
                                                    description: `${p.name ?? ""}${onlyV ? ` — ${onlyV.label}` : ""}`,
                                                  });
                                                  (document.activeElement as HTMLElement)?.blur();
                                                }}
                                                className="gap-2"
                                              >
                                                <div className="w-8 h-8 rounded border bg-muted/30 overflow-hidden flex-shrink-0">
                                                  {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <div className="truncate">{p.name}</div>
                                                  {p.barcode && <div className="text-[10px] text-muted-foreground font-mono">{p.barcode}</div>}
                                                </div>
                                                <div className="text-xs tabular-nums text-muted-foreground">{fmtMoney(Number(kind === "sale" ? p.list_price : p.standard_cost) || 0)}</div>
                                                {l.product_id === p.id && <Check className="h-3 w-3" />}
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        </CommandList>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>

                                  {variants.length > 0 && (
                                    <div className="space-y-1">
                                      <Select
                                        value={l.variant_id ?? ""}
                                        onValueChange={(v) => {
                                          const p = products?.find((x: any) => x.id === l.product_id);
                                          const vt = variants.find((x) => x.id === v);
                                          const base = kind === "sale" ? Number(p?.list_price ?? 0) : Number(p?.standard_cost ?? 0);
                                          setLine(i, {
                                            variant_id: v,
                                            unit_price: base + Number(vt?.price_extra ?? 0),
                                            description: `${p?.name ?? ""}${vt ? ` — ${vt.label}` : ""}`,
                                          });
                                        }}
                                        disabled={isLocked}
                                      >
                                        <SelectTrigger
                                          className={`h-7 text-xs ${!l.variant_id ? "border-destructive ring-1 ring-destructive/40 bg-destructive/5" : ""}`}
                                        >
                                          <SelectValue placeholder="⚠ Escolher variante (obrigatório)…" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {variants.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>
                                              {v.label}{v.price_extra ? ` (+${fmtMoney(v.price_extra)})` : ""}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {!l.variant_id ? (
                                        <div className="flex items-center gap-1 text-[10px] text-destructive font-medium">
                                          <span>⚠ Este produto tem {variants.length} variante(s). Selecione uma para continuar.</span>
                                        </div>
                                      ) : variant && (
                                        <div className="flex flex-wrap gap-1">
                                          {variant.label.split(" / ").map((t, k) => (
                                            <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                                          ))}
                                          {variant.sku && <span className="text-[10px] text-muted-foreground font-mono ml-1">SKU {variant.sku}</span>}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1">
                          {l.product_id ? (
                            <div className={`text-xs ${tone}`}>
                              <div className="font-medium">{avail} disp.</div>
                              {ps?.incoming ? <div className="text-[10px] text-muted-foreground">+{ps.incoming} a chegar</div> : null}
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-2 py-1">
                          {(() => {
                            const prod = products?.find((x: any) => x.id === l.product_id);
                            const cat = prod?.product_uom?.category;
                            const isInt = !cat || cat === "unit";
                            return (
                              <NumberField
                                value={Number(l.quantity || 0)}
                                onChange={(v) => setLine(i, { quantity: isInt ? Math.max(0, Math.floor(v)) : v })}
                                step={isInt ? 1 : 0.5}
                                min={0}
                                decimals={isInt ? 0 : 2}
                                disabled={isLocked}
                              />
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1">
                          <NumberField
                            value={Number(l.unit_price || 0)}
                            onChange={(v) => setLine(i, { unit_price: v })}
                            step={1}
                            min={0}
                            decimals={2}
                            prefix="€"
                            showStepper={false}
                            disabled={isLocked}
                          />
                        </td>
                        {kind === "sale" && (
                          <td className="px-2 py-1">
                            <NumberField
                              value={Number(l.discount_pct ?? 0)}
                              onChange={(v) => setLine(i, { discount_pct: v })}
                              step={5}
                              min={0}
                              max={100}
                              decimals={0}
                              suffix="%"
                              showStepper={false}
                              disabled={isLocked}
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtMoney(l.subtotal)}
                          {kind === "sale" && Number(l.discount_pct || 0) > 0 && (
                            <div className="text-[10px] text-muted-foreground line-through">
                              {fmtMoney(Number(l.quantity || 0) * Number(l.unit_price || 0))}
                            </div>
                          )}
                        </td>
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
                  <tfoot className="bg-muted/30">
                    {kind === "sale" && totals.untaxed !== totals.total && (
                      <tr className="border-t">
                        <td colSpan={kind === "sale" ? 5 : 4} className="px-3 py-1.5 text-right text-sm text-muted-foreground">Subtotal sem imposto</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-sm">{fmtMoney(totals.untaxed)}</td>
                        <td />
                      </tr>
                    )}
                    <tr className="border-t font-semibold text-base">
                      <td colSpan={kind === "sale" ? 5 : 4} className="px-3 py-2.5 text-right">Total</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-primary">{fmtMoney(totals.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {kind === "sale" && !isNew && (
              <Card className="p-4 space-y-3">
                <div className="font-semibold">Serviços</div>
                <div className="p-3 rounded border space-y-2">
                  <Label className="text-sm font-medium">Modo de entrega</Label>
                  <Select value={order.delivery_mode ?? "delivery"} onValueChange={(v: any) => setDeliveryMode(v)} disabled={isLocked}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Entrega ao cliente (Stock → Cais → Em Entrega → Cliente)</SelectItem>
                      <SelectItem value="pickup">Levantamento no cais (Stock → Cais → Cliente)</SelectItem>
                      <SelectItem value="direct">Direto (Stock → Cliente)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Define a cadeia de transferências criada ao confirmar a venda.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="flex items-start gap-3 p-3 rounded border">
                    <Switch
                      checked={!!order.include_assembly}
                      onCheckedChange={(v) => toggleService("include_assembly", v)}
                      disabled={isLocked}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">Incluir montagem</div>
                      <div className="text-xs text-muted-foreground">Soma o valor de montagem definido em cada produto.</div>
                      {serviceLines.filter((l) => l.line_kind === "assembly").map((l) => (
                        <div key={l.id} className="text-sm mt-2 tabular-nums">{fmtMoney(l.subtotal)}</div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded border">
                    <Switch
                      checked={!!order.include_delivery}
                      onCheckedChange={(v) => toggleService("include_delivery", v)}
                      disabled={isLocked}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">Incluir entrega</div>
                      <div className="text-xs text-muted-foreground">
                        Calculada pelo código postal do cliente, com adicional dos produtos.
                      </div>
                      <div className="mt-2">
                        <Label className="text-xs">Zona de entrega</Label>
                        <Select
                          value={
                            order.delivery_zip_rule_id ? `zip:${order.delivery_zip_rule_id}` :
                            order.delivery_region_rule_id ? `region:${order.delivery_region_rule_id}` : "auto"
                          }
                          onValueChange={setDeliveryZone}
                          disabled={isLocked}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Automático (pelo cliente)</SelectItem>
                            {(zipRules ?? []).length > 0 && (
                              <>
                                <div className="px-2 py-1 text-xs text-muted-foreground">Por código postal</div>
                                {(zipRules ?? []).map((r: any) => (
                                  <SelectItem key={`z${r.id}`} value={`zip:${r.id}`}>
                                    {(r.label || `${r.zip_from}-${r.zip_to}`)} — {fmtMoney(r.price)}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                            {(regionRules ?? []).length > 0 && (
                              <>
                                <div className="px-2 py-1 text-xs text-muted-foreground">Por distrito / região</div>
                                {(regionRules ?? []).map((r: any) => (
                                  <SelectItem key={`r${r.id}`} value={`region:${r.id}`}>
                                    {r.region} ({r.country}) — {fmtMoney(r.price)}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      {order.delivery_zone_label && (
                        <div className="text-xs mt-1">Zona aplicada: <span className="font-medium">{order.delivery_zone_label}</span></div>
                      )}
                      {serviceLines.filter((l) => l.line_kind === "delivery").map((l) => (
                        <div key={l.id} className="text-sm mt-2 tabular-nums">{fmtMoney(l.subtotal)}</div>
                      ))}
                    </div>
                  </div>
                </div>
                {(order.include_assembly || order.include_delivery) && !isLocked && (
                  <Button size="sm" variant="outline" onClick={() => refreshServices(id!)}>
                    Recalcular serviços
                  </Button>
                )}
              </Card>
            )}

            {!isNew && kind === "sale" && (
              <PaymentsTab orderId={id!} partnerId={order.partner_id} total={Number(order.amount_total ?? totals.total)} isLocked={["cancelled"].includes(order.state)} />
            )}
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
