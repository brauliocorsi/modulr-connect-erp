import { ListView } from "@/core/layout/ListView";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, PackageCheck, Truck, RefreshCw, ClipboardList, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";


export const InventoryDashboard = () => {
  const { data } = useQuery({
    queryKey: ["pickings-counts-v2"],
    queryFn: async () => {
      // Resolve key location ids by name
      const { data: locs } = await supabase
        .from("stock_locations")
        .select("id,name")
        .in("name", ["Cais de Carga", "Em Entrega"]);
      const cais = locs?.find((l: any) => l.name === "Cais de Carga")?.id ?? null;
      const enroute = locs?.find((l: any) => l.name === "Em Entrega")?.id ?? null;

      const baseOpen = (q: any) => q.neq("state", "done").neq("state", "cancelled");

      const incomingP = baseOpen(
        supabase.from("stock_pickings").select("id", { count: "exact", head: true }).eq("kind", "incoming")
      );
      const internalP = baseOpen(
        supabase.from("stock_pickings").select("id", { count: "exact", head: true }).eq("kind", "internal")
      );
      // Cais de Carga: outgoing pickings whose destination is Cais de Carga (waiting to be loaded)
      const caisP = cais
        ? baseOpen(
            supabase
              .from("stock_pickings")
              .select("id", { count: "exact", head: true })
              .eq("kind", "outgoing")
              .eq("destination_location_id", cais)
          )
        : Promise.resolve({ count: 0 } as any);
      // Em Entrega: outgoing pickings already at/leaving Em Entrega (in transit to customer)
      const enrouteP = enroute
        ? baseOpen(
            supabase
              .from("stock_pickings")
              .select("id", { count: "exact", head: true })
              .eq("kind", "outgoing")
              .eq("source_location_id", enroute)
          )
        : Promise.resolve({ count: 0 } as any);

      const [inc, intl, c, en] = await Promise.all([incomingP, internalP, caisP, enrouteP]);
      return {
        incoming: inc.count ?? 0,
        internal: intl.count ?? 0,
        cais: c.count ?? 0,
        enroute: en.count ?? 0,
      };
    },
  });

  const cards = [
    { title: "Recebimentos", icon: ArrowDownToLine, count: data?.incoming ?? 0, color: "text-success", to: "/inventory/receipts", hint: "Aguardando processamento" },
    { title: "Cais de Carga", icon: PackageCheck, count: data?.cais ?? 0, color: "text-warning", to: "/inventory/shipments?stage=cais", hint: "Separados, aguardando carga" },
    { title: "Em Entrega", icon: Truck, count: data?.enroute ?? 0, color: "text-info", to: "/inventory/shipments?stage=enroute", hint: "Em rota até ao cliente" },
    { title: "Transferências internas", icon: RefreshCw, count: data?.internal ?? 0, color: "text-primary", to: "/inventory/internal-transfers", hint: "Movimentações entre locais" },
    { title: "Ajustes pendentes", icon: ClipboardList, count: 0, color: "text-muted-foreground", to: "/inventory/adjustments", hint: "Inventários a confirmar" },
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <Link key={c.title} to={c.to}>
              <Card className="p-5 hover:shadow-md hover:bg-accent/30 transition-all cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-muted-foreground">{c.title}</div>
                    <div className="text-3xl font-bold mt-1">{c.count}</div>
                    <div className="text-xs text-muted-foreground mt-1">Aguardando processamento</div>
                  </div>
                  <c.icon className={"h-8 w-8 " + c.color} />
                </div>
              </Card>
            </Link>
          ))}
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

