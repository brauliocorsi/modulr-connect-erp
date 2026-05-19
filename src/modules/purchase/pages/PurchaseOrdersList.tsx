import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutGrid } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  type Column,
  type FilterDef,
  type FilterValue,
} from "@/core/operational";

export const PurchaseOrdersList = () => {
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({
    state: null, supplier: null, warehouse: null, date: null, expected: null,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-min"],
    queryFn: async () => (await supabase.from("partners").select("id,name").eq("is_supplier", true).order("name")).data ?? [],
  });
  const { data: warehousesOpt = [] } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });

  const { data: orders = [], isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["purchase-orders-list", filters, search],
    queryFn: async () => {
      let q: any = supabase
        .from("purchase_orders")
        .select("id, name, state, date_order, expected_date, amount_total, partner_id, warehouse_id, created_by, created_at, partners(name), warehouses(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (filters.state) q = q.eq("state", filters.state);
      if (filters.supplier) q = q.eq("partner_id", filters.supplier);
      if (filters.warehouse) q = q.eq("warehouse_id", filters.warehouse);
      const date = filters.date as { from?: string; to?: string } | null;
      if (date?.from) q = q.gte("date_order", date.from);
      if (date?.to) q = q.lte("date_order", date.to + "T23:59:59");
      const exp = filters.expected as { from?: string; to?: string } | null;
      if (exp?.from) q = q.gte("expected_date", exp.from);
      if (exp?.to) q = q.lte("expected_date", exp.to);
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

  const originsByPo = useMemo(() => {
    const m: Record<string, { id: string; name: string }[]> = {};
    (origins as any[]).forEach((o) => {
      if (!o.sale_orders) return;
      (m[o.po_id] ||= []).push({ id: o.sale_orders.id, name: o.sale_orders.name });
    });
    return m;
  }, [origins]);

  const sortedOrders = useMemo(() => {
    const isPending = (s: string) => s === "draft" || s === "rfq_sent";
    return [...orders].sort((a: any, b: any) => {
      const ap = isPending(a.state) ? 0 : 1;
      const bp = isPending(b.state) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders]);

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state", label: "Estado", type: "select",
      options: [
        { value: "draft", label: "Rascunho" },
        { value: "rfq_sent", label: "RFQ enviada" },
        { value: "confirmed", label: "Confirmado" },
        { value: "done", label: "Concluído" },
        { value: "cancelled", label: "Cancelado" },
      ],
    },
    {
      key: "supplier", label: "Fornecedor", type: "select",
      options: (suppliers as any[]).map((s) => ({ value: s.id, label: s.name })),
    },
    {
      key: "warehouse", label: "Armazém", type: "select",
      options: (warehousesOpt as any[]).map((w) => ({ value: w.id, label: w.name })),
    },
    { key: "date", label: "Data", type: "date-range" },
    { key: "expected", label: "Esperada", type: "date-range" },
  ], [suppliers, warehousesOpt]);

  const columns: Column<any>[] = useMemo(() => [
    {
      key: "name",
      header: "Número",
      cell: (o) => {
        const isPending = o.state === "draft" || o.state === "rfq_sent";
        const fromSale = (originsByPo[o.id]?.length ?? 0) > 0;
        return (
          <div className="flex items-center gap-2 font-medium">
            {o.name}
            {isPending && fromSale && (
              <Badge variant="default" className="text-xs">Pendente · Venda</Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "supplier",
      header: "Fornecedor",
      cell: (o) => o.partners?.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "warehouse",
      header: "Armazém",
      cell: (o) => <span className="text-xs">{o.warehouses?.name ?? "—"}</span>,
    },
    {
      key: "date_order",
      header: "Data",
      cell: (o) => <span className="text-xs">{o.date_order ? new Date(o.date_order).toLocaleDateString("pt-PT") : "—"}</span>,
    },
    {
      key: "expected_date",
      header: "Esperada",
      cell: (o) => <span className="text-xs">{o.expected_date ? new Date(o.expected_date).toLocaleDateString("pt-PT") : "—"}</span>,
    },
    {
      key: "origins",
      header: "Vendas origem",
      cell: (o) => {
        const sos = originsByPo[o.id] ?? [];
        if (sos.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex gap-1 flex-wrap">
            {sos.slice(0, 2).map((s) => (
              <Link key={s.id} to={`/sales/orders/${s.id}`} onClick={(e) => e.stopPropagation()}>
                <Badge variant="outline" className="hover:bg-accent text-xs">{s.name}</Badge>
              </Link>
            ))}
            {sos.length > 2 && <Badge variant="secondary" className="text-xs">+{sos.length - 2}</Badge>}
          </div>
        );
      },
    },
    {
      key: "state",
      header: "Estado",
      cell: (o) => <OperationalStatusBadge domain="purchase" status={o.state} />,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (o) => <span className="font-medium">{fmtMoney(o.amount_total)}</span>,
    },
  ], [originsByPo]);

  return (
    <>
      <PageHeader
        title="Pedidos de Compra"
        breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Pedidos" }]}
        createTo="/purchase/orders/new"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/purchase/kanban"><LayoutGrid className="h-4 w-4 mr-1" /> Kanban</Link>
          </Button>
        }
      />
      <PageBody>
        <OperationalDataTable<any>
          columns={columns}
          rows={sortedOrders}
          getRowId={(o) => o.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRowClick={(o) => nav(`/purchase/orders/${o.id}`)}
          search={{ value: search, onChange: setSearch, placeholder: "Buscar nº…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
          onFiltersClear={() => setFilters({ state: null, supplier: null, warehouse: null, date: null, expected: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          emptyTitle="Sem pedidos"
          emptyDescription="Nenhum pedido de compra corresponde aos filtros."
        />
      </PageBody>
    </>
  );
};
