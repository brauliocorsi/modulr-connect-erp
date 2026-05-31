import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOperationalRealtime } from "@/core/realtime";
import { fmtMoney } from "@/lib/format";
import { FulfillmentBadge } from "@/core/orders/FulfillmentBadge";
import { PaymentStatusBadge } from "@/core/orders/PaymentStatusBadge";

type Row = {
  sale_order_id: string;
  name: string;
  state: string;
  fulfillment_status: string | null;
  payment_status: string | null;
  date_order: string | null;
  commitment_date: string | null;
  amount_total: number | null;
  partner_id: string | null;
  partners?: { name: string } | null;
};

const COLUMNS: { state: string; label: string; tint: string }[] = [
  { state: "draft", label: "Rascunho", tint: "bg-muted/40 border-muted" },
  { state: "sent", label: "Enviado", tint: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900" },
  { state: "confirmed", label: "Confirmado", tint: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900" },
  { state: "done", label: "Concluído", tint: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900" },
];

export default function SalesPipelinePage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Row[]>({
    queryKey: ["sales-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_orders")
        .select("id, name, state, fulfillment_status, payment_status, date_order, commitment_date, amount_total, partner_id, partners(name)")
        .in("state", ["draft", "sent", "confirmed", "done"])
        .order("date_order", { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, sale_order_id: r.id })) as Row[];
    },
    refetchInterval: 30000,
  });

  useOperationalRealtime({
    channel: "sales-pipeline",
    tables: ["sale_orders"],
    queryKeys: [["sales-pipeline"]],
    debounceMs: 600,
  });

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = { draft: [], sent: [], confirmed: [], done: [] };
    for (const r of data ?? []) (g[r.state] ??= []).push(r);
    return g;
  }, [data]);

  const totals = useMemo(() => {
    const t: Record<string, { count: number; sum: number }> = {};
    for (const c of COLUMNS) {
      const rows = grouped[c.state] ?? [];
      t[c.state] = { count: rows.length, sum: rows.reduce((a, r) => a + Number(r.amount_total ?? 0), 0) };
    }
    return t;
  }, [grouped]);

  return (
    <>
      <PageHeader
        title="Pipeline de Vendas"
        breadcrumb={[{ label: "Vendas", to: "/sales" }, { label: "Pipeline" }]}
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {COLUMNS.map((col) => {
            const rows = grouped[col.state] ?? [];
            const t = totals[col.state];
            return (
              <div key={col.state} className={`rounded-lg border ${col.tint} flex flex-col min-h-[60vh]`}>
                <div className="p-3 border-b bg-background/40 backdrop-blur sticky top-0 z-10">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm">{col.label}</div>
                    <Badge variant="outline">{t.count}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">{fmtMoney(t.sum)}</div>
                </div>
                <div className="p-2 space-y-2 overflow-auto flex-1">
                  {isLoading && rows.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3">A carregar…</div>
                  ) : rows.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3">Sem pedidos</div>
                  ) : (
                    rows.map((r) => (
                      <Link
                        key={r.sale_order_id}
                        to={`/sales/orders/${r.sale_order_id}`}
                        className="block"
                      >
                        <Card className="p-2.5 hover:shadow-md transition-shadow cursor-pointer">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-sm truncate">{r.name}</div>
                            <div className="text-xs tabular-nums whitespace-nowrap">{fmtMoney(r.amount_total ?? 0)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{r.partners?.name ?? "—"}</div>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {r.fulfillment_status && <FulfillmentBadge status={r.fulfillment_status} />}
                            {r.payment_status && <PaymentStatusBadge status={r.payment_status} />}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {r.commitment_date
                              ? `Entrega: ${new Date(r.commitment_date).toLocaleDateString("pt-PT")}`
                              : r.date_order
                                ? new Date(r.date_order).toLocaleDateString("pt-PT")
                                : "—"}
                          </div>
                        </Card>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground mt-3">
          Atualização em tempo real: alterações de estado nas vendas refletem-se automaticamente.
        </div>
      </PageBody>
    </>
  );
}
