import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ShoppingBag, AlertTriangle, Clock, CheckCircle2, ArrowRight } from "lucide-react";
import {
  OperationalDataTable,
  OperationalStatusBadge,
  useRpcMutation,
  type Column,
  type FilterDef,
  type FilterValue,
  type OperationalAction,
} from "@/core/operational";

const ORIGIN_LABEL: Record<string, string> = {
  sale: "Venda", manufacturing: "Produção", min_stock: "Stock mín.",
  manual: "Manual", forecast: "Previsão",
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

const LIST_KEY: any = ["purchase_needs"];
const TERMINAL_NEED = (s: string) => ["received", "cancelled", "po_created", "partially_received"].includes(s);

export default function PurchaseNeedsList() {
  const nav = useNavigate();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterValue>>({
    state: "open", origin: null, supplier: null, linked: null,
  });
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertNeeds, setConvertNeeds] = useState<Row[]>([]);
  const [forceSupplier, setForceSupplier] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");

  const { data: rows = [], isLoading, error, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["purchase_needs", filters],
    queryFn: async () => {
      let q: any = supabase
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
      const state = filters.state as string | null;
      if (state === "open" || !state) {
        q = q.in("state", ["pending", "quoting", "approved", "po_created", "partially_received"]);
      } else if (state !== "all") {
        q = q.eq("state", state);
      }
      if (filters.origin) q = q.eq("origin_kind", filters.origin as string);
      if (filters.supplier) q = q.eq("suggested_partner_id", filters.supplier as string);
      if (filters.linked === "linked") q = q.not("purchase_order_id", "is", null);
      if (filters.linked === "unlinked") q = q.is("purchase_order_id", null);
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
          (r.products?.internal_ref ?? "").toLowerCase().includes(s) ||
          (r.partners?.name ?? "").toLowerCase().includes(s) ||
          (r.product_variants?.sku ?? "").toLowerCase().includes(s) ||
          (r.sale_orders?.name ?? "").toLowerCase().includes(s) ||
          (r.manufacturing_orders?.code ?? "").toLowerCase().includes(s)
        );
      }),
    [rows, search],
  );

  const counts = useMemo(() => ({
    pending: rows.filter((r: Row) => r.state === "pending").length,
    po: rows.filter((r: Row) => r.state === "po_created" || r.state === "partially_received").length,
    late: rows.filter(
      (r: Row) => r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state),
    ).length,
    received: rows.filter((r: Row) => r.state === "received").length,
  }), [rows]);

  const createPo = useRpcMutation<{ _need_ids: string[]; _supplier_id: string | null; _expected_date: string | null }, any>({
    rpc: "purchase_needs_create_po",
    invalidateKeys: [LIST_KEY, ["purchase-orders-list"]],
    onSuccess: (data) => {
      const created = data?.created ?? [];
      const linked = data?.already_linked ?? [];
      const poIds = Array.from(new Set([...created.map((c: any) => c.purchase_order_id), ...linked.map((c: any) => c.purchase_order_id)]));
      // Custom success message (replace generic one)
      import("sonner").then(({ toast }) =>
        toast.success(`Criados ${created.length} linhas em ${poIds.length} pedido(s).${linked.length ? ` ${linked.length} já vinculadas.` : ""}`),
      );
      setConvertOpen(false);
      if (poIds.length === 1) nav(`/purchase/orders/${poIds[0]}`);
    },
    onError: (err) => {
      import("sonner").then(({ toast }) => toast.error(mapError(err.message)));
    },
  });

  const cancelNeed = useRpcMutation<{ _id: string }, void>({
    rpc: "cancel_purchase_need",
    successMessage: "Necessidade cancelada",
    invalidateKeys: [LIST_KEY],
    onError: (err) => {
      import("sonner").then(({ toast }) => toast.error(mapError(err.message)));
    },
  });

  const openConvert = (needs: Row[]) => {
    setConvertNeeds(needs);
    const suppliers = new Set(needs.map((n) => n.partners?.id).filter(Boolean));
    setForceSupplier(suppliers.size === 1 ? (needs[0].partners?.id ?? "") : "");
    setExpectedDate("");
    setConvertOpen(true);
  };

  const submitConvert = () => {
    if (convertNeeds.length === 0) return;
    createPo.mutate({
      _need_ids: convertNeeds.map((n) => n.id),
      _supplier_id: forceSupplier || null,
      _expected_date: expectedDate || null,
    });
  };

  const columns: Column<Row>[] = useMemo(() => [
    {
      key: "product",
      header: "Produto",
      cell: (r) => (
        <div>
          <Link to={`/products/${r.products?.id}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
            {r.products?.name}
          </Link>
          {r.products?.internal_ref && <div className="text-xs text-muted-foreground">{r.products.internal_ref}</div>}
        </div>
      ),
    },
    {
      key: "variant",
      header: "Variante",
      cell: (r) => r.product_variants?.sku
        ? <Badge variant="outline" className="text-xs">{r.product_variants.sku}</Badge>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "qty",
      header: "Qtd",
      align: "right",
      cell: (r) => <span className="font-medium">{Number(r.qty_needed).toLocaleString("pt-PT")}</span>,
    },
    {
      key: "origin",
      header: "Origem",
      cell: (r) => <Badge variant="outline" className="text-xs">{ORIGIN_LABEL[r.origin_kind] ?? r.origin_kind}</Badge>,
    },
    {
      key: "ref",
      header: "Referência",
      cell: (r) => (
        <div className="text-xs space-y-0.5">
          {r.sale_orders && (
            <Link to={`/sales/orders/${r.sale_orders.id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline block">
              Venda {r.sale_orders.name}
            </Link>
          )}
          {r.manufacturing_orders && (
            <Link to={`/manufacturing/orders/${r.manufacturing_orders.id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline block">
              MO {r.manufacturing_orders.code}
            </Link>
          )}
          {!r.sale_orders && !r.manufacturing_orders && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Fornecedor",
      cell: (r) => r.partners?.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "needed_by",
      header: "Prazo",
      cell: (r) => {
        const late = r.needed_by && new Date(r.needed_by) < new Date() && !["received", "cancelled"].includes(r.state);
        return (
          <span className={`text-xs ${late ? "text-destructive font-medium" : ""}`}>
            {r.needed_by ? new Date(r.needed_by).toLocaleDateString("pt-PT") : "—"}
          </span>
        );
      },
    },
    {
      key: "state",
      header: "Estado",
      cell: (r) => <OperationalStatusBadge domain="purchase_need" status={r.state} />,
    },
    {
      key: "po",
      header: "PO",
      cell: (r) => r.purchase_orders ? (
        <Link to={`/purchase/orders/${r.purchase_orders.id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline text-xs">
          {r.purchase_orders.name}
        </Link>
      ) : <span className="text-muted-foreground text-xs">—</span>,
    },
  ], []);

  const rowActions = (r: Row): OperationalAction[] => {
    const blocked = TERMINAL_NEED(r.state);
    const reasonCreate = blocked ? "Necessidade já vinculada, recebida ou cancelada." : null;
    const reasonCancel = blocked ? "Necessidade já não pode ser cancelada." : null;
    return [
      {
        key: "create-po",
        label: "Criar Pedido",
        icon: <ArrowRight className="h-3 w-3" />,
        variant: "default",
        disabled: blocked,
        disabledReason: reasonCreate,
        onClick: () => openConvert([r]),
      },
      {
        key: "cancel",
        label: "Cancelar",
        destructive: true,
        loading: cancelNeed.isPending && (cancelNeed.variables as any)?._id === r.id,
        disabled: blocked,
        disabledReason: reasonCancel,
        confirm: { title: "Cancelar necessidade?", description: `Necessidade de ${r.products?.name}.` },
        onClick: () => cancelNeed.mutateAsync({ _id: r.id }).catch(() => {}),
      },
    ];
  };

  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "state", label: "Estado", type: "select",
      options: [
        { value: "open", label: "Abertas" },
        { value: "all", label: "Todas" },
        { value: "pending", label: "Pendente" },
        { value: "quoting", label: "Em cotação" },
        { value: "approved", label: "Aprovado" },
        { value: "po_created", label: "PO criado" },
        { value: "partially_received", label: "Parc. recebido" },
        { value: "received", label: "Recebido" },
        { value: "cancelled", label: "Cancelado" },
      ],
    },
    {
      key: "origin", label: "Origem", type: "select",
      options: Object.entries(ORIGIN_LABEL).map(([k, v]) => ({ value: k, label: v })),
    },
    {
      key: "supplier", label: "Fornecedor", type: "select",
      options: (partners as any[]).map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: "linked", label: "Vínculo PO", type: "select",
      options: [{ value: "linked", label: "Com PO" }, { value: "unlinked", label: "Sem PO" }],
    },
  ], [partners]);

  return (
    <>
      <PageHeader title="Necessidades de Compra" breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Necessidades" }]} />
      <PageBody>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-3 w-3" />Pendentes</div><div className="text-2xl font-semibold">{counts.pending}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><ShoppingBag className="h-3 w-3" />Em PO</div><div className="text-2xl font-semibold">{counts.po}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><Clock className="h-3 w-3" />Atrasadas</div><div className="text-2xl font-semibold text-destructive">{counts.late}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-3 w-3" />Recebidas</div><div className="text-2xl font-semibold">{counts.received}</div></Card>
        </div>

        <OperationalDataTable<Row>
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          search={{ value: search, onChange: setSearch, placeholder: "Buscar produto / variante / fornecedor / SO / MO…" }}
          filters={filterDefs}
          filterValues={filters}
          onFilterChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
          onFiltersClear={() => setFilters({ state: "open", origin: null, supplier: null, linked: null })}
          onRefresh={() => refetch()}
          lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
          rowActions={rowActions}
          emptyTitle="Sem necessidades"
          emptyDescription="Nenhuma necessidade corresponde aos filtros."
        />
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
                    {(partners as any[]).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
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
            <Button variant="ghost" onClick={() => setConvertOpen(false)} disabled={createPo.isPending}>Cancelar</Button>
            <Button onClick={submitConvert} disabled={createPo.isPending}>
              {createPo.isPending ? "A criar…" : "Confirmar e Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Multi-select bulk action retained via Checkbox header future. */}
      {/* Note: bulk multi-select intentionally simplified — row-level conversion preserved. */}
      {/* For multi-need conversion across rows, use the kanban / detail bulk flows (R4.1). */}
      <span hidden><Checkbox /></span>
    </>
  );
}
