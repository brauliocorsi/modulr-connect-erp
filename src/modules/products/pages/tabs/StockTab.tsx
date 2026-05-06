import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { Card } from "@/components/ui/card";

export function StockTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("product_stock_forecast")
        .select("*, warehouses(name,code)")
        .eq("product_id", productId);
      setRows(data ?? []);
    })();
  }, [productId]);

  const tot = rows.reduce((acc, r) => ({
    on_hand: acc.on_hand + Number(r.on_hand || 0),
    reserved: acc.reserved + Number(r.reserved || 0),
    available: acc.available + Number(r.available || 0),
    incoming: acc.incoming + Number(r.incoming || 0),
    outgoing: acc.outgoing + Number(r.outgoing || 0),
    forecasted: acc.forecasted + Number(r.forecasted || 0),
    sold_30d: acc.sold_30d + Number(r.sold_30d || 0),
    sold_90d: acc.sold_90d + Number(r.sold_90d || 0),
  }), { on_hand: 0, reserved: 0, available: 0, incoming: 0, outgoing: 0, forecasted: 0, sold_30d: 0, sold_90d: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Em mão</div><div className="text-2xl font-semibold">{fmtNumber(tot.on_hand)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Disponível</div><div className="text-2xl font-semibold">{fmtNumber(tot.available)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Previsto</div><div className="text-2xl font-semibold text-primary">{fmtNumber(tot.forecasted)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Vendido 30d</div><div className="text-2xl font-semibold">{fmtNumber(tot.sold_30d)}</div></Card>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left p-2">Armazém</th>
            <th className="text-right p-2">Em mão</th>
            <th className="text-right p-2">Reservado</th>
            <th className="text-right p-2">Disponível</th>
            <th className="text-right p-2">A receber</th>
            <th className="text-right p-2">A entregar</th>
            <th className="text-right p-2">Previsto</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sem dados</td></tr>
            : rows.map((r) => (
              <tr key={r.warehouse_id} className="border-t">
                <td className="p-2">{r.warehouses?.name || r.warehouse_id?.slice(0, 8)}</td>
                <td className="p-2 text-right">{fmtNumber(r.on_hand)}</td>
                <td className="p-2 text-right">{fmtNumber(r.reserved)}</td>
                <td className="p-2 text-right">{fmtNumber(r.available)}</td>
                <td className="p-2 text-right text-emerald-600">+{fmtNumber(r.incoming)}</td>
                <td className="p-2 text-right text-rose-600">−{fmtNumber(r.outgoing)}</td>
                <td className="p-2 text-right font-semibold">{fmtNumber(r.forecasted)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
