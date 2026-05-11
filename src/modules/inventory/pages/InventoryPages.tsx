import { ListView } from "@/core/layout/ListView";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, PackageCheck, Truck, RefreshCw, ClipboardList, Zap, HandHelping } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { toast } from "sonner";


export const InventoryDashboard = () => {
  const { data } = useQuery({
    queryKey: ["pickings-counts-v3"],
    queryFn: async () => {
      const { data: locs } = await supabase
        .from("stock_locations")
        .select("id,name")
        .in("name", ["Cais de Carga", "Em Entrega"]);
      const caisId = locs?.find((l: any) => l.name === "Cais de Carga")?.id ?? null;
      const enrouteId = locs?.find((l: any) => l.name === "Em Entrega")?.id ?? null;

      // Fetch all open outgoing pickings with src/dest + linked SO type to split them.
      const { data: outgoing } = await supabase
        .from("stock_pickings")
        .select("id,state,origin,source_location_id,destination_location_id")
        .eq("kind", "outgoing")
        .not("state", "in", "(done,cancelled)")
        .limit(2000);

      const soNames = Array.from(new Set((outgoing ?? []).map((p: any) => p.origin).filter(Boolean))) as string[];
      const soMap: Record<string, { include_delivery: boolean }> = {};
      if (soNames.length) {
        const { data: sos } = await supabase
          .from("sale_orders")
          .select("name,include_delivery")
          .in("name", soNames);
        (sos ?? []).forEach((s: any) => (soMap[s.name] = { include_delivery: !!s.include_delivery }));
      }

      const cais = (outgoing ?? []).filter((p: any) => p.destination_location_id === caisId);
      const enroute = (outgoing ?? []).filter((p: any) => p.source_location_id === enrouteId);
      // Pickup = outgoing going from Cais de Carga directly to Customer (no Em Entrega step). Identify by SO flag.
      const pickup = (outgoing ?? []).filter((p: any) => p.source_location_id === caisId && p.origin && soMap[p.origin]?.include_delivery === false);

      // Incoming + internal counts
      const baseOpen = (q: any) => q.not("state", "in", "(done,cancelled)");
      const [{ data: inc }, { data: intl }] = await Promise.all([
        baseOpen(supabase.from("stock_pickings").select("id,state").eq("kind", "incoming")),
        baseOpen(supabase.from("stock_pickings").select("id,state").eq("kind", "internal")),
      ]);

      const ready = (rows: any[]) => rows.filter((r) => r.state === "ready").length;

      return {
        incoming: { count: (inc ?? []).length, ready: ready(inc ?? []) },
        internal: { count: (intl ?? []).length, ready: ready(intl ?? []) },
        cais: { count: cais.length, ready: ready(cais) },
        enroute: { count: enroute.length, ready: ready(enroute) },
        pickup: { count: pickup.length, ready: ready(pickup) },
      };
    },
  });

  const cards = [
    { title: "Recebimentos", icon: ArrowDownToLine, stat: data?.incoming, color: "text-success", to: "/inventory/receipts", hint: "Aguardando processamento" },
    { title: "Cais de Carga", icon: PackageCheck, stat: data?.cais, color: "text-warning", to: "/inventory/shipments?stage=cais", hint: "Separados, aguardando carga" },
    { title: "Levantamento", icon: HandHelping, stat: data?.pickup, color: "text-violet-600", to: "/inventory/shipments?stage=pickup", hint: "Cliente vai levantar no cais" },
    { title: "Em Entrega", icon: Truck, stat: data?.enroute, color: "text-info", to: "/inventory/shipments?stage=enroute", hint: "Em rota até ao cliente" },
    { title: "Transferências internas", icon: RefreshCw, stat: data?.internal, color: "text-primary", to: "/inventory/internal-transfers", hint: "Movimentações entre locais" },
    { title: "Ajustes pendentes", icon: ClipboardList, stat: { count: 0, ready: 0 }, color: "text-muted-foreground", to: "/inventory/adjustments", hint: "Inventários a confirmar" },
  ];

  const runReorder = async () => {
    const { data, error } = await supabase.functions.invoke("reordering-cron");
    if (error) return toast.error(error.message);
    toast.success(`Reabastecimento executado (${(data as any)?.created ?? 0} RFQs criadas)`);
  };

  return (
    <>
      <PageHeader
        title="Visão geral do Inventário"
        breadcrumb={[{ label: "Inventário" }]}
        actions={
          <Button size="sm" variant="outline" onClick={runReorder}>
            <Zap className="h-4 w-4 mr-1" /> Rodar reabastecimento
          </Button>
        }
      />
      <PageBody>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cards.map((c) => {
            const count = c.stat?.count ?? 0;
            const ready = c.stat?.ready ?? 0;
            return (
              <Link key={c.title} to={c.to}>
                <Card className="p-5 hover:shadow-md hover:bg-accent/30 transition-all cursor-pointer h-full relative">
                  {ready > 0 && (
                    <Badge className="absolute top-2 right-2 bg-emerald-600 hover:bg-emerald-600 text-white">
                      {ready} pronto{ready > 1 ? "s" : ""}
                    </Badge>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-muted-foreground">{c.title}</div>
                      <div className="text-3xl font-bold mt-1">{count}</div>
                      <div className="text-xs text-muted-foreground mt-1">{(c as any).hint ?? "Aguardando processamento"}</div>
                    </div>
                    <c.icon className={"h-8 w-8 " + c.color} />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </PageBody>
    </>
  );
};

// TransfersList moved to ./TransfersList.tsx (custom page with batch selection)

export const AdjustmentsList = () => (
  <ListView
    title="Ajustes de Inventário"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Ajustes" }]}
    table="inventory_adjustments"
    searchColumn="name"
    createTo="/inventory/adjustments/new"
    rowLink={(r: any) => `/inventory/adjustments/${r.id}`}
    columns={[
      { key: "name", header: "Referência" },
      { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{r.state}</span> },
      { key: "scheduled_at", header: "Programado", render: (r: any) => r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("pt-PT") : "—" },
    ]}
  />
);

export const KardexList = () => (
  <ListView
    title="Kardex (Movimentações)"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Kardex" }]}
    table="stock_moves"
    select="id, reference, quantity, quantity_done, state, created_at, products(name)"
    searchColumn="reference"
    columns={[
      { key: "created_at", header: "Data", render: (r: any) => new Date(r.created_at).toLocaleString("pt-PT") },
      { key: "product", header: "Produto", render: (r: any) => r.products?.name },
      { key: "quantity", header: "Qtd" },
      { key: "quantity_done", header: "Feito" },
      { key: "state", header: "Estado" },
    ]}
  />
);

export const LotsList = () => (
  <ListView
    title="Lotes / Séries"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Lotes" }]}
    table="stock_lots"
    select="id, name, expiration_date, products(name)"
    searchColumn="name"
    createTo="/inventory/lots/new"
    rowLink={(r: any) => `/inventory/lots/${r.id}`}
    columns={[
      { key: "name", header: "Lote/Série" },
      { key: "product", header: "Produto", render: (r: any) => r.products?.name },
      { key: "expiration_date", header: "Validade" },
    ]}
  />
);


export const WarehousesList = () => (
  <ListView
    title="Armazéns"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Armazéns" }]}
    table="warehouses"
    searchColumn="name"
    createTo="/inventory/warehouses/new"
    rowLink={(r: any) => `/inventory/warehouses/${r.id}`}
    columns={[
      { key: "code", header: "Código" },
      { key: "name", header: "Nome" },
      { key: "address", header: "Endereço" },
    ]}
  />
);

export const LocationsList = () => (
  <ListView
    title="Locais"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Locais" }]}
    table="stock_locations"
    select="id, name, type, full_path, warehouses(name)"
    searchColumn="name"
    createTo="/inventory/locations/new"
    rowLink={(r: any) => `/inventory/locations/${r.id}`}
    columns={[
      { key: "full_path", header: "Caminho" },
      { key: "name", header: "Nome" },
      { key: "type", header: "Tipo" },
      { key: "warehouse", header: "Armazém", render: (r: any) => r.warehouses?.name ?? "—" },
    ]}
  />
);

export const ReorderingList = () => (
  <ListView
    title="Regras de Reabastecimento"
    breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Reabastecimento" }]}
    table="reordering_rules"
    select="id, min_qty, max_qty, multiple_qty, products(name), warehouses(name)"
    searchColumn="id"
    createTo="/inventory/reordering/new"
    rowLink={(r: any) => `/inventory/reordering/${r.id}`}
    columns={[
      { key: "product", header: "Produto", render: (r: any) => r.products?.name },
      { key: "warehouse", header: "Armazém", render: (r: any) => r.warehouses?.name },
      { key: "min_qty", header: "Mín" },
      { key: "max_qty", header: "Máx" },
      { key: "multiple_qty", header: "Múltiplo" },
    ]}
  />
);

