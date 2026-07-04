import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
const fmtPct = (n: number) => `${fmt(n)}%`;

type Row = {
  sale_order_id: string;
  sale_order_name: string;
  sale_state: string;
  partner_name: string | null;
  revenue: number;
  cogs: number;
  margin_value: number;
  margin_pct: number;
  delivered_at: string | null;
};

export default function SaleMarginReport() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [from, setFrom] = useState<string>(firstOfMonth);
  const [to, setTo] = useState<string>(today);

  const { data, isLoading } = useQuery({
    queryKey: ["v_sale_margin", from, to],
    queryFn: async () => {
      let q = supabase.from("v_sale_margin" as any).select("*").limit(1000);
      if (from) q = q.gte("delivered_at", `${from}T00:00:00`);
      if (to) q = q.lte("delivered_at", `${to}T23:59:59`);
      const { data, error } = await q.order("delivered_at", { ascending: false });
      if (error) throw error;
      return (data as any as Row[]) ?? [];
    },
  });

  const rows = data ?? [];
  const totals = useMemo(() => {
    const t = { revenue: 0, cogs: 0, margin: 0 };
    rows.forEach((r) => { t.revenue += Number(r.revenue || 0); t.cogs += Number(r.cogs || 0); t.margin += Number(r.margin_value || 0); });
    return { ...t, pct: t.revenue > 0 ? (t.margin / t.revenue) * 100 : 0 };
  }, [rows]);

  return (
    <>
      <PageHeader title="Margem por Venda" breadcrumb={[{ label: "Relatórios" }, { label: "Margem" }]} />
      <PageBody>
        <Card className="p-4 mb-4 flex flex-wrap gap-4 items-end">
          <div>
            <Label>De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label>Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="text-xs text-muted-foreground ml-auto">
            Filtro por data de entrega (delivered_at). Vendas ainda sem entrega não aparecem.
          </div>
        </Card>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Venda</th>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-left px-3 py-2">Entregue</th>
                  <th className="text-right px-3 py-2">Receita (s/ IVA)</th>
                  <th className="text-right px-3 py-2">COGS</th>
                  <th className="text-right px-3 py-2">Margem €</th>
                  <th className="text-right px-3 py-2">Margem %</th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Carregando…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">Sem vendas no período</td></tr>
                ) : rows.map((r) => {
                  const noCost = Number(r.cogs || 0) === 0 && Number(r.revenue || 0) > 0;
                  return (
                    <tr key={r.sale_order_id} className={`border-t ${noCost ? "bg-amber-50" : ""}`}>
                      <td className="px-3 py-2 font-medium">{r.sale_order_name}</td>
                      <td className="px-3 py-2">{r.partner_name ?? "—"}</td>
                      <td className="px-3 py-2"><Badge variant="secondary">{r.sale_state}</Badge></td>
                      <td className="px-3 py-2 text-xs">{r.delivered_at ? new Date(r.delivered_at).toLocaleDateString("pt-PT") : "—"}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.revenue)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.cogs)}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(r.margin_value)}</td>
                      <td className="px-3 py-2 text-right">{fmtPct(r.margin_pct)}</td>
                      <td className="px-3 py-2">
                        {noCost && (
                          <span title="Sem custeio — não há stock_moves com unit_cost. Margem inflada." className="inline-flex">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/40 font-semibold">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right">Totais:</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.revenue)}</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.cogs)}</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.margin)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(totals.pct)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
          Linhas destacadas: receita &gt; 0 mas COGS = 0 (sem snapshot de custo). A margem apresentada não reflete o custo real.
        </div>
      </PageBody>
    </>
  );
}
