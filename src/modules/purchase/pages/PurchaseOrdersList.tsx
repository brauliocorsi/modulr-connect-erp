import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, ChevronDown, LayoutGrid, Merge } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { AdvancedFilters, FilterValues } from "@/core/filters/AdvancedFilters";
import { Card } from "@/components/ui/card";

const STATE_LABEL: Record<string, string> = {
  draft: "Rascunho",
  rfq_sent: "Enviado",
  confirmed: "Confirmado",
  done: "Concluído",
  cancelled: "Cancelado",
};

const STATE_VARIANT: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  draft: "secondary",
  rfq_sent: "outline",
  confirmed: "default",
  done: "default",
  cancelled: "destructive",
};

export const PurchaseOrdersList = () => {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterValues>({});

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-min"],
    queryFn: async () => (await supabase.from("partners").select("id,name").eq("is_supplier", true).order("name")).data ?? [],
  });
  const { data: warehousesOpt } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });

  const { data: orders = [], refetch } = useQuery({
    queryKey: ["purchase-orders-list", search, stateFilter],
    queryFn: async () => {
      let q = supabase
        .from("purchase_orders")
        .select("id, name, state, date_order, expected_date, amount_total, partner_id, warehouse_id, created_by, created_at, partners(name), warehouses(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (search) q = q.ilike("name", `%${search}%`);
      if (stateFilter !== "all") q = q.eq("state", stateFilter as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const orderIds = useMemo(() => orders.map((o: any) => o.id), [orders]);

  const { data: origins = [] } = useQuery({
    enabled: orderIds.length > 0,
    queryKey: ["po-origins", orderIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_order_origins")
        .select("po_id, sale_order_id, sale_orders(id,name)")
        .in("po_id", orderIds);
      return data ?? [];
    },
  });

  const { data: buyers = [] } = useQuery({
    enabled: orderIds.length > 0,
    queryKey: ["po-buyers", orderIds],
    queryFn: async () => {
      const ids = Array.from(new Set(orders.map((o: any) => o.created_by).filter(Boolean)));
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return data ?? [];
    },
  });

  const buyerMap = useMemo(() => {
    const m: Record<string, string> = {};
    (buyers as any[]).forEach((b) => (m[b.id] = b.full_name || b.email || "—"));
    return m;
  }, [buyers]);

  const originsByPo = useMemo(() => {
    const m: Record<string, { id: string; name: string }[]> = {};
    (origins as any[]).forEach((o) => {
      if (!o.sale_orders) return;
      (m[o.po_id] ||= []).push({ id: o.sale_orders.id, name: o.sale_orders.name });
    });
    return m;
  }, [origins]);

  const toggleExpand = (id: string) => {
    setExpanded((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const canMerge = useMemo(() => {
    if (selected.size < 2) return false;
    const sel = orders.filter((o: any) => selected.has(o.id));
    if (sel.length < 2) return false;
    const partner = sel[0].partner_id;
    const wh = sel[0].warehouse_id ?? null;
    return sel.every((o: any) => o.state === "draft" && o.partner_id === partner && (o.warehouse_id ?? null) === wh);
  }, [selected, orders]);

  const mergeSelected = async () => {
    const ids = Array.from(selected);
    const target = ids[0];
    const sources = ids.slice(1);
    const { error } = await (supabase.rpc as any)("merge_purchase_orders", { _target: target, _sources: sources });
    if (error) return toast.error(error.message);
    toast.success(`${sources.length} pedido(s) fundido(s)`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["purchase-orders-list"] });
    refetch();
  };

  const states = ["all", "draft", "rfq_sent", "confirmed", "done", "cancelled"];

  return (
    <>
      <PageHeader
        title="Pedidos de Compra"
        breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Pedidos" }]}
        onSearch={setSearch}
        createTo="/purchase/orders/new"
        actions={
          <>
            {canMerge && (
              <Button size="sm" variant="default" onClick={mergeSelected}>
                <Merge className="h-4 w-4 mr-1" /> Agrupar {selected.size}
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/purchase/kanban"><LayoutGrid className="h-4 w-4 mr-1" /> Kanban</Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex gap-2 mb-3 flex-wrap">
          {states.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={stateFilter === s ? "default" : "outline"}
              onClick={() => setStateFilter(s)}
            >
              {s === "all" ? "Todos" : STATE_LABEL[s] ?? s}
            </Button>
          ))}
        </div>

        {orders.length === 0 ? (
          <EmptyState title="Sem pedidos" description="Nenhum pedido de compra encontrado." />
        ) : (
          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Comprador</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Vendas origem</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o: any) => {
                  const isOpen = expanded.has(o.id);
                  const sos = originsByPo[o.id] ?? [];
                  return (
                    <Fragment key={o.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50">
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(o.id)}
                            onCheckedChange={() => toggleSelect(o.id)}
                          />
                        </TableCell>
                        <TableCell onClick={() => toggleExpand(o.id)}>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell onClick={() => nav(`/purchase/orders/${o.id}`)} className="font-medium">{o.name}</TableCell>
                        <TableCell onClick={() => nav(`/purchase/orders/${o.id}`)}>{o.partners?.name ?? "—"}</TableCell>
                        <TableCell onClick={() => nav(`/purchase/orders/${o.id}`)}>
                          <div className="text-sm">{buyerMap[o.created_by] ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {o.created_at ? new Date(o.created_at).toLocaleString("pt-PT") : ""}
                          </div>
                        </TableCell>
                        <TableCell onClick={() => nav(`/purchase/orders/${o.id}`)} className="text-sm">
                          {o.date_order ? new Date(o.date_order).toLocaleDateString("pt-PT") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {sos.slice(0, 2).map((s) => (
                              <Link key={s.id} to={`/sales/orders/${s.id}`} onClick={(e) => e.stopPropagation()}>
                                <Badge variant="outline" className="hover:bg-accent">{s.name}</Badge>
                              </Link>
                            ))}
                            {sos.length > 2 && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="secondary">+{sos.length - 2}</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {sos.slice(2).map((s) => s.name).join(", ")}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {sos.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell onClick={() => nav(`/purchase/orders/${o.id}`)}>
                          <Badge variant={STATE_VARIANT[o.state] ?? "secondary"}>
                            {STATE_LABEL[o.state] ?? o.state}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium" onClick={() => nav(`/purchase/orders/${o.id}`)}>
                          {fmtMoney(o.amount_total)}
                        </TableCell>
                      </TableRow>
                      {isOpen && <ExpandedRow poId={o.id} poName={o.name} sos={sos} />}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
};

function ExpandedRow({ poId, poName, sos }: { poId: string; poName: string; sos: { id: string; name: string }[] }) {
  const { data: lines = [] } = useQuery({
    queryKey: ["po-lines", poId],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_order_lines")
        .select("id, product_id, description, quantity, unit_price, subtotal, products(name)")
        .eq("order_id", poId)
        .order("sequence");
      return data ?? [];
    },
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ["po-receipts", poName],
    queryFn: async () => {
      const { data } = await supabase
        .from("stock_pickings")
        .select("id, name, state, scheduled_at, done_at, stock_moves(product_id, quantity, quantity_done)")
        .eq("origin", poName)
        .eq("kind", "incoming");
      return data ?? [];
    },
  });

  // Map of received per product
  const receivedByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    (receipts as any[]).forEach((p) => {
      if (p.state !== "done") return;
      (p.stock_moves || []).forEach((mv: any) => {
        m[mv.product_id] = (m[mv.product_id] || 0) + Number(mv.quantity_done || 0);
      });
    });
    return m;
  }, [receipts]);

  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={9} className="p-0">
        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Linhas do pedido</div>
            <div className="border rounded bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Pedido</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead className="text-right">Em falta</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l: any) => {
                    const received = receivedByProduct[l.product_id] || 0;
                    const missing = Math.max(0, Number(l.quantity) - received);
                    return (
                      <TableRow key={l.id}>
                        <TableCell>{l.products?.name ?? l.description}</TableCell>
                        <TableCell className="text-right">{l.quantity}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={received >= l.quantity ? "default" : received > 0 ? "secondary" : "outline"}>
                            {received}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {missing > 0 ? <span className="text-destructive">{missing}</span> : "—"}
                        </TableCell>
                        <TableCell className="text-right">{fmtMoney(l.unit_price)}</TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(l.subtotal)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {sos.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Vendas que originaram esta compra
              </div>
              <div className="flex gap-2 flex-wrap">
                {sos.map((s) => (
                  <Link key={s.id} to={`/sales/orders/${s.id}`}>
                    <Badge variant="outline" className="hover:bg-accent cursor-pointer">{s.name}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {receipts.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Receções</div>
              <div className="space-y-1">
                {(receipts as any[]).map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-sm">
                    <Badge variant={r.state === "done" ? "default" : "secondary"}>{r.state}</Badge>
                    <span className="font-medium">{r.name}</span>
                    {r.done_at && (
                      <span className="text-muted-foreground text-xs">
                        Validado em {new Date(r.done_at).toLocaleString("pt-PT")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
